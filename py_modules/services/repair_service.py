import os

import decky

from dolphin_ini import DOLPHIN_FLATPAK_APP_ID


_DOLPHIN_CHAINS = (
    (".var", "app", DOLPHIN_FLATPAK_APP_ID, "config", "dolphin-emu"),
    (".config", "dolphin-emu"),
)


class RepairService:
    """The every-boot pass that puts things back the way they should be.

    Runs once when the plugin loads, from Plugin._main, alongside the cache
    maintenance sweep it is modelled on. Its job is anything that was written
    correctly at the time and has since gone stale: a launcher carrying an old
    label, a file left behind by a feature that moved, a value stored in a
    shape the current code no longer writes.

    There is no patch level, deliberately. Each repair decides for itself
    whether it needs to act, which makes the check its own record, so nothing
    has to remember whether it ran. That also makes the whole thing
    self-healing rather than migrate-once: a restored backup or a factory reset
    gets fixed again on the next boot, where a version stamp would look at its
    counter and conclude the work was already done.

    Every repair is wrapped on its own. One failing must not skip the rest, and
    none of it may stop the plugin from loading. A repair is housekeeping, and
    housekeeping that takes the panel down with it is worse than the mess.
    """

    def __init__(self, *, update_checker_service, memories_store, settings_store, user_home):
        self._update_checker_service = update_checker_service
        self._memories_store = memories_store
        self._settings_store = settings_store
        self._user_home = user_home

    def run_startup_repairs(self) -> dict:
        """Run every repair in turn and report which ones did anything.

        Returns the slugs of the repairs that actually changed something, so a
        boot with nothing to do returns an empty list and logs nothing at all.
        """
        fixed = []

        try:
            if self._update_checker_service.refresh_desktop_launcher():
                fixed.append("desktop_launcher")
        except Exception as e:
            decky.logger.warning(
                "repair: desktop launcher refresh failed: %s",
                type(e).__name__,
            )

        try:
            if self._memories_store.rebuild_games_index():
                fixed.append("memories_games_index")
        except Exception as e:
            decky.logger.warning(
                "repair: memories games index rebuild failed: %s",
                type(e).__name__,
            )

        try:
            if self._settings_store.reset_outdated_quick_menu_shortcuts():
                fixed.append("quick_menu_shortcuts")
        except Exception as e:
            decky.logger.warning(
                "repair: quick menu shortcuts reset failed: %s",
                type(e).__name__,
            )

        try:
            if self._settings_store.reset_outdated_shortcut_bindings():
                fixed.append("shortcut_bindings")
        except Exception as e:
            decky.logger.warning(
                "repair: shortcut bindings reset failed: %s",
                type(e).__name__,
            )

        try:
            if self._hand_back_dolphin_folders():
                fixed.append("dolphin_folders")
        except Exception as e:
            decky.logger.warning(
                "repair: handing back Dolphin's folders failed: %s",
                type(e).__name__,
            )

        if fixed:
            decky.logger.info("repair: fixed %s", ", ".join(fixed))
        return {"fixed": fixed}

    def _hand_back_dolphin_folders(self) -> bool:
        if os.geteuid() != 0:
            return False
        owner = os.stat(self._user_home)
        if owner.st_uid == 0:
            return False
        changed = False
        for chain in _DOLPHIN_CHAINS:
            fd = os.open(self._user_home, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
            try:
                for name in chain:
                    try:
                        inner = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
                    except OSError:
                        break
                    os.close(fd)
                    fd = inner
                    if os.fstat(fd).st_uid == 0:
                        os.fchown(fd, owner.st_uid, owner.st_gid)
                        changed = True
            except OSError as e:
                decky.logger.warning(
                    "repair: couldn't hand back a Dolphin folder under %s: %s",
                    "/".join(chain[:2]), type(e).__name__,
                )
            finally:
                os.close(fd)
        return changed
