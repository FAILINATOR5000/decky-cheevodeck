import asyncio
from datetime import datetime, timezone

import decky
from notifications import push_debug_notification, emit_notification, NOTIFICATION_EVENT
from services.update_checker_service import GITHUB_OWNER, GITHUB_REPO, installed_version, parse_version

from mixins._context import PluginContext


class NotificationsMixin(PluginContext):

    async def save_show_bell_dot(self, show_bell_dot: bool):
        value = self.settings_store.update_show_bell_dot(show_bell_dot)

        return {
            "ok": True,
            "showBellDot": value,
        }

    async def save_do_not_disturb(self, do_not_disturb: bool):
        value = self.settings_store.update_do_not_disturb(do_not_disturb)

        return {
            "ok": True,
            "doNotDisturb": value,
        }

    async def save_do_not_disturb_disables_dot(self, disables_dot: bool):
        value = self.settings_store.update_do_not_disturb_disables_dot(disables_dot)

        return {
            "ok": True,
            "doNotDisturbDisablesDot": value,
        }

    async def save_do_not_disturb_disables_toast(self, disables_toast: bool):
        value = self.settings_store.update_do_not_disturb_disables_toast(disables_toast)

        return {
            "ok": True,
            "doNotDisturbDisablesToast": value,
        }

    async def get_notifications(self):
        return await asyncio.to_thread(self.notifications_store.get_payload)

    async def mark_notifications_seen(self):
        last_seen = await asyncio.to_thread(self.notifications_store.mark_seen)

        return {
            "ok": True,
            "lastSeenAt": last_seen,
        }

    async def clear_all_notifications(self):
        await asyncio.to_thread(self.notifications_store.clear_all)
        await decky.emit(NOTIFICATION_EVENT, {"toast": False})

        return {"ok": True}

    async def get_archived_notifications(self):
        return await asyncio.to_thread(self.notifications_archive_store.get_payload)

    async def archive_notification(self, notification):
        return await asyncio.to_thread(
            self.notifications_archive_store.archive, notification
        )

    async def unarchive_notification(self, notification_id: str):
        return await asyncio.to_thread(
            self.notifications_archive_store.unarchive, notification_id
        )

    async def clear_archived_notifications(self):
        await asyncio.to_thread(self.notifications_archive_store.clear)

        return {"ok": True}

    async def fire_test_debug_notification(self):
        await asyncio.to_thread(
            push_debug_notification,
            store=self.notifications_store,
            settings_store=self.settings_store,
            event_loop=self._asyncio_loop,
            title="Test Notification",
            body="If you can see this, the notifications pipeline is working.",
            toast_body="Pipeline OK",
        )

        return {"ok": True}

    async def fire_test_comment_notification(self):
        cfg = self.settings_store.load_config()
        poster = str(cfg.get("username") or "").strip() or "Tester"
        ulid = str(cfg.get("activeUlid") or "").strip()

        paragraph = (
            "This is a test comment fired from the Advanced test hooks to check "
            "how a long discussion post renders in the notifications list. It "
            "should clamp to a fixed number of lines on the card, show the "
            "Press A to view more hint underneath, and open the full text in the "
            "view modal when you press it. "
        )
        body = (paragraph * 12).strip()

        thread_title = "Test Discussion Thread"
        url = "https://retroachievements.org/game/1/comments"
        submitted = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"

        def _append_and_emit():
            self.notifications_store.append({
                "type": "commentTracker",
                "kind": "actionable",
                "title": "%s posted in %s" % (poster, thread_title),
                "body": body,
                "iconSource": "avatar",
                "iconGameId": None,
                "iconImageIcon": None,
                "target": {"view": "external", "gameId": 1, "url": url},
                "source": "notifications",
                "meta": {
                    "username": poster,
                    "commentText": body,
                    "submitted": submitted,
                    "ulid": ulid,
                    "threadTitle": thread_title,
                    "kind": "game",
                    "achievementId": 0,
                    "badgeName": "",
                    "url": url,
                },
            })
            emit_notification(
                ntype="commentTracker",
                toast_title="%s posted in %s" % (poster, thread_title),
                toast_line="Test comment notification",
                settings_store=self.settings_store,
                event_loop=self._asyncio_loop,
            )

        await asyncio.to_thread(_append_and_emit)

        return {"ok": True, "chars": len(body)}

    async def fire_test_update_notification(self):
        """The update notification, without waiting for a real release.

        Deliberately does not call the checker's _maybe_notify, tempting as
        that is. That path stamps updateLastNotifiedTag, so a test firing
        "0.9.0" would silently swallow the real notification on the day 0.9.0
        actually ships. Nothing here writes any state.

        The version is the installed one with the minor bumped, so it reads
        like a real release rather than a placeholder, and the target matches
        what the checker sends -- which is what makes pressing the card land
        on the About page the same way a real one does.
        """
        parsed = parse_version(installed_version()) or (0, 0, 0)
        numbers = list(parsed) + [0] * (3 - len(parsed))
        numbers[1] += 1
        numbers[2] = 0
        version = ".".join(str(n) for n in numbers[:3])

        url = "https://github.com/%s/%s/releases/latest" % (GITHUB_OWNER, GITHUB_REPO)

        def _append_and_emit():
            self.notifications_store.append({
                "type": "system",
                "kind": "actionable",
                "iconSource": "none",
                "title": "CheevoDeck Update Available",
                "body": "Version %s available." % version,
                "source": "notifications",
                "target": {"view": "external", "url": url},
                "meta": {"version": version},
            })
            emit_notification(
                ntype="system",
                title_key="CheevoDeck Update Available",
                line_key="Version {{version}} available.",
                template_vars={"version": version},
                settings_store=self.settings_store,
                event_loop=self._asyncio_loop,
            )

        await asyncio.to_thread(_append_and_emit)

        return {"ok": True, "version": version}

    async def fire_test_tracked_set_completion(self):
        return await asyncio.to_thread(
            self.tracked_sets_monitor_service.fire_test_completion
        )

    async def inject_fake_self_name(self):
        cfg = self.settings_store.heal_active_username("Tester")
        name = str((cfg or {}).get("username") or "").strip()

        return {
            "ok": True,
            "username": name,
        }

    async def inject_fake_friend_name(self):
        cfg = self.settings_store.load_config()
        active_ulid = str(cfg.get("activeUlid") or "").strip()
        self_name = str(cfg.get("username") or "").strip().lower()

        with self.cache_store.friends_lock():
            wrapper = self.cache_store.load_friends()
            payload = wrapper.get("payload") or {}
            rows = list(payload.get("friends") or [])

            target_index = self._first_real_friend_index(rows, active_ulid, self_name)
            if target_index < 0:
                return {
                    "ok": True,
                    "renamed": False,
                    "username": None,
                }

            renamed_row = dict(rows[target_index])
            renamed_row["username"] = "FriendTester"
            rows[target_index] = renamed_row

            next_payload = dict(payload)
            next_payload["friends"] = rows
            self.cache_store.save_friends(next_payload, wrapper.get("meta") or {})

        return {
            "ok": True,
            "renamed": True,
            "username": "FriendTester",
        }

    def _first_real_friend_index(self, rows, active_ulid, self_name):
        for index, row in enumerate(rows):
            row_ulid = str(row.get("ulid") or "").strip()
            row_name = str(row.get("username") or "").strip()
            is_self = (active_ulid and row_ulid == active_ulid) or (
                not row_ulid and row_name.lower() == self_name
            )
            if is_self or not row_name:
                continue
            return index
        return -1

    def _log_notify_toggle(self, key: str, value) -> None:
        decky.logger.info("notification toggle: %s -> %s", key, bool(value))

    async def save_notify_note_reminder_enabled(self, value: bool):
        stored = self.settings_store.update_notify_note_reminder_enabled(value)
        self._log_notify_toggle("notifyNoteReminderEnabled", stored)
        return {
            "ok": True,
            "notifyNoteReminderEnabled": stored,
        }

    async def save_notify_note_reminder_toast(self, value: bool):
        stored = self.settings_store.update_notify_note_reminder_toast(value)
        self._log_notify_toggle("notifyNoteReminderToast", stored)
        return {
            "ok": True,
            "notifyNoteReminderToast": stored,
        }

    async def save_notify_tracked_set_enabled(self, value: bool):
        stored = self.settings_store.update_notify_tracked_set_enabled(value)
        self._log_notify_toggle("notifyTrackedSetEnabled", stored)
        return {
            "ok": True,
            "notifyTrackedSetEnabled": stored,
        }

    async def save_notify_tracked_set_toast(self, value: bool):
        stored = self.settings_store.update_notify_tracked_set_toast(value)
        self._log_notify_toggle("notifyTrackedSetToast", stored)
        return {
            "ok": True,
            "notifyTrackedSetToast": stored,
        }

    async def save_notify_comment_tracker_enabled(self, value: bool):
        stored = self.settings_store.update_notify_comment_tracker_enabled(value)
        self._log_notify_toggle("notifyCommentTrackerEnabled", stored)
        return {
            "ok": True,
            "notifyCommentTrackerEnabled": stored,
        }

    async def save_notify_comment_tracker_toast(self, value: bool):
        stored = self.settings_store.update_notify_comment_tracker_toast(value)
        self._log_notify_toggle("notifyCommentTrackerToast", stored)
        return {
            "ok": True,
            "notifyCommentTrackerToast": stored,
        }

    async def save_notify_wall_enabled(self, value: bool):
        stored = self.settings_store.update_notify_wall_enabled(value)
        self._log_notify_toggle("notifyWallEnabled", stored)
        return {
            "ok": True,
            "notifyWallEnabled": stored,
        }

    async def save_notify_wall_toast(self, value: bool):
        stored = self.settings_store.update_notify_wall_toast(value)
        self._log_notify_toggle("notifyWallToast", stored)
        return {
            "ok": True,
            "notifyWallToast": stored,
        }

    async def save_notify_system_enabled(self, value: bool):
        stored = self.settings_store.update_notify_system_enabled(value)
        self._log_notify_toggle("notifySystemEnabled", stored)
        return {
            "ok": True,
            "notifySystemEnabled": stored,
        }

    async def save_notify_system_toast(self, value: bool):
        stored = self.settings_store.update_notify_system_toast(value)
        self._log_notify_toggle("notifySystemToast", stored)
        return {
            "ok": True,
            "notifySystemToast": stored,
        }

    async def save_notify_tracked_enabled(self, value: bool):
        stored = self.settings_store.update_notify_tracked_enabled(value)
        self._log_notify_toggle("notifyTrackedEnabled", stored)
        return {
            "ok": True,
            "notifyTrackedEnabled": stored,
        }

    async def save_notify_tracked_toast(self, value: bool):
        stored = self.settings_store.update_notify_tracked_toast(value)
        self._log_notify_toggle("notifyTrackedToast", stored)
        return {
            "ok": True,
            "notifyTrackedToast": stored,
        }

    async def save_notify_social_unlock_enabled(self, value: bool):
        stored = self.settings_store.update_notify_social_unlock_enabled(value)
        self._log_notify_toggle("notifySocialUnlockEnabled", stored)
        return {
            "ok": True,
            "notifySocialUnlockEnabled": stored,
        }

    async def save_notify_social_unlock_toast(self, value: bool):
        stored = self.settings_store.update_notify_social_unlock_toast(value)
        self._log_notify_toggle("notifySocialUnlockToast", stored)
        return {
            "ok": True,
            "notifySocialUnlockToast": stored,
        }

    async def save_notify_near_you_enabled(self, value: bool):
        stored = self.settings_store.update_notify_near_you_enabled(value)
        self._log_notify_toggle("notifyNearYouEnabled", stored)
        return {
            "ok": True,
            "notifyNearYouEnabled": stored,
        }

    async def save_notify_near_you_toast(self, value: bool):
        stored = self.settings_store.update_notify_near_you_toast(value)
        self._log_notify_toggle("notifyNearYouToast", stored)
        return {
            "ok": True,
            "notifyNearYouToast": stored,
        }

    async def save_notify_debug_enabled(self, value: bool):
        stored = self.settings_store.update_notify_debug_enabled(value)
        self._log_notify_toggle("notifyDebugEnabled", stored)
        return {
            "ok": True,
            "notifyDebugEnabled": stored,
        }

    async def save_notify_debug_toast(self, value: bool):
        stored = self.settings_store.update_notify_debug_toast(value)
        self._log_notify_toggle("notifyDebugToast", stored)
        return {
            "ok": True,
            "notifyDebugToast": stored,
        }
