import { DialogButton, Focusable, PanelSectionRow } from "@decky/ui";
import { useEffect, useRef, useState } from "react";

import { PanelSection } from "../components/ui/PanelSection";
import { BackButton } from "../components/ui/BackButton";
import { BottomFocusAnchor } from "../components/ui/BottomFocusAnchor";
import { FocusableItem } from "../components/ui/FocusableItem";
import { FocusTarget } from "../components/ui/FocusTarget";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { PageHelpButton, PageNavStrip } from "../components/ui/PageNavStrip";
import { SlidingWindowRows } from "../components/ui/SlidingWindowRows";
import { SubTabButton } from "../components/ui/SubTabButton";
import { TextViewerModal } from "../components/ui/TextViewerModal";
import { ToggleRow } from "../components/ui/ToggleRow";
import { GameHeaderCard, useGameHeaderArt } from "../components/games/GameHeaderCard";
import { openCorePicker } from "../components/multiplayer/CorePickerModal";
import { DigitPicker } from "../components/multiplayer/DigitPicker";
import { RoomTable } from "../components/multiplayer/RoomTable";
import { SectionTitle } from "../components/ui/SectionTitle";
import { useMultiplayer } from "../components/multiplayer/MultiplayerContext";
import { CheevoCheckGamesModal } from "../components/pickers/CheevoCheckGamesModal";
import { skipWhileHidden } from "../components/panel/skipWhileHidden";
import { useSlidingWindow } from "../hooks/useSlidingWindow";
import { landOnTop, pendingLandingKey, usePageLanding } from "../focusRecords";
import { t, type LanguageCode } from "../locales";
import type {
    ButtonSpacing,
    MultiplayerCoreChoice,
    MultiplayerMode,
    MultiplayerRoomRow,
    Payload,
    ViewKey
} from "../types";
import { showManagedModal } from "../utils/modalRegistry";
import { otherGameRunning } from "../utils/multiplayerSession";
import { openExternalUrl, raLookupSearchUrl } from "../utils/navigation";
import { textSize } from "../utils/scale";
import {
    achievementGreen,
    bodyTextStyle,
    errorRed,
    regularButtonSpacingStyle,
    warnAmber
} from "../utils/style";

const BACK_BUTTON_SCROLL_MARGIN_PX = 24;

const ROOM_PREFIX = "multiplayer:room:";
const LINK_SYSTEMS = [4, 5, 6, 16, 18, 41];
const DOLPHIN_CONSOLES = ["GameCube", "Wii"];
const GBA_SYSTEM = 5;
const NO_ROOMS: MultiplayerRoomRow[] = [];
const NO_CORES: MultiplayerCoreChoice[] = [];

const TABS: { mode: MultiplayerMode; labelKey: string; focusKey: string }[] = [
    { mode: "link", labelKey: "Link Play", focusKey: "multiplayer:tab:link" },
    { mode: "couch", labelKey: "Couch Play", focusKey: "multiplayer:tab:couch" }
];

