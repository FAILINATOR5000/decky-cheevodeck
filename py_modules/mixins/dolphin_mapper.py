import asyncio
import os
from pathlib import Path

import decky
import dolphin_ini
import dolphin_seed

from dolphin_ini import DOLPHIN_FLATPAK_APP_ID
from mixins._context import PluginContext


STEAMDECK_CONTROLLER_VID = "28de"
STEAMDECK_CONTROLLER_PID = "1205"
USB_DEVICES_DIR = Path("/sys/bus/usb/devices")
USB_DRIVER_DIR = Path("/sys/bus/usb/drivers/usb")

_chown_warned = False


class DolphinMapperMixin(PluginContext):
    """IPC surface for the Dolphin Mapper utility: mapping CRUD, the generator
    inject, the Bluetooth-passthrough toggle (the one knob that edits Dolphin.ini),
    and the persisted A-button list mode (settings.json only, not Dolphin's config).
    None of these touch RA, so there's no _ra_slot() here; the file writes run
    off-thread to keep the event loop responsive."""

    def _dolphin_config_targets(self):
        home = self.user_home
        appimage_config = home / ".config" / "dolphin-emu"
        flatpak_root = home / ".var" / "app" / DOLPHIN_FLATPAK_APP_ID
        flatpak_config = flatpak_root / "config" / "dolphin-emu"
        return [
            {"name": "appimage", "marker": appimage_config, "config_dir": appimage_config},
            {"name": "flatpak", "marker": flatpak_root, "config_dir": flatpak_config},
        ]

    def _chown_to_user(self, path):
        global _chown_warned

        try:
            st = self.user_home.stat()
            os.chown(path, st.st_uid, st.st_gid)
        except OSError as exc:
            if not _chown_warned:
                _chown_warned = True
                decky.logger.warning(
                    "dolphin mapper: chown back to the user failed (%s: %s) for %s; "
                    "further failures this session stay quiet",
                    type(exc).__name__,
                    exc,
                    path,
                )

    def _detected_dolphin_targets(self):
        targets = self._dolphin_config_targets()
        detected = [t for t in targets if t["marker"].exists()]
        return detected if detected else [targets[0]]

    async def list_dolphin_mappings(self):
        self._seed_dolphin_mappings_if_needed()
        return self.dolphin_mappings_store.load_all()

    def _seed_dolphin_mappings_if_needed(self) -> None:
        cfg = self.settings_store.load_config()
        if self.settings_store.get_dolphin_mappings_seeded(cfg):
            return
        self.dolphin_mappings_store.seed(dolphin_seed.build_seed_mappings())
        self.settings_store.mark_dolphin_mappings_seeded()

    async def reset_dolphin_mappings(self):
        self.dolphin_mappings_store.clear_all()
        result = self.dolphin_mappings_store.seed(dolphin_seed.build_seed_mappings())
        self.settings_store.mark_dolphin_mappings_seeded()
        return result

    async def clear_dolphin_mappings(self):
        self.settings_store.mark_dolphin_mappings_seeded()
        return self.dolphin_mappings_store.clear_all()

    async def save_dolphin_mapping(self, mapping):
        return self.dolphin_mappings_store.upsert(mapping)

    async def delete_dolphin_mapping(self, mapping_id):
        return self.dolphin_mappings_store.delete(mapping_id)

    async def reorder_dolphin_mappings(self, ordered_ids):
        return self.dolphin_mappings_store.reorder(ordered_ids)

    async def apply_dolphin_mapping(self, mapping_id):
        return await asyncio.to_thread(self._apply_dolphin_mapping_sync, mapping_id)

    def _apply_dolphin_mapping_sync(self, mapping_id):
        data = self.dolphin_mappings_store.load_all()
        mapping = next((m for m in data["mappings"] if m["id"] == mapping_id), None)
        if mapping is None:
            return {"ok": False, "error": "not_found"}

        if self.emulator_login_sync_service.is_dolphin_running():
            return {"ok": False, "error": "dolphin_running"}

        system = mapping["system"]
        balance_board = self.settings_store.get_dolphin_balance_board(
            self.settings_store.load_config()
        )
        content = dolphin_ini.generate_ini(
            str(self.dolphin_defaults_dir),
            mapping,
            balance_board=balance_board,
        )
        filename = dolphin_ini.output_filename(system)

        other = dolphin_ini.other_system(system)
        other_content = dolphin_ini.generate_empty_ini(other)
        other_filename = dolphin_ini.output_filename(other)

        si_devices = dolphin_ini.gc_si_devices(mapping)

        written = []
        for target in self._detected_dolphin_targets():
            config_dir = target["config_dir"]
            config_dir.mkdir(parents=True, exist_ok=True)
            self._chown_to_user(config_dir)
            main_path = config_dir / filename
            other_path = config_dir / other_filename
            main_path.write_text(content, encoding="utf-8")
            other_path.write_text(other_content, encoding="utf-8")
            self._chown_to_user(main_path)
            self._chown_to_user(other_path)

            dolphin_ini_path = config_dir / "Dolphin.ini"
            for port, value in enumerate(si_devices):
                self._set_ini_value(
                    dolphin_ini_path,
                    "Core",
                    "SIDevice{}".format(port),
                    value,
                )

            written.append({
                "name": target["name"],
                "dir": str(config_dir),
                "file": filename,
                "cleared": other_filename,
                "ports": list(si_devices),
            })

        return {"ok": True, "file": filename, "cleared": other_filename, "targets": written}

    def _read_sysfs(self, path):
        try:
            return path.read_text().strip()
        except (OSError, ValueError):
            return None

    def _find_deck_controller_path(self):
        """The Deck built-in controller's USB bus path (e.g. "3-3"), found by
        VID/PID. Cached, so we can still re-bind after an unbind drops it from
        the scan. Returns None on non-Deck hardware."""
        if USB_DEVICES_DIR.exists():
            for dev in USB_DEVICES_DIR.iterdir():
                vid = self._read_sysfs(dev / "idVendor")
                if vid != STEAMDECK_CONTROLLER_VID:
                    continue
                pid = self._read_sysfs(dev / "idProduct")
                if pid == STEAMDECK_CONTROLLER_PID:
                    self._deck_controller_usb_path = dev.name
                    return dev.name
        return getattr(self, "_deck_controller_usb_path", None)

    def _deck_controller_bound(self, usb_path):
        return (USB_DRIVER_DIR / usb_path).exists()

    def _deck_controller_status(self):
        path = self._find_deck_controller_path()
        if not path:
            return {"present": False, "disabled": False}
        return {
            "present": True,
            "disabled": not self._deck_controller_bound(path),
        }

    def _write_usb_action(self, action, usb_path):
        target = USB_DRIVER_DIR / action
        try:
            target.write_text(usb_path)
            return True, None
        except Exception as e:
            return False, "{}: {}".format(type(e).__name__, e)

    def _restore_deck_controller_safe(self):
        try:
            path = getattr(self, "_deck_controller_usb_path", None) or self._find_deck_controller_path()
            if path and not self._deck_controller_bound(path):
                self._write_usb_action("bind", path)
        except Exception:
            pass

    async def get_deck_controller_status(self):
        return await asyncio.to_thread(self._deck_controller_status)

    async def set_deck_controller_disabled(self, disabled):
        return await asyncio.to_thread(self._set_deck_controller_disabled_sync, bool(disabled))

    def _set_deck_controller_disabled_sync(self, disabled):
        path = self._find_deck_controller_path()
        if not path:
            return {"ok": False, "error": "no_deck_controller", "status": self._deck_controller_status()}

        if disabled:
            ok, detail = self._write_usb_action("unbind", path)
        else:
            ok, detail = self._write_usb_action("bind", path)

        status = self._deck_controller_status()
        if not ok:
            return {"ok": False, "error": "write_failed", "detail": detail, "path": path, "status": status}
        return {"ok": True, "status": status}

    async def set_dolphin_bluetooth_passthrough(self, enabled):
        return await asyncio.to_thread(self._set_dolphin_bluetooth_passthrough_sync, bool(enabled))

    def _set_dolphin_bluetooth_passthrough_sync(self, enabled):
        if self.emulator_login_sync_service.is_dolphin_running():
            current = self.settings_store.get_dolphin_bluetooth_passthrough(
                self.settings_store.load_config()
            )
            return {"ok": False, "error": "dolphin_running", "dolphinBluetoothPassthrough": current}

        value = self.settings_store.update_dolphin_bluetooth_passthrough(enabled)
        flag = "True" if value else "False"
        for target in self._detected_dolphin_targets():
            config_dir = target["config_dir"]
            config_dir.mkdir(parents=True, exist_ok=True)
            self._chown_to_user(config_dir)
            self._set_ini_value(
                config_dir / "Dolphin.ini",
                "BluetoothPassthrough",
                "Enabled",
                flag,
            )
        return {"ok": True, "dolphinBluetoothPassthrough": value}

    async def set_dolphin_continuous_scanning(self, enabled):
        return await asyncio.to_thread(self._set_dolphin_continuous_scanning_sync, bool(enabled))

    def _set_dolphin_continuous_scanning_sync(self, enabled):
        if self.emulator_login_sync_service.is_dolphin_running():
            current = self.settings_store.get_dolphin_continuous_scanning(
                self.settings_store.load_config()
            )
            return {"ok": False, "error": "dolphin_running", "dolphinContinuousScanning": current}

        value = self.settings_store.update_dolphin_continuous_scanning(enabled)
        flag = "True" if value else "False"
        for target in self._detected_dolphin_targets():
            config_dir = target["config_dir"]
            config_dir.mkdir(parents=True, exist_ok=True)
            self._chown_to_user(config_dir)
            self._set_ini_value(
                config_dir / "Dolphin.ini",
                "Core",
                "WiimoteContinuousScanning",
                flag,
            )
        return {"ok": True, "dolphinContinuousScanning": value}

    async def set_dolphin_balance_board(self, enabled):
        return await asyncio.to_thread(self._set_dolphin_balance_board_sync, bool(enabled))

    def _set_dolphin_balance_board_sync(self, enabled):
        if self.emulator_login_sync_service.is_dolphin_running():
            current = self.settings_store.get_dolphin_balance_board(
                self.settings_store.load_config()
            )
            return {"ok": False, "error": "dolphin_running", "dolphinBalanceBoard": current}

        value = self.settings_store.update_dolphin_balance_board(enabled)
        source = "2" if value else "0"
        for target in self._detected_dolphin_targets():
            config_dir = target["config_dir"]
            config_dir.mkdir(parents=True, exist_ok=True)
            self._chown_to_user(config_dir)
            self._set_ini_value(
                config_dir / "WiimoteNew.ini",
                "BalanceBoard",
                "Source",
                source,
            )
        return {"ok": True, "dolphinBalanceBoard": value}

    async def save_dolphin_mapper_mode(self, mode):
        value = self.settings_store.update_dolphin_mapper_mode(mode)
        return {"ok": True, "dolphinMapperMode": value}

    async def save_dolphin_system_filter(self, value):
        return {
            "ok": True,
            "dolphinSystemFilter": self.settings_store.update_dolphin_system_filter(value),
        }

    async def save_dolphin_advanced_collapsed(self, value):
        return {
            "ok": True,
            "dolphinAdvancedCollapsed": self.settings_store.update_dolphin_advanced_collapsed(value),
        }

    async def save_dolphin_collapsed_tags(self, tags):
        return self.dolphin_mappings_store.set_collapsed_tags(tags)

    def _set_ini_value(self, path: Path, section: str, key: str, value: str) -> None:
        """Set `key = value` under `[section]` in a Dolphin .ini, preserving the
        rest of the file. Creates the key (and the section) if absent. Kept
        hand-rolled rather than configparser so we never reflow or lose the
        exact formatting Dolphin is picky about elsewhere."""
        lines = []
        if path.exists():
            lines = path.read_text(encoding="utf-8").splitlines()

        section_header = "[{}]".format(section)
        out = []
        in_section = False
        section_found = False
        key_written = False

        for line in lines:
            stripped = line.strip()
            is_header = stripped.startswith("[") and stripped.endswith("]")
            if is_header:
                if in_section and not key_written:
                    out.append("{} = {}".format(key, value))
                    key_written = True
                in_section = stripped == section_header
                if in_section:
                    section_found = True
                out.append(line)
                continue

            if in_section and "=" in stripped and stripped.split("=", 1)[0].strip() == key:
                if not key_written:
                    out.append("{} = {}".format(key, value))
                    key_written = True
                continue

            out.append(line)

        if in_section and not key_written:
            out.append("{} = {}".format(key, value))
            key_written = True

        if not section_found:
            if out and out[-1].strip() != "":
                out.append("")
            out.append(section_header)
            out.append("{} = {}".format(key, value))

        text = "\n".join(out)
        if not text.endswith("\n"):
            text += "\n"
        path.write_text(text, encoding="utf-8")
        self._chown_to_user(path)
