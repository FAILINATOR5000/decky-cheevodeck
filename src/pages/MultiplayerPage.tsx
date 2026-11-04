import { DialogButton, Focusable, PanelSectionRow } from "@decky/ui";
import { useEffect, useRef, useState } from "react";

import { PanelSection } from "../components/ui/PanelSection";
import { BackButton } from "../components/ui/BackButton";
import { BottomFocusAnchor } from "../components/ui/BottomFocusAnchor";
import { FocusableItem } from "../components/ui/FocusableItem";
import { FocusTarget } from "../components/ui/FocusTarget";
import { PageHelpButton, PageNavStrip } from "../components/ui/PageNavStrip";
import { SubTabButton } from "../components/ui/SubTabButton";
import { ModeChoice } from "../components/multiplayer/ModeChoice";
import { showMultiplayerProblem } from "../components/multiplayer/ProblemModal";
import { TextViewerModal } from "../components/ui/TextViewerModal";
import { ToggleRow } from "../components/ui/ToggleRow";
import { GameHeaderCard, useGameHeaderArt } from "../components/games/GameHeaderCard";
import { openCorePicker } from "../components/multiplayer/CorePickerModal";
import { RoomChatBox } from "../components/multiplayer/RoomChatBox";
import { RoomTable } from "../components/multiplayer/RoomTable";
import { FriendsTab } from "../components/multiplayer/FriendsTab";
import { openSeatCard } from "../components/multiplayer/SeatCardModal";
import { openInviteFriends } from "../components/multiplayer/InviteFriendsModal";
import { openChatSay } from "../components/multiplayer/ChatSayModal";
import { openMessageCenter } from "../components/multiplayer/MessageCenterModal";
import { openHostRoom } from "../components/multiplayer/HostRoomModal";
import { openRooms } from "../components/multiplayer/RoomsModal";
import { SectionTitle } from "../components/ui/SectionTitle";
import { useMultiplayer } from "../components/multiplayer/MultiplayerContext";
import { CheevoCheckGamesModal } from "../components/pickers/CheevoCheckGamesModal";
import { skipWhileHidden } from "../components/panel/skipWhileHidden";
import { usePageLanding, type LandingWindows } from "../focusRecords";
import { t, type LanguageCode } from "../locales";
import type {
    ButtonSpacing,
    MultiplayerCoreChoice,
    MultiplayerGame,
    MultiplayerGuestGame,
    MultiplayerMode,
    MultiplayerTab,
    Payload,
    ViewKey
} from "../types";
import { showManagedModal } from "../utils/modalRegistry";
import { logError } from "../utils/errors";
import { multiplayerGuestGames } from "../api";
import { anyGameRunning, otherGameRunning } from "../utils/multiplayerSession";
import { screenMaxRefresh } from "../utils/screenRefresh";
import { getCurrentControllerGlyphStyle } from "../utils/controllerGlyphs";
import { ButtonHints } from "../components/ui/ButtonHints";
import { openExternalUrl, raLookupSearchUrl } from "../utils/navigation";
import { ROOM_ENDED, problemText, warningText } from "../utils/multiplayerProblems";
import {
    bodyTextStyle,
    errorRed,
    regularButtonSpacingStyle,
    steamPlayGreen,
    steamPlayGrey,
    steamPlayGreyText,
    warnAmber
} from "../utils/style";

const BACK_BUTTON_SCROLL_MARGIN_PX = 24;

const LINK_SYSTEMS = [4, 5, 6, 16, 18, 41];
const DOLPHIN_CONSOLES = ["GameCube", "Wii"];
const GBA_SYSTEM = 5;
const NO_CORES: MultiplayerCoreChoice[] = [];

function playsIn(game: MultiplayerGame, mode: MultiplayerMode) {
    return mode === "couch" ? game.canCouch : LINK_SYSTEMS.includes(game.systemId) && game.canLink;
}

const TABS: { tab: MultiplayerTab; labelKey: string; focusKey: string }[] = [
    { tab: "play", labelKey: "Play", focusKey: "multiplayer:tab:play" },
    { tab: "friends", labelKey: "Friends", focusKey: "multiplayer:tab:friends" }
];