const PROBLEM_TEXT: Record<string, string> = {
    not_game_mode: "Only works in Game Mode",
    no_account: "Sign in to RetroAchievements first",
    cap_reached: "Leave this page and come back to look again",
    no_scan: "Run Cheevo Check first",
    not_in_results: "This game isn't in your Cheevo Check results",
    no_shortcut: "No Steam ROM Manager shortcut for this game",
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
    link_gc_no_lan: "Link Play works with Mario Kart: Double Dash!! and Kirby Air Ride",
    dolphin_game_setting: "A Dolphin game setting for this game sets the network adapter",
    region_differs: "Your copy is from a different region than the host's",
    dolphin_flatpak_needed: "GameCube and Wii games need Dolphin's Flatpak installed for Cheevo Check",
    link_system: "Link Play works with Game Boy, Game Boy Advance, DS and PSP games, and two GameCube games",
    duckstation_no_multiplayer: "DuckStation can't do Couch Play. A RetroArch shortcut with Beetle PSX HW can.",
    pcsx2_no_multiplayer: "PCSX2 has no Link Play or Couch Play",
    override: "A RetroArch override for this game sets {{key}}",
    remap: "A RetroArch remap for this game sets the controller type",
    emudeck_netplay: "Turn off EmuDeck's NetPlay first",
    flatpak_permission: "The emulator can't read CheevoDeck's session files",
    saves_by_core: "Your RetroArch saves are sorted by core, so {{core}} can't see your save. Use {{shortcutCore}}.",
    other_game: "Close the running game first",
    rom_mismatch: "Your ROM doesn't match the host's",
    crc_mismatch: "Your ROM file differs from the host's. The game may desync.",
    link_gb_both: "Link Play needs a Game Boy game on both",
    link_needs_gambatte_both: "Link Play needs Gambatte on both devices",
    different_game: "The host is playing a different game",
    host_core_missing: "The host uses {{core}}, which isn't installed here. Install it in RetroArch (Main Menu → Online Updater → Core Downloader).",
    match_host_core: "The host uses {{core}}. Switch to it to join.",
    waiting_host: "Waiting for the host to start",
    no_guests: "Waiting for players",
    room_gone: "That room is gone",
    bad_code: "Wrong code",
    locked_out: "Too many wrong codes. Try again in a minute.",
    full: "That room is full",
    started: "That room has already started",
    wrong_core: "The host is on a different core",
    not_found: "No room found at that address",
    bad_address: "Not a valid address",
    host_gone: "Lost the host",
    dropped: "The host dropped you from the room",
    closed: "The host closed the room",
    network_changed: "Your network changed. Host again.",
    args_dropped: "This shortcut didn't pass CheevoDeck's settings to the emulator",
    launch_failed: "Couldn't start the game",
    seated: "Close the room to change it",
    unavailable: "Couldn't open a room on this network"
};

const WARNING_TEXT: Record<string, string> = {
    core_override: "Using {{core}} for this session. Your shortcut stays on {{shortcutCore}}.",
    saves_by_core: "Your RetroArch saves are sorted by core, so {{core}} won't see your usual save.",
    crc_mismatch: "Your ROM file differs from the host's. The game may desync.",
    version_mismatch: "Your RetroArch or core version differs from the host's.",
    revision_differs: "Your copy is a different version of the game from the host's."
};

const WAITING = ["waiting_host"];

const ABOVE_TABS = ["not_game_mode", "no_account", "cap_reached", "unavailable", "no_scan", "not_in_results", "no_shortcut",
    "dolphin_flatpak_needed"];

function problemText(language: LanguageCode, code: string, detail?: Record<string, string>): string {
    return t(language, PROBLEM_TEXT[code] ?? PROBLEM_TEXT.launch_failed, detail);
}

function roomKey(row: MultiplayerRoomRow): string {
    return ROOM_PREFIX + row.room;
}

function validAddress(digits: string): boolean {
    return [0, 3, 6, 9].every((at) => Number(digits.slice(at, at + 3)) <= 255);
}

function addressOf(digits: string): string {
    return [0, 3, 6, 9].map((at) => String(Number(digits.slice(at, at + 3)))).join(".");
}

type MultiplayerPageState = {
    view: ViewKey;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    showIcons: boolean;
    mouseKeyboardMode: boolean;
    payload: Payload | null;
};

type MultiplayerPageActions = {
    onBack: () => void | Promise<void>;
    onHome: () => void | Promise<void>;
};

type MultiplayerPageProps = {
    state: MultiplayerPageState;
    actions: MultiplayerPageActions;
};

