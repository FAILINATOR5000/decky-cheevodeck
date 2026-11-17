import threading
from pathlib import Path

import decky
import multiplayer_session as session

SYSTEMS = {session.GAMECUBE_SYSTEM: "gamecube", session.WII_SYSTEM: "wii"}
INSTALLS = ("flatpak", "appimage")


def mapping_system(system_id: int) -> str:
    return SYSTEMS.get(system_id, "")


def takes_mappings(system_id: int, emulator: str, install: str) -> bool:
    return bool(mapping_system(system_id)) and emulator == "dolphin" and install in INSTALLS


class DolphinGameMappings:
    def __init__(self, *, store, mappings_store, settings_store, apply, user_home):
        self._store = store
        self._settings_store = settings_store
        self._mappings = mappings_store
        self._apply = apply
        self._home = Path(user_home)
        self._lock = threading.Lock()

    def live_ids(self) -> set:
        return {mapping["id"] for mapping in self._mappings.load_all().get("mappings", [])}

    def mappings_for(self, system: str) -> list:
        return [mapping for mapping in self._mappings.load_all().get("mappings", []) if mapping.get("system") == system]

    def slots(self, game_id: int) -> dict:
        return self._store.get(game_id, self.live_ids())

    def set_slot(self, game_id: int, slot: str, mapping_id: str):
        return self._store.set(game_id, slot, mapping_id, self.live_ids())

    def apply(self, game_id: int, system_id: int, install: str, slot: str) -> bool:
        with self._lock:
            system = mapping_system(system_id)
            config = session.dolphin_config(self._home, install) if install in INSTALLS else None
            if not system or config is None:
                return False
            mappings = {mapping["id"]: mapping for mapping in self._mappings.load_all().get("mappings", [])}
            mapping_id = self._store.get(game_id, set(mappings))[slot]
            if not mapping_id:
                self._debug("game %s has no %s mapping", game_id, slot)
                return False
            if mappings[mapping_id].get("system") != system:
                self._debug("game %s's %s mapping is for the other console", game_id, slot)
                return False
            result = self._apply(mapping_id, [config.parent])
            if not result.get("ok"):
                decky.logger.info("dolphin mappings: launching game %s without its %s mapping (%s)", game_id, slot,
                                  result.get("error", "failed"))
                return False
            decky.logger.info("dolphin mappings: applied game %s's %s mapping to the %s install", game_id, slot,
                              install)
            return True

    def _debug(self, message: str, *args) -> None:
        try:
            on = self._settings_store.get_debug_logging(self._settings_store.load_config())
        except Exception:
            on = False
        if on:
            decky.logger.info("dolphin mappings: " + message, *args)
