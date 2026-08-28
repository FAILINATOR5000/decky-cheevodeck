import asyncio

import decky
import smb_shares_store

from mixins._context import PluginContext
from utils import chown_to_data_owner, lchown_to_data_owner

DESKTOP_LINKS_FOLDER = "CheevoDeck Mounts"


class SmbSharesMixin(PluginContext):
    """IPC surface for the SMB Shares utility.

    Thin glue on purpose: the store owns identity and validation, the mount
    service owns everything that touches the system, and this layer only
    sequences the two and hops off the event loop. A blocking mount against a
    dead NAS would freeze the whole plugin, so every call that can touch
    systemd or a socket goes through asyncio.to_thread.

    No _ra_slot() anywhere in here. These aren't RetroAchievements calls, and
    the mount service's own lock is the right serialization primitive.
    """

    def _smb_debug(self, message, *args):
        """Per-call IPC tracing, behind the Debug Logging option.

        Mirrors log_focus_debug_event: chatty per-item lines are gated, while
        the lifecycle and failure lines in the mount service always fire. This
        is the layer that answers "what did the page actually ask for", which is
        the first question worth asking when a UI session misbehaves.

        Nothing here may carry a credential. A user troubleshooting a mount is
        precisely the person about to paste their log into an issue, so the
        password never appears and neither does the username.
        """
        if getattr(self, "_debug_logging", False):
            decky.logger.info("smb ipc: " + message, *args)

    def _rehydrate_smb_shares_locked(self) -> None:
        """Rebuild the store from /etc when it can't be trusted.

        The plugin's copy is a cache; the sidecars next to the credentials are
        the source of truth. This covers three real situations with one
        mechanism: a factory reset emptied runtime_dir out from under live
        mounts, the plugin was uninstalled and reinstalled (the units survive by
        design, which is the whole point of the feature), or someone deleted
        smb_shares.json by hand.
        """
        disk_records = self.smb_mount_service.read_disk_state()
        stored = self.smb_shares_store.list_shares()

        stored_slugs = {item["slug"] for item in stored}
        disk_slugs = {item["slug"] for item in disk_records if item.get("slug")}
        if stored_slugs == disk_slugs:
            return

        if not disk_records and stored:
            decky.logger.warning(
                "smb: %d share(s) in the store but nothing on disk; keeping the store "
                "(either /etc was wiped or it couldn't be read)",
                len(stored),
            )
            return

        decky.logger.info(
            "smb: store and disk disagree (%d stored, %d on disk), rebuilding from the sidecars",
            len(stored_slugs),
            len(disk_slugs),
        )
        by_slug = {item["slug"]: item for item in stored}
        merged = []
        for record in disk_records:
            slug = record.get("slug")
            existing = by_slug.get(slug)
            if existing is None:
                merged.append(record)
                continue
            rebuilt = dict(existing)
            for key in ("server", "share", "vers", "softMount", "hasPassword"):
                if key in record:
                    rebuilt[key] = record[key]
            merged.append(rebuilt)

        self.smb_shares_store.replace_all(merged)

    async def _rehydrate_smb_shares(self) -> None:
        try:
            await asyncio.to_thread(self._rehydrate_smb_shares_locked)
        except Exception as exc:
            decky.logger.warning("smb: rehydrate failed (%s: %s)", type(exc).__name__, exc)

    def _decorate(self, share: dict, state: dict) -> dict:
        decorated = dict(share)
        decorated["mountPath"] = str(self.smb_mount_service.mount_point(share["slug"]))
        decorated["status"] = state["status"]
        decorated["statusError"] = state.get("error")
        return decorated

    async def list_smb_shares(self, probe: bool = True, rehydrate: bool = True):
        """The list plus live status for each row.

        Two flags because a poller tick is a much smaller question than a page
        load. `probe` decides whether we ask the server anything at all, and its
        own cache keeps that down to one socket every twenty seconds. `rehydrate`
        is the expensive half: a scan of /etc, a glob of the unit directory and
        the reconcile that follows. That answers "did something change out
        there", which is a page-load question, not something worth re-asking
        every five seconds.
        """
        if rehydrate:
            await self._rehydrate_smb_shares()
        shares = self.smb_shares_store.list_shares()
        if not shares:
            return {"shares": []}

        statuses = await asyncio.to_thread(
            self.smb_mount_service.statuses_for, shares, probe=bool(probe)
        )
        self._smb_debug(
            "list -> %d share(s), probe=%s, statuses=%s",
            len(shares), bool(probe), sorted(state["status"] for state in statuses.values()),
        )
        unreadable = {"status": "error", "error": "status_unreadable"}
        return {
            "shares": [self._decorate(s, statuses.get(s["id"], unreadable)) for s in shares]
        }

    async def test_smb_share(self, payload, share_id=None):
        """Try the whole thing without saving any of it.

        This used to be a bare port-445 probe, which meant it answered
        "Connection Successful" to a completely wrong username: something was
        listening, and that was all it ever asked. So the highest-value
        affordance in the modal was quietly the most misleading thing on it.

        It now goes as far as it can without touching root: reachable, then the
        share opens with these credentials. Only the mount itself is left, and
        that needs the kernel.

        `share_id` is what makes Test work on the Edit screen. The password
        field there is deliberately blank when one is already saved, so a test
        that only read the payload was testing an empty password against a
        share that has one, and reported the credentials wrong every single
        time. It has to fall back to the saved secret exactly the way saving
        does.
        """
        if not isinstance(payload, dict):
            return {"ok": False, "error": "invalid_payload"}

        error = smb_shares_store.validate_server(payload.get("server"))
        if error:
            return {"ok": False, "error": error, "field": "server"}

        server = str(payload["server"]).strip()
        reachable = await asyncio.to_thread(
            self.smb_mount_service.probe, server, use_cache=False
        )
        if not reachable:
            self._smb_debug("test server=%s reachable=False", server)
            return {"ok": False, "error": "not_reachable", "field": "server"}

        if smb_shares_store.validate_share(payload.get("share")):
            self._smb_debug("test server=%s reachable, no share to check", server)
            return {"ok": True}

        password = payload.get("password")
        if not password and share_id:
            existing = self.smb_shares_store.get_by_id(share_id)
            if existing is not None:
                password = await asyncio.to_thread(
                    self.smb_mount_service.saved_password, existing["slug"]
                )

        checked = await self._verify_smb_credentials(payload, password=password or "")
        self._smb_debug("test server=%s verdict=%s", server, checked["verdict"])
        if checked["verdict"] == "rejected":
            return {
                "ok": False, "error": checked["error"],
                "field": checked.get("field"), "shares": checked.get("shares"),
            }
        return {"ok": True}

    async def _verify_smb_credentials(self, payload, *, password=None) -> dict:
        """Ask the server whether these credentials open this share.

        Shared by Test Connection and by both write paths, because a save that
        the server would reject is worth stopping at the modal, where the
        fields are still on screen and the fix is one edit away. It only ever
        blocks on a definite no: see the mount service for why "unknown" has to
        stay permissive.
        """
        share = {
            "server": str(payload.get("server") or "").strip(),
            "share": str(payload.get("share") or "").strip(),
            "username": str(payload.get("username") or "").strip(),
            "domain": str(payload.get("domain") or "").strip(),
        }
        secret = password if password is not None else str(payload.get("password") or "")
        checked = await asyncio.to_thread(
            self.smb_mount_service.verify_credentials, share, secret
        )
        if checked.get("verdict") == "rejected":
            checked["field"] = "share" if checked.get("error") == "share_not_found" else "password"
            if checked["error"] == "share_not_found":
                checked["shares"] = await asyncio.to_thread(
                    self.smb_mount_service.list_server_shares, share, secret
                )
        return checked

    async def add_smb_share(self, payload):
        if not isinstance(payload, dict):
            return {"ok": False, "error": "invalid_payload"}

        await self._rehydrate_smb_shares()
        on_disk = await asyncio.to_thread(self.smb_mount_service.read_disk_state)
        extra_slugs = {r["slug"] for r in on_disk if r.get("slug")}

        validated = self.smb_shares_store.validate_new(payload, extra_taken_slugs=extra_slugs)
        if not validated.get("ok"):
            return validated

        share = validated["share"]
        password = str(payload.get("password") or "")

        checked = await self._verify_smb_credentials(payload)
        if checked["verdict"] == "rejected":
            self._smb_debug("add rejected by the server: %s", checked["error"])
            return {
                "ok": False, "error": checked["error"],
                "field": checked.get("field"), "shares": checked.get("shares"),
            }

        self._smb_debug(
            "add slug=%s //%s/%s vers=%s soft=%s hasPassword=%s",
            share["slug"], share["server"], share["share"],
            share["vers"], share["softMount"], share["hasPassword"],
        )
        created = await asyncio.to_thread(self.smb_mount_service.create, share, password)
        if not created.get("ok"):
            return created

        stored = self.smb_shares_store.put(share)
        if not stored.get("ok"):
            await asyncio.to_thread(self.smb_mount_service.teardown, share, force=True)
            return stored

        enabled = await asyncio.to_thread(self.smb_mount_service.set_enabled, share, True)
        state = await asyncio.to_thread(
            self.smb_mount_service.status_for, share, probe=True
        )
        self._smb_debug(
            "add slug=%s stored, enable ok=%s error=%s, status=%s",
            share["slug"], enabled.get("ok"), enabled.get("error"), state["status"],
        )
        return {"ok": True, "share": self._decorate(share, state)}

    async def update_smb_share(self, share_id, payload):
        existing = self.smb_shares_store.get_by_id(share_id)
        if existing is None:
            return {"ok": False, "error": "not_found"}

        validated = self.smb_shares_store.validate_update(existing, payload)
        if not validated.get("ok"):
            return validated

        share = validated["share"]
        raw_password = payload.get("password")
        password = None if raw_password in (None, "") else str(raw_password)
        clear_password = bool(payload.get("clearPassword"))
        if clear_password:
            share["hasPassword"] = False
        elif password is not None:
            share["hasPassword"] = True

        effective = "" if clear_password else password
        if effective is None:
            effective = await asyncio.to_thread(
                self.smb_mount_service.saved_password, share["slug"]
            )
        checked = await self._verify_smb_credentials(share, password=effective)
        if checked["verdict"] == "rejected":
            self._smb_debug("update rejected by the server: %s", checked["error"])
            self.smb_mount_service.note_mount_failure(share["slug"], checked["error"])
            return {
                "ok": False, "error": checked["error"],
                "field": checked.get("field"), "shares": checked.get("shares"),
            }

        self._smb_debug(
            "update slug=%s //%s/%s vers=%s soft=%s passwordChanged=%s cleared=%s",
            share["slug"], share["server"], share["share"], share["vers"],
            share["softMount"], password is not None, clear_password,
        )
        updated = await asyncio.to_thread(
            self.smb_mount_service.update,
            share,
            password=password,
            clear_password=clear_password,
        )
        if not updated.get("ok"):
            return updated

        stored = self.smb_shares_store.put(share)
        if not stored.get("ok"):
            return stored

        state = await asyncio.to_thread(self.smb_mount_service.status_for, share, probe=True)
        return {"ok": True, "share": self._decorate(share, state)}

    async def set_smb_share_enabled(self, share_id, enabled):
        share = self.smb_shares_store.get_by_id(share_id)
        if share is None:
            return {"ok": False, "error": "not_found"}

        result = await asyncio.to_thread(
            self.smb_mount_service.set_enabled, share, bool(enabled)
        )
        state = await asyncio.to_thread(self.smb_mount_service.status_for, share, probe=True)
        self._smb_debug(
            "setEnabled slug=%s -> %s: ok=%s error=%s status=%s",
            share["slug"], bool(enabled), result.get("ok"), result.get("error"), state["status"],
        )
        if not result.get("ok"):
            return {"ok": False, "error": result.get("error", "generic"), "status": state["status"]}
        return {"ok": True, "status": state["status"]}

    async def delete_smb_share(self, share_id, force: bool = False):
        share = self.smb_shares_store.get_by_id(share_id)
        if share is None:
            return {"ok": False, "error": "not_found"}

        result = await asyncio.to_thread(
            self.smb_mount_service.teardown, share, force=bool(force)
        )
        self._smb_debug(
            "delete slug=%s force=%s -> ok=%s error=%s blockedBy=%s",
            share["slug"], bool(force), result.get("ok"),
            result.get("error"), result.get("blockedBy"),
        )
        if not result.get("ok"):
            return result

        return self.smb_shares_store.delete(share_id)

    def _desktop_link_name(self, share: dict, taken: set) -> str:
        """A display name, made safe to be a filename, kept unique in the folder.

        Names are only validated against control characters when they're saved,
        so a slash is a perfectly legal thing to call a mount and an illegal
        thing to call a file. Leading dots go too, since a link named ".NAS"
        would be created and then be invisible in the file manager, which reads
        as the button having done nothing.
        """
        name = str(share.get("name") or "").replace("/", "-").replace("\\", "-")
        name = name.strip().strip(".").strip()
        if not name:
            name = share["slug"]

        candidate = name
        suffix = 2
        while candidate.casefold() in taken:
            candidate = f"{name} ({suffix})"
            suffix += 1
        taken.add(candidate.casefold())
        return candidate

    def _rebuild_desktop_links(self) -> dict:
        desktop = self.user_home / "Desktop"
        folder = desktop / DESKTOP_LINKS_FOLDER

        made_desktop = not desktop.exists()
        try:
            folder.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            decky.logger.error("smb: couldn't make %s (%s)", folder, exc)
            return {"ok": False, "error": "folder"}
        if made_desktop:
            chown_to_data_owner(desktop)
        chown_to_data_owner(folder)

        try:
            for entry in folder.iterdir():
                if entry.is_symlink():
                    entry.unlink()
        except OSError as exc:
            decky.logger.error("smb: couldn't clear %s (%s)", folder, exc)
            return {"ok": False, "error": "folder"}

        taken = set()
        linked = 0
        for share in self.smb_shares_store.list_shares():
            target = self.smb_mount_service.mount_point(share["slug"])
            link = folder / self._desktop_link_name(share, taken)
            try:
                link.symlink_to(target, target_is_directory=True)
            except OSError as exc:
                decky.logger.error("smb: couldn't link %s (%s)", link, exc)
                continue
            lchown_to_data_owner(link)
            linked += 1

        decky.logger.info("smb: %d desktop link(s) in %s", linked, folder)
        return {"ok": True, "linked": linked}

    async def link_smb_mounts_to_desktop(self):
        return await asyncio.to_thread(self._rebuild_desktop_links)