function MultiplayerPage(props: MultiplayerPageProps) {
    const { state, actions: page } = props;
    const { language } = state;
    const visible = state.view === "multiplayer";
    const { state: mp, actions } = useMultiplayer();
    const [ipOpen, setIpOpen] = useState(false);
    const [ipDigits, setIpDigits] = useState("192168001000");
    const [codeDigits, setCodeDigits] = useState("0000");
    const [playFocused, setPlayFocused] = useState(false);

    const currentGameId = state.payload?.gameId ?? null;
    useEffect(() => {
        if (visible) {
            actions.setCurrentGameId(currentGameId);
        }
    }, [visible, currentGameId]);

    const rooms = mp.rooms ?? NO_ROOMS;
    const choices = mp.check?.local?.choices ?? NO_CORES;

    const roomWindow = useSlidingWindow({
        items: rooms,
        itemKey: (row) => row.room,
        focusKeyFor: roomKey,
        windowId: "multiplayer:rooms",
        heightScope: ["multiplayer:rooms", language, textSize(12)].join("|"),
        dynamicLoading: true,
        initialRows: 20,
        rowStep: 20,
        prefetchDistance: 0,
        sentinelRootMarginPx: 600,
        resetKey: `multiplayer:rooms|${mp.mode}`,
        openFirst: pendingLandingKey("multiplayer") ?? undefined
    });

    const joinedRoom = mp.joined?.room ?? null;

    const joiningRef = useRef(false);
    useEffect(() => {
        if (joinedRoom && joiningRef.current) {
            joiningRef.current = false;
            landOnTop("multiplayer", "multiplayer:leave");
        }
    }, [joinedRoom?.room]);
    const checkAnswered = mp.loaded && (mp.gameId === null || mp.checkCurrent);
    const [lowerDrawn, setLowerDrawn] = useState(false);
    useEffect(() => {
        if (checkAnswered) {
            setLowerDrawn(true);
        }
    }, [checkAnswered]);
    const drawLower = lowerDrawn || checkAnswered;

    usePageLanding({
        view: "multiplayer",
        active: visible,
        subject: null,
        tabPath: [mp.mode],
        restoreTabPath: ([next]) => {
            const wanted = TABS.find((entry) => entry.mode === next);
            if (!wanted || wanted.mode === mp.tab || mp.hosted || mp.joined) {
                return false;
            }
            actions.setTab(wanted.mode);
            return true;
        },
        sub: joinedRoom ? [{ kind: "room", subject: joinedRoom.room }] : [],
        defaultKey: "multiplayer:back",
        ready: drawLower,
        holds: (key) => rooms.some((row) => roomKey(row) === key),
        open: (key) => roomWindow.openAt(key)
    });

    const shown = mp.gameId !== null && mp.gameId === currentGameId ? state.payload : mp.headerPayload;
    const art = useGameHeaderArt(mp.gameId, shown?.imageIcon, shown?.imageIngame, state.showIcons && visible);

    if (!visible) {
        return null;
    }

    const hosted = mp.hosted;
    const joined = mp.joined;
    const local = mp.check?.local ?? null;
    const gateCheck = mp.checkCurrent ? mp.check : null;
    const session = mp.session;
    const playing = session.appid > 0;
    const seated = hosted ? hosted.seats.filter((seat, index) => index > 0 && seat).length : 0;
    const roomLocked = Boolean(hosted && seated > 0) || Boolean(joined);
    const couchGuest = mp.mode === "couch" && (joined !== null || mp.pendingRoom !== null);

    function gameProblem(): { code: string; detail?: Record<string, string> } | null {
        if (mp.visibleError) {
            return { code: mp.visibleError };
        }
        if (!hosted && !joined && !mp.pendingRoom && gateCheck?.gate) {
            if (gateCheck.gate === "not_in_results" && gateCheck.detail?.dolphinSkipped
                && DOLPHIN_CONSOLES.includes(shown?.consoleName ?? "")) {
                return { code: "dolphin_flatpak_needed" };
            }
            return { code: gateCheck.gate, detail: gateCheck.detail };
        }
        return null;
    }

    function playStatus(): { code: string; detail?: Record<string, string> } | null {
        if (playing || (!hosted && !joined)) {
            return null;
        }
        if (session.failure) {
            return { code: session.failure };
        }
        if (gateCheck?.gate) {
            return { code: gateCheck.gate, detail: gateCheck.detail };
        }
        if (joined?.error) {
            return { code: joined.error };
        }
        if (joined && joined.status?.state !== "playing") {
            return { code: "waiting_host" };
        }
        if (otherGameRunning()) {
            return { code: "other_game" };
        }
        return null;
    }

    const problem = gameProblem();
    const topProblem = problem && ABOVE_TABS.includes(problem.code) ? problem : null;
    const modeProblem = problem && !ABOVE_TABS.includes(problem.code) ? problem : null;
    const status = playStatus();
    const inRoom = (hosted !== null && seated > 0) || joined !== null;
    const canPlay = inRoom && status === null && !playing && !mp.busy && local !== null && mp.checkCurrent;
    const playLabel = playing ? "Playing" : joined ? "Join & Play" : "Host & Play";
    const inSession = hosted !== null || joined !== null;
    const slotStyle = { display: "flex", width: "100%", marginTop: "8px" };
    const slotButtonStyle = { width: "100%", minWidth: 0 };

    const title = shown?.title ?? local?.title ?? mp.games?.find((game) => game.gameId === mp.gameId)?.title ?? null;

    function pressBack() {
        if (ipOpen) {
            setIpOpen(false);
            return;
        }
        if (mp.pendingRoom) {
            actions.cancelPendingRoom();
            return;
        }
        if (joined) {
            void actions.leave();
            return;
        }
        void page.onBack();
    }

    function openGamePicker() {
        const rows = (mp.games ?? [])
            .filter((game) => game.appid > 0 && (mp.mode === "couch" || (LINK_SYSTEMS.includes(game.systemId) && game.canLink)))
            .map((game) => ({
                key: `${game.systemId}:${game.gameId}`,
                system: game.system,
                systemId: game.systemId,
                title: game.title,
                detail: "",
                note: "",
                gameId: game.gameId,
                imageIcon: game.imageIcon,
                searchTitle: ""
            }));
        showManagedModal((close) => (
            <CheevoCheckGamesModal
                language={language}
                showIcons={state.showIcons}
                kind="supported"
                rows={rows}
                onPick={(gameId) => {
                    actions.pickGame(gameId);
                    close();
                }}
                onWebSearch={(search) => {
                    close();
                    void openExternalUrl(raLookupSearchUrl(search));
                }}
                close={close}
            />
        ));
    }

    function openLinkGames() {
        const titles = (mp.games ?? [])
            .filter((game) => game.systemId === GBA_SYSTEM && game.canLink)
            .map((game) => game.title);
        const text = titles.length > 0
            ? titles.join("\n")
            : t(language, "None of your Game Boy Advance games can link in gpSP.");
        showManagedModal((close) => (
            <TextViewerModal
                language={language}
                mouseKeyboardMode={state.mouseKeyboardMode}
                title={t(language, "Games that can link")}
                text={text}
                close={close}
            />
        ));
    }

    function openCores() {
        openCorePicker({
            language,
            choices,
            current: local?.core ?? "",
            onPick: actions.chooseCore
        });
    }

    async function findByAddress() {
        const room = await actions.lookup(addressOf(ipDigits));
        if (room) {
            setIpOpen(false);
            joiningRef.current = true;
            actions.pickRoom(room);
        }
    }

    const buttonStyle = regularButtonSpacingStyle(state.buttonSpacing);
    const coreLabel = local
        ? local.core === local.shortcutCore
            ? t(language, "Core: {{core}} (from your shortcut)", { core: local.coreName })
            : joined || mp.pendingRoom
                ? t(language, "Core: {{core}} (matches the host)", { core: local.coreName })
                : t(language, "Core: {{core}}", { core: local.coreName })
        : "";
    const showCores = local?.emulator === "retroarch" && choices.length > 0;

    const scopeKey = joined ? "multiplayer:room" : `multiplayer:${mp.mode}`;

    const coreRows = showCores && (
        <>
            <PanelSectionRow>
                <FocusableItem
                    outerStyle={buttonStyle}
                    focusKey="multiplayer:core"
                    focusFallback={["multiplayer:host", "multiplayer:back"]}
                    disabled={roomLocked}
                    onClick={openCores}
                    help={roomLocked ? t(language, "Close the room to change it") : undefined}
                >
                    {coreLabel}
                </FocusableItem>
            </PanelSectionRow>
            {mp.mode === "link" && local?.core === "gpsp" && (
                <PanelSectionRow>
                    <FocusableItem
                        outerStyle={buttonStyle}
                        focusKey="multiplayer:linkgames"
                        focusFallback={["multiplayer:core", "multiplayer:back"]}
                        onClick={openLinkGames}
                    >
                        {t(language, "Games that can link")}
                    </FocusableItem>
                </PanelSectionRow>
            )}
        </>
    );

    const playRows = (
        <>
            <PanelSectionRow>
                {inSession ? (
                    <FocusTarget
                        key="multiplayer:play"
                        focusKey="multiplayer:play"
                        focusFallback={[joined ? "multiplayer:leave" : "multiplayer:host", "multiplayer:pickgame", "multiplayer:back"]}
                        style={slotStyle}
                    >
                        <DialogButton
                            focusable={canPlay}
                            disabled={!canPlay}
                            onClick={() => void actions.play()}
                            onGamepadFocus={() => setPlayFocused(true)}
                            onGamepadBlur={() => setPlayFocused(false)}
                            style={{
                                ...slotButtonStyle,
                                fontWeight: 800,
                                background: canPlay && !playFocused ? achievementGreen : undefined,
                                color: canPlay && !playFocused ? "#0b1f0f" : undefined,
                                opacity: canPlay || playing ? 1 : 0.45
                            }}
                        >
                            {t(language, playLabel)}
                        </DialogButton>
                    </FocusTarget>
                ) : (
                    <FocusTarget
                        key="multiplayer:pickgame"
                        focusKey="multiplayer:pickgame"
                        focusFallback={[`multiplayer:tab:${mp.mode}`, "multiplayer:back"]}
                        style={slotStyle}
                    >
                        <DialogButton
                            disabled={!mp.games || mp.games.length === 0 || mp.pendingRoom !== null}
                            onClick={openGamePicker}
                            style={slotButtonStyle}
                        >
                            {t(language, "Pick Another Game")}
                        </DialogButton>
                    </FocusTarget>
                )}
            </PanelSectionRow>
            {status && drawLower && (
                <PanelSectionRow>
                    <div style={{ ...bodyTextStyle(), opacity: 1, color: WAITING.includes(status.code) ? undefined : warnAmber }}>
                        {problemText(language, status.code, status.detail)}
                    </div>
                </PanelSectionRow>
            )}
        </>
    );

    const hardcoreLocked = mp.mode === "couch" && roomLocked;
    const hardcoreRow = (mp.mode === "link" || !couchGuest) && (
        <ToggleRow
            controlled
            label={t(language, "Hardcore")}
            value={mp.hardcore}
            disabled={hardcoreLocked}
            outerStyle={buttonStyle}
            focusKey="multiplayer:toggle:hardcore"
            focusFallback={[joined ? "multiplayer:leave" : "multiplayer:host"]}
            onChange={actions.setHardcore}
            help={t(language, hardcoreLocked ? "Close the room to change it" : "help_multiplayer_hardcore")}
        />
    );

    const hostRows = !joined && !mp.pendingRoom && (
        <>
            {hardcoreRow}
            <ToggleRow
                controlled
                label={t(language, "Private Room")}
                value={mp.privateRoom}
                disabled={roomLocked}
                outerStyle={buttonStyle}
                focusKey="multiplayer:toggle:private"
                focusFallback={["multiplayer:host"]}
                onChange={actions.setPrivate}
                help={t(language, roomLocked ? "Close the room to change it" : "help_multiplayer_private")}
            />
            <PanelSectionRow>
                <FocusableItem
                    outerStyle={buttonStyle}
                    focusKey="multiplayer:host"
                    focusFallback={["multiplayer:toggle:hardcore", "multiplayer:back"]}
                    disabled={mp.busy || (!hosted && (mp.gameId === null || !gateCheck || Boolean(gateCheck.gate) || (Boolean(mp.visibleError) && mp.visibleError !== "cap_reached")))}
                    onClick={() => void (hosted ? actions.closeRoom() : actions.host())}
                >
                    {t(language, hosted ? "Close Room" : "Host a Room")}
                </FocusableItem>
            </PanelSectionRow>
            {hosted && (
                <>
                    {hosted.private && (
                        <PanelSectionRow>
                            <div style={{ ...bodyTextStyle(), opacity: 1, fontWeight: 700 }}>
                                {t(language, "Room code: {{code}}", { code: hosted.code })}
                            </div>
                        </PanelSectionRow>
                    )}
                    <RoomTable
                        language={language}
                        seats={hosted.seats.map((seat, index) => ({ name: seat?.name ?? "", tag: index === 0 ? "host" : "" }))}
                        onDrop={(index) => void actions.dropSeat(index)}
                        exitKey="multiplayer:host"
                    />
                </>
            )}
        </>
    );

    const joinRows = !hosted && (
        joined ? (
            <>
                <PanelSectionRow>
                    <div style={{ ...bodyTextStyle(), opacity: 1 }}>
                        {t(language, "{{name}} · {{title}}", { name: joined.room.user, title: joined.room.title })}
                    </div>
                </PanelSectionRow>
                {mp.mode === "couch" && (
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>
                            {t(language, joined.status?.hardcore ? "Hardcore on, set by the host" : "Hardcore off, set by the host")}
                        </div>
                    </PanelSectionRow>
                )}
                {mp.mode === "link" && hardcoreRow}
                <RoomTable
                    language={language}
                    seats={Array.from({ length: joined.room.max }, (_, index) => ({
                        name: joined.status?.members[index] ?? joined.room.seats[index] ?? "",
                        tag: index === 0 ? "host" : index === joined.seat ? "you" : ""
                    }))}
                    exitKey="multiplayer:leave"
                />
                <PanelSectionRow>
                    <FocusableItem
                        outerStyle={buttonStyle}
                        focusKey="multiplayer:leave"
                        focusFallback={["multiplayer:back"]}
                        onClick={actions.leave}
                    >
                        {t(language, "Leave Room")}
                    </FocusableItem>
                </PanelSectionRow>
            </>
        ) : mp.pendingRoom ? (
            <>
                <PanelSectionRow>
                    <div style={{ ...bodyTextStyle(), opacity: 1 }}>
                        {t(language, "Enter the code for {{name}}'s room", { name: mp.pendingRoom.user })}
                    </div>
                </PanelSectionRow>
                <PanelSectionRow>
                    <DigitPicker
                        language={language}
                        digits={codeDigits}
                        onChange={setCodeDigits}
                        focusPrefix="multiplayer:code"
                        fallbacks={["multiplayer:code:join", "multiplayer:leave"]}
                    />
                </PanelSectionRow>
                <PanelSectionRow>
                    <FocusableItem
                        outerStyle={buttonStyle}
                        focusKey="multiplayer:code:join"
                        focusFallback={["multiplayer:leave", "multiplayer:code:0", "multiplayer:back"]}
                        onClick={() => {
                            const room = mp.pendingRoom;
                            if (room) {
                                joiningRef.current = true;
                                void actions.join(room, codeDigits);
                            }
                        }}
                    >
                        {t(language, "Join Room")}
                    </FocusableItem>
                </PanelSectionRow>
            </>
        ) : (
            <>
                <PanelSectionRow>
                    <div style={{ ...bodyTextStyle(), fontWeight: "bold", opacity: 1, marginTop: "8px" }}>
                        {t(language, "Rooms")}
                    </div>
                </PanelSectionRow>
                {rooms.length > 0 && (
                    <SlidingWindowRows list={roomWindow}>
                        {roomWindow.mountedItems.map((row, index) => {
                            const at = roomWindow.start + index;
                            const neighbors = [rooms[at + 1], rooms[at - 1]]
                                .filter((other): other is MultiplayerRoomRow => other !== undefined)
                                .map(roomKey);
                            const taken = row.seats.filter(Boolean).length;
                            const tags = [
                                row.private ? t(language, "Private") : "",
                                row.emulator === "retroarch" && row.core && !mp.installedCores.includes(row.core)
                                    ? t(language, "Core not installed")
                                    : ""
                            ].filter(Boolean).join(" · ");
                            return (
                                <PanelSectionRow key={row.room}>
                                    <FocusableItem
                                        outerStyle={buttonStyle}
                                        focusKey={roomKey(row)}
                                        focusFallback={[
                                            ...neighbors,
                                            "multiplayer:code:0",
                                            "multiplayer:leave",
                                            "multiplayer:joinip",
                                            `multiplayer:tab:${mp.mode}`,
                                            "multiplayer:back"
                                        ]}
                                        disabled={row.mode !== mp.mode}
                                        onGamepadFocus={() => roomWindow.onItemFocus(at)}
                                        onGamepadDirection={roomWindow.guardTopRow(at)}
                                        onClick={() => {
                                            joiningRef.current = true;
                                            actions.pickRoom(row);
                                        }}
                                    >
                                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                            <div>{t(language, "{{name}} · {{title}}", { name: row.user, title: row.title })}</div>
                                            <div style={bodyTextStyle()}>
                                                {t(language, row.mode === "link" ? "Link Play" : "Couch Play")}
                                                {row.coreName ? ` · ${row.coreName}` : ""}
                                                {" · "}
                                                {t(language, "{{taken}} of {{count}} seats", { taken, count: row.max })}
                                            </div>
                                            {tags && <div style={{ ...bodyTextStyle(), color: warnAmber }}>{tags}</div>}
                                        </div>
                                    </FocusableItem>
                                </PanelSectionRow>
                            );
                        })}
                    </SlidingWindowRows>
                )}
                {rooms.length === 0 && mp.rooms === null && !mp.visibleError && (
                    <PanelSectionRow>
                        <InlineSpinner label={t(language, "Looking for rooms...")} />
                    </PanelSectionRow>
                )}
                {rooms.length === 0 && (mp.rooms !== null || mp.visibleError) && (
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>
                            {t(language, "No rooms yet. Both devices need to be on the same Wi-Fi, or use Join by IP.")}
                        </div>
                    </PanelSectionRow>
                )}
                <PanelSectionRow>
                    <FocusableItem
                        outerStyle={buttonStyle}
                        focusKey="multiplayer:joinip"
                        focusFallback={[`multiplayer:tab:${mp.mode}`, "multiplayer:back"]}
                        onClick={() => setIpOpen(!ipOpen)}
                    >
                        {t(language, "Join by IP")}
                    </FocusableItem>
                </PanelSectionRow>
                {ipOpen && (
                    <>
                        <PanelSectionRow>
                            <DigitPicker
                                language={language}
                                digits={ipDigits}
                                onChange={setIpDigits}
                                focusPrefix="multiplayer:ip"
                                groupSize={3}
                                fallbacks={["multiplayer:ip:go", "multiplayer:leave", "multiplayer:code:0", "multiplayer:joinip"]}
                            />
                        </PanelSectionRow>
                        {!validAddress(ipDigits) && (
                            <PanelSectionRow>
                                <div style={{ ...bodyTextStyle(), color: errorRed, opacity: 1 }}>
                                    {t(language, "Not a valid address")}
                                </div>
                            </PanelSectionRow>
                        )}
                        <PanelSectionRow>
                            <FocusableItem
                                outerStyle={buttonStyle}
                                focusKey="multiplayer:ip:go"
                                focusFallback={["multiplayer:leave", "multiplayer:code:0", "multiplayer:joinip"]}
                                disabled={mp.busy || !validAddress(ipDigits)}
                                onClick={() => void findByAddress()}
                            >
                                {t(language, "Find Room")}
                            </FocusableItem>
                        </PanelSectionRow>
                    </>
                )}
            </>
        )
    );

    return (
        <Focusable key="multiplayer:view" flow-children="column" onCancelButton={pressBack}>
            <PanelSection>
                <PageNavStrip
                    title={t(language, "EZ Multiplayer")}
                    buttonSpacing={state.buttonSpacing}
                    onHome={page.onHome}
                    help={<PageHelpButton focusKey="multiplayer:help" guide="ez-multiplayer" />}
                />

                <BackButton
                    label={t(language, "Back")}
                    focusKey="multiplayer:back"
                    navAutoFocus
                    buttonSpacing={state.buttonSpacing}
                    onClick={pressBack}
                    scrollMarginTop={BACK_BUTTON_SCROLL_MARGIN_PX}
                />

                <SectionTitle label={t(language, "Current Game")} />
                <PanelSectionRow>
                    <div style={{ width: "100%" }}>
                        <GameHeaderCard
                            {...art}
                            language={language}
                            title={title}
                            consoleName={shown?.consoleName ?? null}
                            completion={shown?.userCompletion ?? null}
                            highestAwardKind={shown?.highestAwardKind}
                        />
                    </div>
                </PanelSectionRow>
                {playRows}
                {drawLower && (
                    <>
                        {topProblem && (
                            <PanelSectionRow>
                                <div style={{ ...bodyTextStyle(), color: warnAmber, opacity: 1 }}>
                                    {problemText(language, topProblem.code, topProblem.detail)}
                                </div>
                            </PanelSectionRow>
                        )}

                        <div style={{ height: "1px", background: "rgba(255,255,255,0.18)", margin: "8px 0" }} />

                        <Focusable
                            flow-children="row"
                            style={{ width: "100%", display: "flex", gap: "6px", margin: "6px 0 4px 0" }}
                        >
                            {TABS.map((entry) => (
                                <SubTabButton
                                    key={entry.mode}
                                    label={t(language, entry.labelKey)}
                                    active={mp.mode === entry.mode}
                                    onClick={() => actions.setTab(entry.mode)}
                                    focusKey={entry.focusKey}
                                    disabled={(hosted !== null || joined !== null) && entry.mode !== mp.mode}
                                />
                            ))}
                        </Focusable>
                        <PanelSectionRow>
                            <div style={bodyTextStyle()}>
                                {t(language, mp.mode === "link" ? "help_multiplayer_link_mode" : "help_multiplayer_couch_mode")}
                            </div>
                        </PanelSectionRow>
                        {mp.mode === "link" && local?.emulator === "dolphin" && (
                            <PanelSectionRow>
                                <div style={bodyTextStyle()}>
                                    {t(language, "Start LAN mode in the game on both devices at about the same time.")}
                                </div>
                            </PanelSectionRow>
                        )}
                        {modeProblem && (
                            <PanelSectionRow>
                                <div style={{ ...bodyTextStyle(), color: warnAmber, opacity: 1 }}>
                                    {problemText(language, modeProblem.code, modeProblem.detail)}
                                </div>
                            </PanelSectionRow>
                        )}
                        {(gateCheck?.warnings ?? []).map((warning) => (
                            <PanelSectionRow key={warning.code}>
                                <div style={{ ...bodyTextStyle(), color: warnAmber, opacity: 1 }}>
                                    {t(language, WARNING_TEXT[warning.code] ?? WARNING_TEXT.version_mismatch, warning.detail)}
                                </div>
                            </PanelSectionRow>
                        ))}
                        {(mp.problem || (!hosted && !joined && mp.closedReason)) && (
                            <PanelSectionRow>
                                <div style={{ ...bodyTextStyle(), color: errorRed, opacity: 1 }}>
                                    {mp.problem
                                        ? problemText(language, mp.problem.code, mp.problem.detail)
                                        : problemText(language, mp.closedReason)}
                                </div>
                            </PanelSectionRow>
                        )}

                        <Focusable key={scopeKey} flow-children="column" resetNavOnEntry>
                            {coreRows}
                            {hostRows}
                            {joinRows}
                            <BottomFocusAnchor focusKey="multiplayer:bottom:anchor" />
                        </Focusable>
                    </>
                )}
            </PanelSection>
        </Focusable>
    );
}

export default skipWhileHidden(MultiplayerPage, (props) => props.state.view === "multiplayer");