const WAITING = ["nobody_ready", "drop_in"];
const ROOM_NOTICES = ["unreadied_other_game", "other_game"];

const MODE_FACTS = ["link_system", "link_gc_no_lan", "ds_no_couch", "pcsx2_no_multiplayer", "link_gba_cant_link"];

type MultiplayerPageState = {
    view: ViewKey;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    showIcons: boolean;
    mouseKeyboardMode: boolean;
    payload: Payload | null;
    dynamicAllGames: boolean;
    dynamicInitialRows: number;
    dynamicRowStep: number;
    dynamicPrefetchDistance: number;
    dynamicSentinelRootMargin: number;
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
    const { state: mp, actions, friends, page: tabs } = useMultiplayer();
    const landingWindows = useRef<LandingWindows | null>(null);
    const [playFocused, setPlayFocused] = useState(false);
    const [screenHz, setScreenHz] = useState<number | null>(null);

    useEffect(() => {
        if (visible) {
            void screenMaxRefresh().then(setScreenHz);
        }
    }, [visible]);

    const currentGameId = state.payload?.gameId ?? null;
    useEffect(() => {
        if (visible) {
            actions.setCurrentGameId(currentGameId);
        }
    }, [visible, currentGameId]);

    const choices = mp.check?.local?.choices ?? NO_CORES;

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
        tabPath: [tabs.tab, mp.mode],
        restoreTabPath: ([nextTab, nextMode]) => {
            let changed = false;
            const tab = TABS.find((entry) => entry.tab === nextTab);
            if (tab && tab.tab !== tabs.tab) {
                tabs.show(tab.tab);
                changed = true;
            }
            if ((nextMode === "link" || nextMode === "couch") && nextMode !== mp.tab && !mp.hosted && !mp.joined) {
                actions.setTab(nextMode);
                changed = true;
            }
            return changed;
        },
        defaultKey: "multiplayer:back",
        ready: tabs.tab === "friends" ? friends.state.data !== null : drawLower,
        holds: (key) => landingWindows.current?.holds(key) ?? false,
        open: (key) => landingWindows.current?.open(key),
        timing: { revealDeadlineMs: 1000, pressGuardCeilingMs: 1050 }
    });

    const shown = mp.gameId !== null && mp.gameId === currentGameId ? state.payload : mp.headerPayload;
    const art = useGameHeaderArt(mp.gameId, shown?.imageIcon, shown?.imageIngame, state.showIcons && visible);

    if (!visible) {
        return null;
    }

    const hosted = mp.hosted;
    const joined = mp.joined;
    const onPlay = tabs.tab === "play";
    const local = mp.check?.local ?? null;
    const roomCore = hosted?.core ?? joined?.room.core ?? local?.core ?? "";
    const runsPpsspp = roomCore === "ppsspp" || roomCore === "ppsspp-standalone";
    const runsRmg = mp.mode === "couch" && roomCore === "rmg-standalone";
    const roomTitle = hosted?.title ?? joined?.room.title ?? local?.title ?? "";
    const gateCheck = mp.checkCurrent ? mp.check : null;
    const shownCheck = gateCheck ?? mp.check;
    const session = mp.session;
    const playing = session.appid > 0;
    const roomLocked = Boolean(hosted && hosted.state !== "lobby") || Boolean(joined);
    const couchGuest = mp.mode === "couch" && joined !== null;

    function gameProblem(): { code: string; detail?: Record<string, string> } | null {
        if (mp.visibleError) {
            return { code: mp.visibleError };
        }
        if (shownCheck?.gate) {
            if (shownCheck.gate === "not_in_results" && shownCheck.detail?.dolphinSkipped
                && DOLPHIN_CONSOLES.includes(shown?.consoleName ?? "")) {
                return { code: "dolphin_flatpak_needed" };
            }
            return { code: shownCheck.gate, detail: shownCheck.detail };
        }
        return null;
    }

    const roomState = hosted ? hosted.state : joined?.status?.state ?? "lobby";
    const inLobby = roomState === "lobby";
    const runningOther = anyGameRunning() && !playing;
    const ownGameOk = local !== null && mp.checkCurrent && !gateCheck?.gate;
    const canStartNow = Boolean(hosted?.canStart) && !mp.busy && ownGameOk && !otherGameRunning() && !playing;
    const readyAllowed = Boolean(joined && inLobby && !joined.launched
        && (joined.ready || (ownGameOk && !runningOther)));
    const canRejoin = Boolean(joined?.rejoin) && !playing && !mp.busy && !runningOther && ownGameOk;
    const dropIn = (hosted?.mode ?? joined?.room.mode) === "couch"
        && (hosted?.emulator ?? joined?.room.emulator) === "retroarch";
    const canJoinLate = !playing && !mp.busy && !runningOther && ownGameOk;

    function playStatus(): { code: string; detail?: Record<string, string> } | null {
        if (!hosted && !joined) {
            return null;
        }
        if (joined?.error === "host_gone") {
            return { code: "host_waiting" };
        }
        if (joined && ROOM_NOTICES.includes(joined.notice)) {
            return { code: joined.notice };
        }
        if (playing || !inLobby) {
            return null;
        }
        if (hosted && !dropIn && !hosted.canStart && hosted.seats.some((seat, index) => index > 0 && seat?.can)) {
            return { code: "nobody_ready" };
        }
        if (hosted ? otherGameRunning() : runningOther && !joined?.ready) {
            return { code: "other_game" };
        }
        if (hosted && dropIn && !hosted.seats.some((seat, index) => index > 0 && seat?.ready)) {
            return { code: "drop_in" };
        }
        return null;
    }

    const problem = gameProblem();
    const modeFact = problem && MODE_FACTS.includes(problem.code) ? problem : null;
    const shownProblem = problem && !modeFact ? problem : null;
    const status = playStatus();
    const inSession = hosted !== null || joined !== null;

    const endedCode = !inSession ? mp.closedReason
        : joined && ROOM_ENDED.includes(joined.error) ? joined.error : "";
    const missedLine = mp.missed ?? (endedCode && !mp.endedLineCleared ? { code: endedCode } : null);

    const warnings = [
        ...(gateCheck?.warnings ?? []).map((warning) => warningText(language, warning.code, warning.detail)),
        ...(runsPpsspp ? [t(language, "PSP multiplayer is experimental. Some games lose the connection when a match starts.")] : []),
        ...(screenHz !== null && (screenHz === 0 || screenHz > 60)
            ? [t(language, "Multiplayer runs best at 60 Hz. If a game jitters, set 60 Hz in Steam's Performance menu while it runs.")]
            : []),
        ...(runsRmg ? [t(language, "rmg_heads_up")] : [])
    ];
    const tips = [
        ...(modeFact ? [problemText(language, modeFact.code, modeFact.detail)] : []),
        ...(mp.mode === "couch" && local?.emulator === "dolphin"
            ? [t(language, joined
                ? "In Dolphin, open Tools, then Start NetPlay, then Connect. The host's address is filled in."
                : "In Dolphin, open Tools, then Start NetPlay, then Host. Pick the game and press Start once everyone has joined.")]
            : []),
        ...(runsRmg ? [t(language, joined ? "rmg_steps_guest" : "rmg_steps_host", { game: roomTitle })] : [])
    ];

    let playLabel = mp.mode === "couch" && local?.emulator === "dolphin" ? "Open Dolphin" : runsRmg ? "Open RMG" : "Host & Play";
    let canPlay = canStartNow;
    let pressPlay = () => void actions.start();
    if (hosted && !inLobby) {
        canPlay = false;
    }
    else if (joined) {
        if (inLobby) {
            playLabel = joined.ready ? "Unready" : "Ready";
            canPlay = readyAllowed;
            pressPlay = () => {
                if (!mp.busy) {
                    void actions.toggleReady();
                }
            };
        }
        else if (joined.rejoin) {
            playLabel = joined.room.watch ? "Watch" : "Join & Play";
            canPlay = canRejoin;
            pressPlay = () => void actions.play();
        }
        else if (dropIn) {
            playLabel = joined.room.watch ? "Watch" : "Join & Play";
            canPlay = roomState === "playing" && !joined.status?.start && !joined.ready && !joined.launched
                && canJoinLate;
            pressPlay = () => void actions.joinLate();
        }
        else {
            playLabel = "Ready";
            canPlay = false;
        }
    }
    const playGreen = playLabel !== "Unready";
    const playBackground = !playGreen || playFocused ? undefined : canPlay ? steamPlayGreen : steamPlayGrey;
    const playColor = !playGreen || playFocused ? undefined : canPlay ? "#ffffff" : steamPlayGreyText;
    const yStarts = canStartNow && !state.mouseKeyboardMode;
    const xReadies = readyAllowed && !state.mouseKeyboardMode;
    const slotStyle = { display: "flex", width: "100%", marginTop: "8px" };
    const slotButtonStyle = { width: "100%", minWidth: 0 };

    const title = shown?.title ?? local?.title ?? mp.games?.find((game) => game.gameId === mp.gameId)?.title ?? null;

    function pressBack() {
        void page.onBack();
    }

    function openSeat(index: number, name: string, game: string, ulid: string, pic: string) {
        const data = friends.state.data;
        const friend = data?.friends.find((row) => row.ulid === ulid);
        const avatars = friends.state.avatars;
        openSeatCard(language, {
            index,
            name,
            game,
            ulid: ulid === data?.me ? "" : ulid,
            avatar: pic ? friends.state.avatars[pic] : undefined,
            relation: friend ? "friend"
                : data?.requests.some((request) => request.ulid === ulid) ? "pending" : "none",
            canDrop: hosted !== null && index > 0,
            friendsOn: Boolean(data?.on),
            openMessages: friend
                ? () => openMessageCenter(language, { friend, avatars, selfPic: data?.selfPic ?? "" })
                : null
        });
    }

    function openGamePicker(pick: (gameId: number) => void = actions.pickGame, forMode: MultiplayerMode = mp.mode) {
        const rows = (mp.games ?? [])
            .filter((game) => game.launchable && playsIn(game, forMode))
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
                    pick(gameId);
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

    function chooseMode(next: MultiplayerMode) {
        const roomGame = hosted && next !== hosted.mode
            ? mp.games?.find((game) => game.gameId === hosted.gameId)
            : undefined;
        if (roomGame && !playsIn(roomGame, next)) {
            openGamePicker((gameId) => actions.changeGame(gameId, next), next);
            return;
        }
        actions.setTab(next);
    }

    async function openGuestGames() {
        let listed: MultiplayerGuestGame[] = [];
        try {
            listed = (await multiplayerGuestGames()).games ?? [];
        }
        catch (e) {
            logError("multiplayerGuestGames", e);
        }
        const rows = listed.map((game) => ({
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
                    actions.changeGame(gameId);
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
            .filter((game) => game.systemId === GBA_SYSTEM && game.canLink && game.launchable)
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

    function describe(code: string, detail?: Record<string, string>) {
        return problemText(language, code, detail);
    }

    function openHost() {
        if (mp.gameId === null) {
            return;
        }
        openHostRoom(language, {
            mode: mp.mode,
            gameId: mp.gameId,
            hardcore: mp.hardcore,
            core: mp.core,
            share: mp.shareControls,
            watch: mp.watchOnly
        }, {
            online: mp.lobby,
            lanOnly: Boolean(mp.check?.lanOnly)
        }, describe);
    }

    const buttonStyle = regularButtonSpacingStyle(state.buttonSpacing);
    const coreLabel = local
        ? local.core === local.shortcutCore
            ? t(language, "Core: {{core}} (from your shortcut)", { core: local.coreName })
            : joined
                ? t(language, "Core: {{core}} (matches the host)", { core: local.coreName })
                : t(language, "Core: {{core}}", { core: local.coreName })
        : "";
    const showCores = local?.emulator === "retroarch" && choices.length > 0 && !joined;

    const scopeKey = joined ? "multiplayer:room" : `multiplayer:${mp.mode}`;

    const coreRows = showCores && (
        <>
            <PanelSectionRow>
                <FocusableItem
                    bottomSeparator="none"
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
                        bottomSeparator="none"
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
                        focusFallback={[`multiplayer:mode:${mp.mode}`, "multiplayer:back"]}
                        style={slotStyle}
                    >
                        <DialogButton
                            focusable={canPlay}
                            disabled={!canPlay}
                            onClick={pressPlay}
                            onGamepadFocus={() => setPlayFocused(true)}
                            onGamepadBlur={() => setPlayFocused(false)}
                            style={{
                                ...slotButtonStyle,
                                fontWeight: 800,
                                background: playBackground,
                                color: playColor,
                                opacity: canPlay || playGreen ? 1 : 0.45
                            }}
                        >
                            {t(language, playLabel)}
                        </DialogButton>
                    </FocusTarget>
                ) : (
                    <FocusTarget
                        key="multiplayer:pickgame"
                        focusKey="multiplayer:pickgame"
                        focusFallback={[`multiplayer:mode:${mp.mode}`, "multiplayer:back"]}
                        style={slotStyle}
                    >
                        <DialogButton
                            disabled={!mp.games || mp.games.length === 0}
                            onClick={() => openGamePicker()}
                            style={slotButtonStyle}
                        >
                            {t(language, "Pick Another Game")}
                        </DialogButton>
                    </FocusTarget>
                )}
            </PanelSectionRow>
        </>
    );

    const statusRow = inSession && (
        <PanelSectionRow>
            <div
                style={{
                    ...bodyTextStyle(),
                    opacity: 1,
                    minHeight: "1.4em",
                    color: status && WAITING.includes(status.code) ? undefined : warnAmber
                }}
            >
                {status ? problemText(language, status.code, status.detail) : ""}
            </div>
        </PanelSectionRow>
    );

    const hardcoreLocked = mp.mode === "couch" && roomLocked;
    const hardcoreRow = (mp.mode === "link" || !couchGuest) && (
        <ToggleRow
            bottomSeparator="none"
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

    const shareRow = (
        <ToggleRow
            bottomSeparator="none"
            controlled
            label={t(language, "Share Controls")}
            value={mp.shareControls}
            disabled={roomLocked || mp.watchOnly}
            outerStyle={buttonStyle}
            focusKey="multiplayer:toggle:share"
            focusFallback={["multiplayer:toggle:hardcore", "multiplayer:host"]}
            onChange={actions.setShare}
            help={t(language, roomLocked ? "Close the room to change it"
                : mp.watchOnly ? "Watch Only is on, so nobody else controls the game" : "help_multiplayer_share")}
        />
    );

    const watchRow = (
        <ToggleRow
            bottomSeparator="none"
            controlled
            label={t(language, "Watch Only")}
            value={mp.watchOnly}
            disabled={roomLocked}
            outerStyle={buttonStyle}
            focusKey="multiplayer:toggle:watch"
            focusFallback={["multiplayer:toggle:share", "multiplayer:toggle:hardcore", "multiplayer:host"]}
            onChange={actions.setWatch}
            help={t(language, roomLocked ? "Close the room to change it" : "help_multiplayer_watch")}
        />
    );

    const roomButton = joined ? (
        <PanelSectionRow>
            <FocusableItem
                bottomSeparator="none"
                outerStyle={buttonStyle}
                focusKey="multiplayer:leave"
                focusFallback={["multiplayer:back"]}
                onClick={actions.leave}
            >
                {t(language, "Leave Room")}
            </FocusableItem>
        </PanelSectionRow>
    ) : (
        <>
            <PanelSectionRow>
                <FocusableItem
                    bottomSeparator="none"
                    outerStyle={buttonStyle}
                    focusKey="multiplayer:host"
                    focusFallback={[`multiplayer:mode:${mp.mode}`, "multiplayer:back"]}
                    disabled={mp.busy || (!hosted && (mp.gameId === null || !shownCheck || Boolean(shownCheck.gate) || (Boolean(mp.visibleError) && mp.visibleError !== "cap_reached")))}
                    onClick={() => {
                        if (hosted) {
                            void actions.closeRoom();
                        }
                        else if (gateCheck) {
                            openHost();
                        }
                    }}
                >
                    {t(language, hosted ? "Close Room" : "Host a Room")}
                </FocusableItem>
            </PanelSectionRow>
            {!hosted && (
                <PanelSectionRow>
                    <FocusableItem
                        bottomSeparator="none"
                        outerStyle={buttonStyle}
                        focusKey="multiplayer:find"
                        focusFallback={["multiplayer:host", `multiplayer:mode:${mp.mode}`, "multiplayer:back"]}
                        disabled={mp.busy}
                        onClick={() => openRooms(language, mp.hardcore, mp.installedCores, describe)}
                    >
                        {t(language, "Find a Room")}
                    </FocusableItem>
                </PanelSectionRow>
            )}
        </>
    );

    const hintsRow = !state.mouseKeyboardMode && (hosted || joined) && (
        <PanelSectionRow>
            <div style={{ opacity: (hosted ? canStartNow : readyAllowed) ? 1 : 0.45 }}>
                <ButtonHints
                    style={getCurrentControllerGlyphStyle()}
                    hints={hosted
                        ? [{ button: "y", label: t(language, "Start") }]
                        : [{ button: "x", label: t(language, joined?.ready ? "Unready" : "Ready") }]}
                />
            </div>
        </PanelSectionRow>
    );

    const chat = hosted?.chat ?? joined?.chat ?? [];
    const exitKey = hosted ? "multiplayer:host" : "multiplayer:leave";
    const chatRows = (hosted || joined) && (
        <>
            <BottomFocusAnchor
                focusKey="multiplayer:chat:anchor"
                focusFallback={["multiplayer:say", exitKey, "multiplayer:back"]}
                headroomPx={0}
            />
            <PanelSectionRow>
                <RoomChatBox language={language} chat={chat} />
            </PanelSectionRow>
            <PanelSectionRow>
                <FocusableItem
                    bottomSeparator="none"
                    outerStyle={buttonStyle}
                    focusKey="multiplayer:say"
                    focusFallback={["multiplayer:chathistory", exitKey, "multiplayer:back"]}
                    onClick={() => openChatSay(language)}
                >
                    {t(language, "Say Something")}
                </FocusableItem>
            </PanelSectionRow>
            <PanelSectionRow>
                <FocusableItem
                    bottomSeparator="none"
                    outerStyle={buttonStyle}
                    focusKey="multiplayer:chathistory"
                    focusFallback={["multiplayer:say", exitKey, "multiplayer:back"]}
                    disabled={chat.length === 0}
                    onClick={() => {
                        showManagedModal((close) => (
                            <TextViewerModal
                                language={language}
                                mouseKeyboardMode={state.mouseKeyboardMode}
                                title={t(language, "Chat History")}
                                text={chat.map((line) => `${line.name}: ${line.text}`).join("\n")}
                                close={close}
                            />
                        ));
                    }}
                >
                    {t(language, "Chat History")}
                </FocusableItem>
            </PanelSectionRow>
        </>
    );

    const seatFree = hosted
        ? hosted.seats.some((seat) => seat === null)
        : Boolean(joined?.status?.members.some((name) => !name));
    const inviteRow = seatFree && friends.state.data?.on && friends.state.data.friends.length > 0 && (
        <PanelSectionRow>
            <FocusableItem
                bottomSeparator="none"
                outerStyle={buttonStyle}
                focusKey="multiplayer:invite"
                focusFallback={["multiplayer:say", exitKey, "multiplayer:back"]}
                onClick={() => openInviteFriends(language, friends.state.avatars)}
            >
                {t(language, "Invite Friends")}
            </FocusableItem>
        </PanelSectionRow>
    );

    const roomRows = hosted ? (
        <>
            {hintsRow}
            {hosted.where === "online" && (
                <PanelSectionRow>
                    <div style={{ ...bodyTextStyle(), color: hosted.lobby === "down" ? warnAmber : undefined }}>
                        {t(language, hosted.lobby === "down" ? "Reconnecting to the online lobby..." : "Online room")}
                    </div>
                </PanelSectionRow>
            )}
            <RoomTable
                language={language}
                seats={hosted.seats.map((seat, index) => ({
                    name: seat?.name ?? "",
                    game: seat?.title ?? "",
                    tag: index === 0 ? "host" : "",
                    mark: !seat || index === 0 ? "" : !seat.can ? "cant" : seat.ready ? "ready" : "",
                    activity: hosted.state === "lobby" || !seat ? "" : index === 0 ? "game"
                        : seat.launched ? (hosted.watch ? "watch" : "game") : "",
                    avatar: seat?.pic ? friends.state.avatars[seat.pic] : undefined,
                    open: index > 0 && seat !== null
                }))}
                onSeat={(index) => {
                    const seat = hosted.seats[index];
                    if (seat) {
                        openSeat(index, seat.name, seat.title, seat.ulid, seat.pic);
                    }
                }}
                exitKey="multiplayer:host"
            />
            {inviteRow}
            {chatRows}
        </>
    ) : joined && (
        <>
            {hintsRow}
            {mp.mode === "couch" && !runsRmg && (
                <PanelSectionRow>
                    <div style={bodyTextStyle()}>
                        {t(language, joined.status?.hardcore ? "Hardcore on, set by the host" : "Hardcore off, set by the host")}
                    </div>
                </PanelSectionRow>
            )}
            {mp.mode === "couch" && joined.room.share && joined.room.emulator === "retroarch" && (
                <PanelSectionRow>
                    <div style={bodyTextStyle()}>{t(language, "Controls shared, set by the host")}</div>
                </PanelSectionRow>
            )}
            <RoomTable
                language={language}
                seats={Array.from({ length: joined.room.max }, (_, index) => {
                    const flags = joined.status?.seats[index];
                    const name = joined.status?.members[index] ?? joined.room.seats[index] ?? "";
                    const pic = joined.status?.ids[index]?.pic ?? "";
                    return {
                        name,
                        game: index === 0 ? joined.room.title : flags?.title ?? "",
                        tag: index === 0 ? "host" : index === joined.seat ? "you" : "",
                        mark: !name || index === 0 || !flags ? "" : !flags.can ? "cant" : flags.ready ? "ready" : "",
                        activity: !name || roomState === "lobby" ? "" : index === 0 ? "game"
                            : (index === joined.seat ? joined.launched : flags?.launched)
                                ? (joined.room.watch ? "watch" : "game") : "",
                        avatar: pic ? friends.state.avatars[pic] : undefined,
                        open: Boolean(name) && index !== joined.seat
                    };
                })}
                onSeat={(index) => {
                    const ids = joined.status?.ids[index];
                    openSeat(index, joined.status?.members[index] ?? "", index === 0 ? joined.room.title
                        : joined.status?.seats[index]?.title ?? "", ids?.ulid ?? "", ids?.pic ?? "");
                }}
                exitKey="multiplayer:leave"
            />
            {inviteRow}
            {chatRows}
        </>
    );

    const notesRow = (warnings.length > 0 || tips.length > 0) && (
        <PanelSectionRow>
            <FocusableItem
                bottomSeparator="none"
                outerStyle={buttonStyle}
                focusKey="multiplayer:notes"
                focusFallback={[joined ? "multiplayer:leave" : "multiplayer:host", `multiplayer:mode:${mp.mode}`, "multiplayer:back"]}
                onClick={() => showMultiplayerProblem(language, "Before You Play", [...warnings, ...tips])}
            >
                <div style={{ width: "100%", textAlign: "center" }}>
                    {t(language, "Before You Play")}
                    {warnings.length > 0 && (
                        <span style={{ position: "absolute", top: "3px", right: "4px", color: warnAmber, fontWeight: 800,
                            fontSize: "0.76em", lineHeight: 1 }}>
                            {warnings.length}
                        </span>
                    )}
                </div>
            </FocusableItem>
        </PanelSectionRow>
    );

    const showHardcore = (mp.mode === "link" || !couchGuest) && !runsRmg;
    const showShare = mp.mode === "couch" && !joined && (hosted?.emulator ?? local?.emulator) === "retroarch";
    const showChangeGame = hosted !== null || (joined !== null && mp.mode === "link");
    const optionRows = (showChangeGame || showCores || showHardcore || showShare) && (
        <>
            <SectionTitle label={t(language, "Options")} />
            {showChangeGame && (
                <PanelSectionRow>
                    <FocusableItem
                        bottomSeparator="none"
                        outerStyle={buttonStyle}
                        focusKey="multiplayer:changegame"
                        focusFallback={["multiplayer:core", hosted ? "multiplayer:host" : "multiplayer:leave", "multiplayer:back"]}
                        disabled={mp.busy || !inLobby || Boolean(joined?.ready)}
                        onClick={() => void (hosted ? openGamePicker(actions.changeGame) : openGuestGames())}
                    >
                        {t(language, "Change Game")}
                    </FocusableItem>
                </PanelSectionRow>
            )}
            {coreRows}
            {showHardcore && hardcoreRow}
            {showShare && shareRow}
            {showShare && watchRow}
        </>
    );

    return (
        <Focusable
            key="multiplayer:view"
            flow-children="column"
            onCancelButton={pressBack}
            onOptionsButton={onPlay && yStarts ? () => void actions.start() : undefined}
            onOptionsActionDescription={onPlay && yStarts ? t(language, "mp_footer_start") : undefined}
            onSecondaryButton={onPlay && xReadies ? pressPlay : undefined}
            onSecondaryActionDescription={onPlay && xReadies ? t(language, joined?.ready ? "mp_footer_unready" : "mp_footer_ready") : undefined}
        >
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

                <Focusable
                    flow-children="row"
                    style={{ width: "100%", display: "flex", gap: "6px", margin: "6px 0 4px 0" }}
                >
                    {TABS.map((entry) => (
                        <SubTabButton
                            key={entry.tab}
                            label={t(language, entry.labelKey)}
                            active={tabs.tab === entry.tab}
                            onClick={() => tabs.show(entry.tab)}
                            focusKey={entry.focusKey}
                        />
                    ))}
                </Focusable>

                {!onPlay && (
                    <Focusable key="multiplayer:friends" flow-children="column">
                        <FriendsTab
                            language={language}
                            knobs={{
                                dynamicLoading: state.dynamicAllGames,
                                initialRows: state.dynamicInitialRows,
                                rowStep: state.dynamicRowStep,
                                prefetchDistance: state.dynamicPrefetchDistance,
                                sentinelRootMarginPx: state.dynamicSentinelRootMargin
                            }}
                            landingWindows={landingWindows}
                        />
                    </Focusable>
                )}

                {onPlay && (
                    <Focusable key="multiplayer:play" flow-children="column">
                        <PanelSectionRow>
                            <div style={{ width: "100%", paddingTop: "8px" }}>
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
                                {statusRow}
                                <ModeChoice
                                    language={language}
                                    mode={mp.mode}
                                    locked={joined !== null || (hosted !== null && hosted.state !== "lobby")}
                                    onChoose={chooseMode}
                                />
                                <PanelSectionRow>
                                    <div style={bodyTextStyle()}>
                                        {t(language, mp.mode === "link"
                                            ? "Each device runs its own copy of the game."
                                            : "Everyone plays one shared game.")}
                                    </div>
                                </PanelSectionRow>
                                {missedLine && (
                                    <PanelSectionRow>
                                        <div style={{ ...bodyTextStyle(), color: errorRed, opacity: 1 }}>
                                            {problemText(language, missedLine.code, missedLine.detail)}
                                        </div>
                                    </PanelSectionRow>
                                )}
                                {shownProblem && (
                                    <PanelSectionRow>
                                        <div style={{ ...bodyTextStyle(), color: warnAmber, opacity: 1 }}>
                                            {problemText(language, shownProblem.code, shownProblem.detail)}
                                        </div>
                                    </PanelSectionRow>
                                )}

                                <Focusable key={scopeKey} flow-children="column" resetNavOnEntry>
                                    {notesRow}
                                    {roomButton}
                                    {roomRows}
                                    {optionRows}
                                    <BottomFocusAnchor focusKey="multiplayer:bottom:anchor" />
                                </Focusable>
                            </>
                        )}
                    </Focusable>
                )}
            </PanelSection>
        </Focusable>
    );
}

export default skipWhileHidden(MultiplayerPage, (props) => props.state.view === "multiplayer");
