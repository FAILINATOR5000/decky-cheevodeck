import { t, type LanguageCode } from "../locales";
import { logError } from "./errors";
import { knownStreamSize } from "./streamPlay";

export const ROOM_ENDED = ["dropped", "timed_out", "closed", "network_changed"];

const PROBLEM_TEXT: Record<string, string> = {
    not_game_mode: "Only works in Game Mode",
    no_account: "Sign in to RetroAchievements first",
    cap_reached: "Leave this page and come back to look again",
    no_scan: "Run Cheevo Check first",
    not_in_results: "This game isn't in your Cheevo Check results",
    no_shortcut: "This game has no Steam shortcut of its own",
    no_emulator_shortcut: "Add this game, or {{emulator}} itself, to Steam as a non-Steam game.",
    emulator_missing: "{{emulator}} isn't installed anymore, but its Steam shortcut is still there. Put {{emulator}} back where the shortcut points, or remove the shortcut.",
    retroarch_first_run: "Open RetroArch once so it can set itself up, then press Fix It again.",
    no_play_core: "None of the installed RetroArch cores can run this game",
    rom_missing: "This game's file isn't where Cheevo Check last saw it. Run Cheevo Check again.",
    unsupported_emulator: "This emulator isn't supported",
    core_cant_couch: "{{core}} can't do Couch Play. Works with: {{works}}",
    no_couch_core: "No installed core for this system can do Couch Play",
    link_needs_gambatte: "Link Play needs Gambatte",
    link_needs_ppsspp: "Link Play needs PPSSPP",
    link_needs_gpsp: "Link Play needs gpSP. Install it in RetroArch (Main Menu → Online Updater → Core Downloader).",
    gpsp_too_old: "Link Play needs a newer gpSP. Update it in RetroArch (Online Updater → Update Installed Cores).",
    link_gba_cant_link: "gpSP can't link this game",
    link_no_game_code: "CheevoDeck can't read this game's code",
    link_needs_melondsds: "Link Play needs melonDS DS. Install it in RetroArch (Main Menu → Online Updater → Core Downloader).",
    melondsds_too_old: "Link Play needs melonDS DS 1.2.0 or newer",
    melondsds_dsi_mode: "Link Play needs DS mode in melonDS DS",
    melonds_standalone: "melonDS standalone has no RetroAchievements. A RetroArch shortcut with melonDS DS can link.",
    link_needs_dolphin: "Link Play needs Dolphin",
    link_gc_no_lan: "Link Play works with Mario Kart: Double Dash!!, Kirby Air Ride and 1080° Avalanche",
    dolphin_game_setting: "A Dolphin game setting for this game sets the network adapter",
    region_differs: "Your copy is from a different region than the host's",
    dolphin_flatpak_needed: "GameCube and Wii games need Dolphin's Flatpak installed for Cheevo Check",
    link_system: "Link Play works with Game Boy, Game Boy Color, Game Boy Advance, DS, PSP and GameCube games",
    ds_no_couch: "DS games can't do Couch Play. Use Link Play.",
    duckstation_no_multiplayer: "DuckStation can't do Couch Play. A RetroArch shortcut with Beetle PSX HW can.",
    pcsx2_no_multiplayer: "PCSX2 has no Link Play or Couch Play",
    override: "A RetroArch override for this game sets {{key}}",
    remap: "A RetroArch remap for this game sets the controller type",
    emudeck_netplay: "Turn off EmuDeck's NetPlay first",
    flatpak_permission: "The emulator can't read CheevoDeck's session files",
    saves_by_core: "Your RetroArch saves are sorted by core, so {{core}} can't see your save. Use {{shortcutCore}}.",
    other_game: "Close the running game first",
    rom_mismatch: "Your copy is a different version of the game from the host's. Couch Play needs the same version.",
    crc_mismatch: "Your copy matches the host's game but not their exact file. Couch Play on NES needs the exact same file.",
    link_gb_both: "Link Play needs a Game Boy game on both",
    link_needs_gambatte_both: "Link Play needs Gambatte on both devices",
    different_game: "The host is playing a different game",
    host_core_missing: "The host uses {{core}}, which isn't installed here. Install it in RetroArch (Main Menu → Online Updater → Core Downloader).",
    match_host_core: "The host uses {{core}}. Switch to it to join.",
    no_guests: "Waiting for players",
    nobody_ready: "Waiting for someone to ready up",
    unreadied_other_game: "You started another game, so you're not ready",
    not_lobby: "In-Game",
    room_gone: "That room is gone",
    no_room: "That room is gone",
    bad_code: "Wrong password",
    friends_only: "This room is for the host's friends only.",
    friends_off: "Turn on EZ Multiplayer Friends to host a Friend Only room.",
    locked_out: "Too many wrong passwords. Try again in a minute.",
    full: "That room is full",
    chat_refused: "Couldn't send that message",
    no_dolphin_emulator_shortcut: "Add Dolphin itself to Steam ROM Manager",
    dolphin_game_list: "Add {{folder}} to Dolphin's game list",
    dolphin_version_mismatch: "The host uses Dolphin {{version}}. Every device needs the same Dolphin version.",
    no_rmg_shortcut: "N64 Couch Play needs RMG itself in Steam. Add it with Steam ROM Manager.",
    rmg_version_mismatch: "The host uses RMG {{version}}. Every device needs the same RMG version.",
    rmg_server: "Couldn't start the N64 netplay server on this device",
    ppsspp_version_mismatch: "The host uses PPSSPP {{version}}. Every device needs the same PPSSPP version.",
    not_found: "No room found at that address",
    bad_address: "Not a valid address",
    host_gone: "Lost the host",
    host_waiting: "Lost the host. Waiting for it to come back...",
    dropped: "The host dropped you from the room",
    timed_out: "Your seat was freed while this device was away",
    closed: "The host closed the room",
    network_changed: "Your network changed. Host again.",
    args_dropped: "This shortcut didn't pass CheevoDeck's settings to the emulator",
    launch_failed: "The game didn't start. Try again. If it keeps happening, start it once from your library to check it runs.",
    shortcut_unread: "Steam didn't share this game's shortcut settings in time. Try again.",
    shortcut_unset: "Steam didn't accept CheevoDeck's settings for this game's shortcut. Try again.",
    shortcut_gone: "Steam can't find this game's shortcut anymore. Run Steam ROM Manager again.",
    host_start_failed: "The host's game didn't start. Ready up to try again.",
    seat_not_taken: "The host's game didn't let you in. Try again.",
    drop_in: "Players can join while you play",
    seated: "Close the room to change it",
    unavailable: "Couldn't open a room on this network",
    lobby_unreachable: "Couldn't reach the online lobby",
    no_lobby: "Set a lobby server in Options first",
    lan_only: "This game links over LAN, so it plays Local only.",
    invite_expired: "That invite expired",
    stream_not_set_up: "Stream Play needs Sunshine and Moonlight. Press Set Up Streaming below to install them (about {{size}}).",
    stream_one_console: "Stream Play isn't available for this system: its multiplayer needs one console per player.",
    sunshine_running: "Sunshine is already running on this device. Close it before hosting a Stream Play room.",
    stream_needs_update: "Streaming needs a CheevoDeck update.",
    sunshine_failed: "Streaming didn't start on this device. Try again. If it keeps happening, restart your device.",
    host_too_slow: "The host's internet connection is too slow to handle another connection.",
    stream_busy: "The streaming server is busy right now. Try again in a few minutes.",
    stream_unreachable: "Couldn't connect to the host's stream. Try Join & Play again."
};

const FIXABLE_TEXT: Record<string, string> = {
    link_needs_gpsp: "Link Play needs gpSP",
    gpsp_too_old: "Link Play needs a newer gpSP",
    link_needs_melondsds: "Link Play needs melonDS DS",
    host_core_missing: "The host uses {{core}}, which isn't installed here",
    no_dolphin_emulator_shortcut: "Couch Play needs Dolphin itself in Steam",
    no_rmg_shortcut: "N64 Couch Play needs RMG itself in Steam"
};

const WARNING_TEXT: Record<string, string> = {
    core_override: "Using {{core}} for this session. Your shortcut stays on {{shortcutCore}}.",
    saves_by_core: "Your RetroArch saves are sorted by core, so {{core}} won't see your usual save.",
    crc_mismatch: "Your ROM file differs from the host's. The game may desync.",
    version_mismatch: "Your RetroArch or core version differs from the host's.",
    revision_differs: "Your copy is a different version of the game from the host's.",
    game_differs: "Your game differs from the host's, so it may not link.",
    duckstation_switch: "DuckStation can't do Couch Play, and its saves won't carry over. {{core}} works, so this session uses it.",
    stream_player_two: "Player 2 in {{emulator}} isn't set to a controller, so your guests' controls won't reach the game. Set Player 2 to the second controller (SDL-1) in {{emulator}}'s controller settings.",
    core_build_differs: "Your {{core}} build differs from the host's. Update cores on every device (Main Menu → Online Updater → Update Installed Cores)."
};

const UNSIZED_SETUP = "Stream Play needs Sunshine and Moonlight. Press Set Up Streaming below to install them.";

export function problemText(language: LanguageCode, code: string, detail?: Record<string, string>): string {
    if (code === "stream_not_set_up") {
        const size = detail?.size && detail.size !== "?" ? detail.size : knownStreamSize();
        return size ? t(language, PROBLEM_TEXT.stream_not_set_up, { size }) : t(language, UNSIZED_SETUP);
    }
    const text = t(language, PROBLEM_TEXT[code] ?? PROBLEM_TEXT.launch_failed, detail);
    if (text.includes("{{")) {
        logError(`multiplayer: ${code} left a placeholder unfilled`, new Error(text));
    }
    return text;
}

export function fixableProblemText(language: LanguageCode, code: string, detail?: Record<string, string>): string {
    const text = FIXABLE_TEXT[code];
    return text ? t(language, text, detail) : problemText(language, code, detail);
}

const STREAM_HOST_TEXT: Record<string, string> = {
    no_scan: "Run Cheevo Check first to host",
    not_in_results: "To host, this game needs to be in your Cheevo Check results",
    no_shortcut: "To host, this game needs a Steam shortcut of its own",
    rom_missing: "This game's file isn't where Cheevo Check last saw it. Run Cheevo Check again to host.",
    no_emulator_shortcut: "To host, add this game, or {{emulator}} itself, to Steam as a non-Steam game."
};

export function streamHostProblemText(language: LanguageCode, code: string, detail?: Record<string, string>): string {
    const text = STREAM_HOST_TEXT[code];
    return text ? t(language, text, detail) : problemText(language, code, detail);
}

export function warningText(language: LanguageCode, code: string, detail?: Record<string, string>): string {
    return t(language, WARNING_TEXT[code] ?? WARNING_TEXT.version_mismatch, detail);
}
