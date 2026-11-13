import { DialogButton, Focusable, PanelSectionRow, SliderField } from "@decky/ui";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { PanelSection } from "../components/ui/PanelSection";
import { BackButton } from "../components/ui/BackButton";
import { BottomFocusAnchor } from "../components/ui/BottomFocusAnchor";
import { FocusableItem } from "../components/ui/FocusableItem";
import { ConfirmRow } from "../components/ui/ConfirmRow";
import { FocusTarget } from "../components/ui/FocusTarget";
import { PageHelpButton, PageNavStrip } from "../components/ui/PageNavStrip";
import { SubTabButton } from "../components/ui/SubTabButton";
import { ModeChart } from "../components/multiplayer/ModeChart";
import { showFixIt, type FixItRequest } from "../components/multiplayer/FixItModal";
import { FixRunLine } from "../components/multiplayer/FixRunLine";
import { setMultiplayerPageShown, useFixPlan } from "../utils/fixPlan";
import { forgetGameFile, gameFilePickFailure, useGameFilePick } from "../utils/gameFilePick";
import { showMultiplayerProblem } from "../components/multiplayer/ProblemModal";
import { openStreamSetup } from "../components/multiplayer/StreamSetupModal";
import { TextViewerModal } from "../components/ui/TextViewerModal";
import { ToggleRow } from "../components/ui/ToggleRow";
import { GameHeaderCard, useGameHeaderArt } from "../components/games/GameHeaderCard";
import { openCorePicker } from "../components/multiplayer/CorePickerModal";
import { showPlayWith } from "../components/game/PlayWithModal";
import { RoomChatBox } from "../components/multiplayer/RoomChatBox";
import { RoomTable, type RoomTableVoice, type StreamSeatState } from "../components/multiplayer/RoomTable";
import { ROOM_TABS, RoomTabs } from "../components/multiplayer/RoomTabs";
import { GameVoteTab } from "../components/multiplayer/GameVoteTab";
import { LoungeTab } from "../components/multiplayer/LoungeTab";
import { pressOwnMic } from "../components/multiplayer/VoiceDialogs";
import { FriendsTab } from "../components/multiplayer/FriendsTab";
import { openSeatCard } from "../components/multiplayer/SeatCardModal";
import { openInviteFriends } from "../components/multiplayer/InviteFriendsModal";
import { openChatSay } from "../components/multiplayer/ChatSayModal";
import { openMessageCenter } from "../components/multiplayer/MessageCenterModal";
import { openHostRoom } from "../components/multiplayer/HostRoomModal";
import { openStreamScreenWarning } from "../components/multiplayer/StreamScreenWarningModal";
import { openRooms } from "../components/multiplayer/RoomsModal";
import { SectionTitle } from "../components/ui/SectionTitle";
import { useMultiplayer } from "../components/multiplayer/MultiplayerContext";
import { CheevoCheckGamesModal } from "../components/pickers/CheevoCheckGamesModal";
import { skipWhileHidden } from "../components/panel/skipWhileHidden";
import { landOnTop, usePageLanding, type LandingWindows } from "../focusRecords";
import { t, type LanguageCode } from "../locales";
import type {
    ButtonSpacing,
    MultiplayerCoreChoice,
    MultiplayerGuestGame,
    MultiplayerAdapter,
    MultiplayerLoungeGame,
    MultiplayerMode,
    MultiplayerRoomTab,
    MultiplayerSeatState,
    MultiplayerTab,
    Payload,
    ShortcutButton,
    ViewKey
} from "../types";
import { showManagedModal } from "../utils/modalRegistry";
import { logError } from "../utils/errors";
import { multiplayerCouchChoices, multiplayerGuestGames, multiplayerPlayChoices, multiplayerSetStreamPick } from "../api";
import { anyGameRunning, otherGameRunning } from "../utils/multiplayerSession";
import {
    forgetMultiplayerRoomTab,
    multiplayerChoices,
    rememberMultiplayerLoungeGame,
    rememberMultiplayerRoomTab
} from "../utils/multiplayerChoices";
import { shortcutButtonGlyphs } from "../utils/options";
import { changeMicLevel, changePttToggle, changePushToTalk, changeSensitivity, usePushToTalk, useVoiceChat } from "../utils/voiceChat";
import {
    changeDuck,
    changeDuckStrength,
    changeGameVolume,
    changeIncomingVolume,
    useGameVolume
} from "../utils/gameVolume";
import { changeOutputVolume, useOutputVolume } from "../utils/outputVolume";
import { screenMaxRefresh } from "../utils/screenRefresh";
import {
    changeSlowConnection,
    pressRemoveStreaming,
    setupRunning,
    streamScreenWarningOff,
    updateStreaming,
    useSlowConnection,
    useStreamSetup
} from "../utils/streamPlay";
import { changeChatToastsInGame, useChatToastsInGame } from "../utils/multiplayerRoomState";
import { ProgressBar } from "../components/ui/ProgressBar";
import { hotspotWithoutInternet, useHotspot } from "../utils/hotspotState";
import { getCurrentControllerGlyphStyle } from "../utils/controllerGlyphs";
import { ButtonHints, type ButtonHint } from "../components/ui/ButtonHints";
import { openExternalUrl, raLookupSearchUrl } from "../utils/navigation";
import { playMoveSound } from "../utils/navSound";
import { ROOM_ENDED, gateText, problemText, roomGameWhy, streamHostProblemText, warningText } from "../utils/multiplayerProblems";
import {
    achievementGreen,
    bodyTextStyle,
    errorRed,
    regularButtonSpacingStyle,
    steamPlayGreen,
    steamPlayGrey,
    steamPlayGreyText,
    warnAmber
} from "../utils/style";

const BACK_BUTTON_SCROLL_MARGIN_PX = 24;
const NAV_ENTER_MAINTAIN_Y = 3;
const FIX_DONE_MS = 4000;
let fixDoneShownFor = 0;
const DIR_UP = 9;

const DOLPHIN_CONSOLES = ["GameCube", "Wii"];
const GBA_SYSTEM = 5;
const NO_CORES: MultiplayerCoreChoice[] = [];

const STREAM_SEAT_STATES: StreamSeatState[] = ["pairing", "connecting", "streaming", "relay", "failed"];

function asSentence(language: LanguageCode, text: string): string {
    const trimmed = text.trim();
    if (/[.!?。！？]$/.test(trimmed)) {
        return trimmed;
    }
    return trimmed + (language === "ja" ? "。" : ".");
}

function seatMark(ready: boolean, seatState: MultiplayerSeatState | undefined, can: boolean): "ready" | MultiplayerSeatState {
    if (ready) {
        return "ready";
    }
    return seatState || (can ? "" : "never");
}

function streamSeat(value: string | undefined): StreamSeatState {
    return STREAM_SEAT_STATES.find((state) => state === value) ?? "";
}

const TABS: { tab: MultiplayerTab; labelKey: string; focusKey: string }[] = [
    { tab: "play", labelKey: "Play", focusKey: "multiplayer:tab:play" },
    { tab: "friends", labelKey: "Friends", focusKey: "multiplayer:tab:friends" }
];


const SETUP_LINES: Record<string, { key: string; color?: string }> = {
    sunshine: { key: "Downloading Sunshine…" },
    moonlight: { key: "Installing Moonlight…" },
    finishing: { key: "Finishing setup…" },
    done: { key: "Streaming is ready." },
    failed: { key: "Couldn't set up streaming. Check your internet connection and try again.", color: errorRed }
};

const UPDATE_LINES: Record<string, { key: string; color?: string }> = {
    sunshine: { key: "Updating Sunshine…" },
    moonlight: { key: "Updating Moonlight…" },
    finishing: { key: "Finishing the update…" },
    done: { key: "Streaming is ready." },
    failed: { key: "Couldn't update streaming. Check your internet connection and try again.", color: errorRed }
};

const MODE_FACTS = ["link_system", "link_gc_no_lan", "ds_no_couch", "pcsx2_no_multiplayer", "link_gba_cant_link"];

const ADAPTER_LABELS: Record<string, string> = {
    team: "Multiplayer Adapter: Team Player",
    "4way": "Multiplayer Adapter: 4-Way Play",
    port1: "Multitap: Port 1",
    port2: "Multitap: Port 2",
    "auto:team": "Multiplayer Adapter: Auto (Team Player)",
    "auto:4way": "Multiplayer Adapter: Auto (4-Way Play)",
    "auto:port1": "Multitap: Auto (Port 1)",
    "auto:port2": "Multitap: Auto (Port 2)"
};

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
    onSetUpVoiceShortcuts: () => void;
};

type MultiplayerPageProps = {
    state: MultiplayerPageState;
    actions: MultiplayerPageActions;
};

function HintSlot(props: { forms: ButtonHint[]; shown: number; over?: ButtonHint }) {
    const style = getCurrentControllerGlyphStyle();
    return (
        <div style={{ display: "inline-grid" }}>
            {props.forms.map((form, index) => (
                <div key={index} style={{ gridArea: "1 / 1", visibility: index === props.shown ? "visible" : "hidden" }}>
                    <ButtonHints style={style} hints={[form]} />
                </div>
            ))}
            {props.over && (
                <div style={{ gridArea: "1 / 1", width: 0, whiteSpace: "nowrap" }}>
                    <ButtonHints style={style} hints={[props.over]} />
                </div>
            )}
        </div>
    );
}

function OutputVolumeRow(props: { language: LanguageCode; heading: boolean; style: CSSProperties; focusFallback: string[] }) {
    const volume = useOutputVolume();
    if (volume === null) {
        return null;
    }
    return (
        <>
            {props.heading && <SectionTitle label={t(props.language, "Global")} />}
            <PanelSectionRow>
                <FocusTarget focusKey="multiplayer:voice:output" focusFallback={props.focusFallback} style={props.style}>
                    <SliderField
                        label={t(props.language, "Master Volume")}
                        description={t(props.language, "Volume for everything you hear.")}
                        value={volume}
                        min={0}
                        max={100}
                        step={5}
                        showValue
                        valueSuffix="%"
                        layout="below"
                        bottomSeparator="none"
                        onChange={changeOutputVolume}
                    />
                </FocusTarget>
            </PanelSectionRow>
        </>
    );
}

function MultiplayerPage(props: MultiplayerPageProps) {
    const { state, actions: page } = props;
    const { language } = state;
    const visible = state.view === "multiplayer";
    const { state: mp, actions, friends, page: tabs } = useMultiplayer();
    const fixPlan = useFixPlan();
    const gameFilePick = useGameFilePick().pick;
    const fixRun = fixPlan.run;
    const [fixDoneShown, setFixDoneShown] = useState(false);

    useEffect(() => {
        setMultiplayerPageShown(visible);
        return () => setMultiplayerPageShown(false);
    }, [visible]);

    useEffect(() => {
        if (!fixRun?.done || fixPlan.finished === fixDoneShownFor) {
            return;
        }
        fixDoneShownFor = fixPlan.finished;
        setFixDoneShown(true);
        const timer = window.setTimeout(() => setFixDoneShown(false), FIX_DONE_MS);
        return () => window.clearTimeout(timer);
    }, [fixPlan.finished]);
    const landingWindows = useRef<LandingWindows | null>(null);
    const streamModeNav = useRef<any>(null);
    const [playFocused, setPlayFocused] = useState(false);
    const [screenHz, setScreenHz] = useState<number | null>(null);
    const voice = useVoiceChat(visible);
    const [seatAction, setSeatAction] = useState<{ label: string | null; own: boolean }>({ label: null, own: false });
    const pushToTalk = usePushToTalk();
    const gameVolume = useGameVolume(visible);
    const stream = useStreamSetup(visible && mp.mode === "stream");
    const slowConnection = useSlowConnection();
    const chatToastsInGame = useChatToastsInGame();
    const hotspot = useHotspot();

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

    const roomId = mp.hosted?.id ?? mp.joined?.room.room ?? "";
    const roomVoice = mp.hosted ? mp.hosted.voice : Boolean(mp.joined?.room.voice);
    const [roomTabChoice, setRoomTabChoice] = useState(() => multiplayerChoices().roomTab);
    const streamRoom = (mp.hosted?.mode ?? mp.joined?.room.mode) === "stream";
    const tabOff: Partial<Record<MultiplayerRoomTab, boolean>> = { audio: !roomVoice, stream: !streamRoom };
    const chosenTab = roomTabChoice.room === roomId ? roomTabChoice.tab : "room";
    const roomTab: MultiplayerRoomTab = ROOM_TABS.some((entry) => entry.tab === chosenTab) && !tabOff[chosenTab] ? chosenTab : "room";
    function showRoomTab(tab: MultiplayerRoomTab) {
        setRoomTabChoice({ room: roomId, tab });
        rememberMultiplayerRoomTab(roomId, tab);
    }
    useEffect(() => {
        if (mp.loaded && !roomId) {
            setRoomTabChoice({ room: "", tab: "room" });
            forgetMultiplayerRoomTab();
        }
    }, [mp.loaded, roomId]);
    const tabBodyRef = useRef<HTMLDivElement | null>(null);
    const cursorTab = useRef<MultiplayerRoomTab | null>(null);
    const lostTab = roomTabChoice.room === roomId && tabOff[roomTabChoice.tab] ? roomTabChoice.tab : null;
    useEffect(() => {
        if (!lostTab) {
            return;
        }
        const wasInside = cursorTab.current === lostTab;
        showRoomTab("room");
        if (wasInside) {
            landOnTop("multiplayer", "multiplayer:roomtab:room");
        }
    }, [lostTab]);
    const cursorOnChart = useRef(false);
    const guestMode = mp.joined?.room.mode ?? null;
    const seenGuestMode = useRef(guestMode);
    useEffect(() => {
        const before = seenGuestMode.current;
        seenGuestMode.current = guestMode;
        if (guestMode && before && before !== guestMode && cursorOnChart.current) {
            landOnTop("multiplayer", `multiplayer:mode:${guestMode}`);
        }
    }, [guestMode]);
    const [loungeGame, setLoungeGame] = useState(() => multiplayerChoices().loungeGame);
    function showLoungeGame(game: MultiplayerLoungeGame) {
        setLoungeGame(game);
        rememberMultiplayerLoungeGame(game);
    }

    usePageLanding({
        view: "multiplayer",
        active: visible,
        subject: null,
        tabPath: [tabs.tab, mp.mode, roomTab, loungeGame],
        restoreTabPath: ([nextTab, nextMode, nextRoomTab, nextLounge]) => {
            let changed = false;
            const tab = TABS.find((entry) => entry.tab === nextTab);
            if (tab && tab.tab !== tabs.tab) {
                tabs.show(tab.tab);
                changed = true;
            }
            if ((nextMode === "link" || nextMode === "couch" || nextMode === "stream") && nextMode !== mp.tab && !mp.hosted && !mp.joined) {
                actions.setTab(nextMode);
                changed = true;
            }
            const nextShown = ROOM_TABS.find((entry) => entry.tab === nextRoomTab)?.tab;
            if (roomId && nextShown && !tabOff[nextShown] && nextShown !== roomTab) {
                showRoomTab(nextShown);
                changed = true;
            }
            if ((nextLounge === "ttt" || nextLounge === "c4" || nextLounge === "rev") && nextLounge !== loungeGame) {
                showLoungeGame(nextLounge);
                changed = true;
            }
            return changed;
        },
        defaultKey: "multiplayer:back",
        ready: tabs.tab === "friends" ? friends.state.data !== null : drawLower && (mp.gameId === null || mp.modes !== null),
        holds: (key) => landingWindows.current?.holds(key) ?? false,
        open: (key) => landingWindows.current?.open(key),
        timing: { revealDeadlineMs: 1000, pressGuardCeilingMs: 1050 }
    });

    const shown = mp.gameId !== null && mp.gameId === currentGameId ? state.payload : mp.headerPayload;
    const art = useGameHeaderArt(mp.gameId, shown, state.showIcons && visible);

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
    const couchGuest = (mp.mode === "couch" || mp.mode === "stream") && joined !== null;

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
    const canStartShown = Boolean(hosted?.canStart) && local !== null && !shownCheck?.gate && !otherGameRunning() && !playing;
    const readyShown = Boolean(joined && inLobby && !joined.launched
        && (joined.ready || (local !== null && !shownCheck?.gate && !runningOther)));
    const readyAllowed = Boolean(joined && inLobby && !joined.launched
        && (joined.ready || (ownGameOk && !runningOther)));
    const canRejoinShown = Boolean(joined?.rejoin) && !playing && !runningOther && ownGameOk;
    const roomMode = hosted?.mode ?? joined?.room.mode;
    const dropIn = roomMode === "stream" || (roomMode === "couch" && (hosted?.emulator ?? joined?.room.emulator) === "retroarch");
    const canJoinLateShown = !playing && !runningOther && ownGameOk;

    const problem = gameProblem();
    const modeFact = problem && MODE_FACTS.includes(problem.code) ? problem : null;
    const shownProblem = problem && !modeFact ? problem : null;
    const inSession = hosted !== null || joined !== null;

    const endedCode = !inSession ? mp.closedReason
        : joined && ROOM_ENDED.includes(joined.error) ? joined.error : "";
    const missedLine = mp.missed ?? (endedCode && !mp.endedLineCleared ? { code: endedCode } : null);

    function problemLine(code: string, detail?: Record<string, string>) {
        if (mp.mode === "stream" && !joined) {
            return streamHostProblemText(language, code, detail);
        }
        return problemText(language, code, detail);
    }

    const roomWarnings = (shownCheck?.warnings ?? []).map((warning) => warningText(language, warning.code, warning.detail));
    const fixHere = fixRun !== null && fixRun.target !== "play" && (fixRun.running || fixRun.gameId === mp.gameId) ? fixRun : null;
    const installing = mp.mode === "stream" && setupRunning(stream);
    const settingUp = mp.mode === "stream" && (installing || stream.lastJob === "setup") ? stream.stage : "";
    const setupLine = SETUP_LINES[settingUp] ?? null;
    const updating = setupRunning(stream, "update");
    const updateLine = updating || stream.lastJob === "update" ? UPDATE_LINES[stream.stage] ?? null : null;
    const needsSetup = mp.mode === "stream" && shownProblem?.code === "stream_not_set_up";
    const setupPending = needsSetup && !installing;
    const problemShown = shownProblem && !(shownProblem.code === "stream_not_set_up" && !setupPending) ? shownProblem : null;
    const chartShowsGate = mp.modes === null || mp.modes.modes[mp.mode] !== undefined;
    const lineProblem = problemShown && (mp.visibleError || !chartShowsGate) ? problemShown : null;
    const problemLines = [
        ...(missedLine ? [{ text: problemText(language, missedLine.code, missedLine.detail), color: errorRed }] : []),
        ...(setupLine && !installing ? [{ text: t(language, setupLine.key), color: setupLine.color }] : []),
        ...(hosted?.streamChecking ? [{ text: t(language, "Checking your connection…"), color: undefined }] : []),
        ...(joined?.streamBusy ? [{ text: problemText(language, "stream_busy"), color: warnAmber }] : []),
        ...(lineProblem ? [{ text: problemLine(lineProblem.code, { size: stream.size || "?", ...lineProblem.detail }),
            color: warnAmber }] : []),
        ...roomWarnings.map((text) => ({ text, color: warnAmber }))
    ];
    function sixtyHzNote() {
        if (mp.mode === "couch") {
            return t(language, "Couch Play runs best when every player's screen runs at the same refresh rate. A mismatch, such as 90 Hz and 60 Hz, makes the game jitter or warp. 60 Hz is the safest choice: set it in Steam's Performance menu while the game runs.");
        }
        if (mp.mode === "stream" && joined) {
            return t(language, "Stream Play looks smoothest with your screen at 60 Hz. The stream runs at 60 fps, so a faster screen shows it unevenly. Set 60 Hz in Steam's Performance menu while you play.");
        }
        if (mp.mode === "stream") {
            return t(language, "Stream rooms run best with your screen at 60 Hz. Above that, your game looks smooth to you but jitters for your guests, because the stream runs at 60 fps and the mismatch skips frames unevenly.");
        }
        return t(language, "Multiplayer runs best with every player's screen at 60 Hz. If the game jitters, set 60 Hz in Steam's Performance menu while it runs.");
    }

    const warnings = [
        ...(runsPpsspp ? [t(language, "PSP multiplayer is experimental. Some games lose the connection when a match starts.")] : []),
        ...(screenHz !== null && (screenHz === 0 || screenHz > 60) ? [sixtyHzNote()] : []),
        ...(runsRmg ? [t(language, "rmg_heads_up")] : [])
    ];
    const tips = [
        ...(mp.mode === "link" ? [problemText(language, "link_system")] : []),
        ...(modeFact && modeFact.code !== "link_system" ? [problemText(language, modeFact.code, modeFact.detail)] : []),
        ...(mp.mode === "couch" && local?.emulator === "dolphin"
            ? [t(language, joined
                ? "In Dolphin, open Tools, then Start NetPlay, then Connect. The host's address is filled in."
                : "In Dolphin, open Tools, then Start NetPlay, then Host. Pick the game and press Start once everyone has joined.")]
            : []),
        ...(runsRmg ? [t(language, joined ? "rmg_steps_guest" : "rmg_steps_host", { game: roomTitle })] : [])
    ];

    let playLabel = "Host & Play";
    let canPlay = canStartShown;
    let pressPlay = () => {
        if (canStartNow) {
            void actions.start();
        }
    };
    if (hosted && !inLobby) {
        canPlay = false;
    }
    else if (joined) {
        if (inLobby) {
            playLabel = joined.ready ? "Unready" : "Ready";
            canPlay = readyShown;
            pressPlay = () => {
                if (!mp.busy && readyAllowed) {
                    void actions.toggleReady();
                }
            };
        }
        else if (joined.rejoin) {
            playLabel = joined.room.watch ? "Watch" : "Join & Play";
            canPlay = canRejoinShown;
            pressPlay = () => {
                if (!mp.busy && canRejoinShown) {
                    void actions.play();
                }
            };
        }
        else if (dropIn) {
            playLabel = joined.room.watch ? "Watch" : "Join & Play";
            canPlay = roomState === "playing" && !joined.status?.start && !joined.ready && !joined.launched
                && canJoinLateShown;
            pressPlay = () => {
                if (!mp.busy && canPlay) {
                    void actions.joinLate();
                }
            };
        }
        else {
            playLabel = "Ready";
            canPlay = false;
        }
    }
    function startWhy(): string | null {
        if (!inLobby || playing) {
            return null;
        }
        const own = mp.modes?.modes[mp.mode];
        const ownGate = own && own.state !== "ready" ? own.gate : null;
        if (hosted?.hostState) {
            const gate = ownGate ?? hosted.hostGate;
            const detail = ownGate ? own?.detail ?? {} : hosted.hostDetail;
            return hosted.hostState === "setup"
                ? t(language, "Setup is needed for this game first. Select “Needs setup” on the chart to fix it.")
                : t(language, "This game won't work on your device. {{reason}} Pick another game with Change Game.",
                    { reason: asSentence(language, reasonText(mp.mode, gate, detail)) });
        }
        if (!joined || joined.ready || joined.launched) {
            return null;
        }
        if (ownGate) {
            return own?.state === "setup"
                ? t(language, "Setup is needed for this game first. Select “Needs setup” on the chart to fix it.")
                : t(language, "This game won't work on your device. {{reason}}",
                    { reason: asSentence(language, reasonText(mp.mode, ownGate, own?.detail ?? {})) });
        }
        return null;
    }
    const whyNot = canPlay ? null : startWhy();
    function explainStart() {
        if (whyNot) {
            showMultiplayerProblem(language, hosted ? "Start" : "Ready", whyNot);
        }
    }

    const playFixable = !canPlay && inLobby && inSession && Boolean(shownCheck?.gate);
    const hostGated = !hosted && Boolean((mp.modes?.modes[mp.mode] ?? shownCheck)?.gate);
    const playGreen = playLabel !== "Unready";
    const playBackground = !playGreen || playFocused ? undefined : canPlay ? steamPlayGreen : steamPlayGrey;
    const playColor = !playGreen || playFocused ? undefined : canPlay ? "#ffffff" : steamPlayGreyText;
    const yStarts = canStartShown && !state.mouseKeyboardMode;
    const xReadies = readyShown && !state.mouseKeyboardMode;
    const yExplains = Boolean(hosted) && !yStarts && Boolean(whyNot) && !state.mouseKeyboardMode;
    const xExplains = Boolean(joined) && !xReadies && Boolean(whyNot) && !state.mouseKeyboardMode;
    const yFixes = Boolean(hosted) && !yStarts && playFixable && !state.mouseKeyboardMode;
    const xFixes = Boolean(joined) && !xReadies && playFixable && !state.mouseKeyboardMode;
    const openOwnFix = () => openModeReason(mp.mode);
    const slotStyle = { display: "flex", width: "100%", marginTop: "8px" };
    const slotButtonStyle = { width: "100%", minWidth: 0 };

    const title = shown?.title ?? local?.title ?? mp.games?.find((game) => game.gameId === mp.gameId)?.title ?? null;

    function pressBack() {
        void page.onBack();
    }

    function pressUpdateStreaming() {
        if (hosted && hosted.mode === "stream") {
            showMultiplayerProblem(language, "Update Streaming Tools", t(language, "Close your Stream Play room before updating."));
            return;
        }
        if (!updating) {
            void updateStreaming();
        }
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
            voice: voice.on,
            openMessages: friend
                ? () => openMessageCenter(language, { friend, avatars, selfPic: data?.selfPic ?? "" })
                : null
        });
    }

    function pickerRows() {
        return (mp.games ?? []).map((game) => ({
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
    }

    function openGamePicker(pick: (gameId: number) => void) {
        showManagedModal((close) => (
            <CheevoCheckGamesModal
                language={language}
                showIcons={state.showIcons}
                kind="supported"
                rows={pickerRows()}
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

    function openVotePicker(onDone: (gameIds: number[]) => void) {
        showManagedModal((close) => (
            <CheevoCheckGamesModal
                language={language}
                showIcons={state.showIcons}
                kind="supported"
                rows={pickerRows()}
                onPick={() => undefined}
                onWebSearch={(search) => {
                    close();
                    void openExternalUrl(raLookupSearchUrl(search));
                }}
                close={close}
                multi={{
                    max: 4,
                    onFull: (row) => showMultiplayerProblem(language, row.title, roomGameWhy(language, "vote_four")),
                    onDone
                }}
            />
        ));
    }

    function reasonText(forMode: MultiplayerMode, gate: string, detail: Record<string, string>) {
        if (gate === "not_in_results" && detail.dolphinSkipped && DOLPHIN_CONSOLES.includes(shown?.consoleName ?? "")) {
            return problemText(language, "dolphin_flatpak_needed");
        }
        return gateText(language, forMode, gate, { size: stream.size || "?", ...detail }, Boolean(joined));
    }

    function fixRequest(forMode: MultiplayerMode): FixItRequest {
        const entry = mp.modes?.modes[forMode];
        const forGame = fixRun?.running ? fixRun.gameId : mp.gameId ?? 0;
        return {
            target: forMode,
            gameId: forGame,
            title: fixRun?.running ? fixRun.title : title ?? String(forGame),
            answer: {
                state: entry?.state ?? "setup",
                gate: entry?.gate ?? null,
                detail: entry?.detail ?? {},
                plan: entry?.plan ?? { outcome: "blocked", stages: [], steps: [], blocker: null }
            },
            tools: mp.modes?.tools ?? null,
            explain: (gate, detail) => reasonText(forMode, gate, detail),
            refresh: () => actions.fixFor(forMode, forGame),
            forget: () => forgetGameFile(forGame)
        };
    }

    function openModeReason(forMode: MultiplayerMode) {
        if (fixRun?.running && fixRun.target !== "play") {
            showFixIt(language, fixRequest(fixRun.target));
            return;
        }
        const entry = mp.modes?.modes[forMode];
        if (!mp.modes || !entry?.gate || entry.state === "ready") {
            return;
        }
        showFixIt(language, fixRequest(forMode));
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
        if (mp.gameId === null) {
            return;
        }
        multiplayerCouchChoices(mp.gameId)
            .then((found) => {
                if (found.ok) {
                    openCorePicker({ language, choices: found, onPick: actions.chooseCouchPick });
                }
            })
            .catch((e) => logError("multiplayer: listing the Couch choices", e));
    }

    function openRunsWith() {
        if (mp.gameId === null) {
            return;
        }
        const forGame = mp.gameId;
        multiplayerPlayChoices(forGame)
            .then((found) => {
                if (!found.ok) {
                    return;
                }
                showPlayWith({
                    language,
                    purpose: "set",
                    choices: found,
                    onPick: (pick, remember) => multiplayerSetStreamPick(forGame, pick, remember)
                        .then(() => undefined)
                        .catch((e) => logError("multiplayer: saving the Stream pick", e)),
                    onForget: () => multiplayerSetStreamPick(forGame, null, true)
                        .then(() => undefined)
                        .catch((e) => logError("multiplayer: forgetting the Stream pick", e))
                });
            })
            .catch((e) => logError("multiplayer: listing what can run the game", e));
    }

    function describe(code: string, detail?: Record<string, string>) {
        return problemText(language, code, detail);
    }

    function openHost() {
        if (mp.gameId === null) {
            return;
        }
        const request = {
            mode: mp.mode,
            gameId: mp.gameId,
            hardcore: mp.hardcore,
            core: "",
            share: mp.shareControls,
            watch: mp.watchOnly
        };
        const place = {
            online: mp.lobby,
            lanOnly: Boolean(mp.check?.lanOnly),
            noInternet: hotspotWithoutInternet(hotspot)
        };
        if (mp.mode === "stream" && !streamScreenWarningOff()) {
            openStreamScreenWarning(language, () => openHostRoom(language, request, place, describe));
            return;
        }
        openHostRoom(language, request, place, describe);
    }

    const buttonStyle = regularButtonSpacingStyle(state.buttonSpacing);
    const coreLabel = local
        ? local.picked && !joined
            ? t(language, "Core: {{core}} (your pick)", { core: local.coreName })
            : local.core === local.shortcutCore
            ? t(language, "Core: {{core}} (from your shortcut)", { core: local.coreName })
            : joined
                ? t(language, "Core: {{core}} (matches the host)", { core: local.coreName })
                : t(language, "Core: {{core}}", { core: local.coreName })
        : "";
    const showCores = !joined && (mp.mode === "link"
        ? local?.emulator === "retroarch" && choices.length > 0
        : mp.mode === "couch" && ((local?.emulator === "retroarch" && choices.length > 0)
            || ((local?.emulator === "dolphin" || local?.emulator === "rmg") && (local.vehicles ?? 0) > 1)));
    const showRunsWith = Boolean(mp.mode === "stream" && !joined && local?.coreName);

    const scopeKey = joined ? "multiplayer:room" : `multiplayer:${mp.mode}`;

    const coreRows = showCores && (
        <>
            {mp.mode === "link" ? (
                <PanelSectionRow>
                    <div style={bodyTextStyle()}>{coreLabel}</div>
                </PanelSectionRow>
            ) : (
                <PanelSectionRow>
                    <FocusableItem
                        bottomSeparator="none"
                        outerStyle={buttonStyle}
                        focusKey="multiplayer:core"
                        focusFallback={["multiplayer:runswith", "multiplayer:host", "multiplayer:back"]}
                        disabled={roomLocked}
                        onClick={openCores}
                        help={roomLocked ? t(language, "Close the room to change it") : undefined}
                    >
                        {coreLabel}
                    </FocusableItem>
                </PanelSectionRow>
            )}
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
                            focusable={canPlay || playFixable || Boolean(whyNot)}
                            disabled={!canPlay && !playFixable && !whyNot}
                            onClick={canPlay ? pressPlay : playFixable ? () => openModeReason(mp.mode) : explainStart}
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
                            onClick={() => openGamePicker(actions.pickGame)}
                            style={slotButtonStyle}
                        >
                            {t(language, "Pick Another Game")}
                        </DialogButton>
                    </FocusTarget>
                )}
            </PanelSectionRow>
        </>
    );


    const hardcoreLocked = (mp.mode === "couch" || mp.mode === "stream") && roomLocked;
    const runsWithRow = showRunsWith && local && (
        <PanelSectionRow>
            <FocusableItem
                bottomSeparator="none"
                outerStyle={buttonStyle}
                focusKey="multiplayer:runswith"
                focusFallback={["multiplayer:host", "multiplayer:back"]}
                disabled={roomLocked}
                onClick={openRunsWith}
                help={roomLocked ? t(language, "Close the room to change it") : undefined}
            >
                {local.picked
                    ? t(language, "Runs with: {{core}} (your pick)", { core: local.coreName })
                    : local.fallback
                        ? t(language, "Runs with: {{core}} (recommended)", { core: local.coreName })
                        : t(language, "Runs with: {{core}} (from your shortcut)", { core: local.coreName })}
            </FocusableItem>
        </PanelSectionRow>
    );
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

    const ps1Tap = hosted?.adapterAuto === "port1" || hosted?.adapterAuto === "port2";
    const adapterNext: Record<MultiplayerAdapter, MultiplayerAdapter> = ps1Tap
        ? { auto: "port1", port1: "port2", port2: "auto", team: "auto", "4way": "auto" }
        : { auto: "team", team: "4way", "4way": "auto", port1: "auto", port2: "auto" };
    const adapterKey = !hosted ? "" : hosted.adapter === "auto" ? `auto:${hosted.adapterAuto || "4way"}` : hosted.adapter;
    const adapterRow = hosted && (
        <PanelSectionRow>
            <FocusableItem
                bottomSeparator="none"
                outerStyle={buttonStyle}
                focusKey="multiplayer:adapter"
                focusFallback={["multiplayer:toggle:watch", "multiplayer:toggle:share", "multiplayer:toggle:hardcore", "multiplayer:host"]}
                disabled={roomLocked}
                onClick={() => actions.setAdapter(adapterNext[hosted.adapter])}
                help={t(language, roomLocked ? "Close the room to change it" : ps1Tap ? "help_multiplayer_multitap" : "help_multiplayer_adapter")}
            >
                {t(language, ADAPTER_LABELS[adapterKey] ?? ADAPTER_LABELS["auto:4way"])}
            </FocusableItem>
        </PanelSectionRow>
    );

    const voiceRow = hosted && (
        <ToggleRow
            bottomSeparator="none"
            controlled
            label={t(language, "Voice Chat")}
            value={hosted.voice}
            outerStyle={buttonStyle}
            focusKey="multiplayer:toggle:voice"
            focusFallback={["multiplayer:adapter", "multiplayer:toggle:watch", "multiplayer:toggle:share", "multiplayer:toggle:hardcore", "multiplayer:host"]}
            onChange={actions.setVoice}
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
                    disabled={!hosted && (mp.gameId === null || !shownCheck || (Boolean(mp.visibleError) && mp.visibleError !== "cap_reached"))}
                    onClick={() => {
                        if (mp.busy) {
                            return;
                        }
                        if (hosted) {
                            void actions.closeRoom();
                        }
                        else if (hostGated) {
                            openModeReason(mp.mode);
                        }
                        else if (gateCheck) {
                            openHost();
                        }
                    }}
                >
                    <span style={{ opacity: hostGated ? 0.45 : 1 }}>{t(language, hosted ? "Close Room" : "Host a Room")}</span>
                </FocusableItem>
            </PanelSectionRow>
            {!hosted && (
                <PanelSectionRow>
                    <FocusableItem
                        bottomSeparator="none"
                        outerStyle={buttonStyle}
                        focusKey="multiplayer:find"
                        focusFallback={["multiplayer:host", `multiplayer:mode:${mp.mode}`, "multiplayer:back"]}
                        onClick={() => {
                            if (!mp.busy) {
                                openRooms(language, mp.hardcore, mp.installedCores, describe);
                            }
                        }}
                    >
                        {t(language, "Find a Room")}
                    </FocusableItem>
                </PanelSectionRow>
            )}
        </>
    );

    const ownSeat = hosted ? 0 : joined?.seat ?? -1;
    const tableVoice: RoomTableVoice | undefined = voice.on
        ? { own: ownSeat, mine: voice.mine, available: voice.available, speaking: voice.speaking, seats: voice.seats }
        : undefined;

    const roomHints = (
        <div style={{ opacity: (hosted ? canStartShown : readyShown) ? 1 : 0.45 }}>
            <ButtonHints
                style={getCurrentControllerGlyphStyle()}
                hints={hosted
                    ? [{ button: "y", label: t(language, "Start") }]
                    : [{ button: "x", label: t(language, joined?.ready ? "Unready" : "Ready") }]}
            />
        </div>
    );
    const voiceKey = pushToTalk.working ? pushToTalk.pttButton : pushToTalk.muteButton;
    const bigRoom = (hosted ? hosted.seats.length : joined?.room.max ?? 0) > 4;
    const seatHint = !bigRoom && seatAction.label;
    const voiceGlyphs = voiceKey ? shortcutButtonGlyphs(voiceKey as ShortcutButton) : [];
    const voiceLabels = !voice.on || !voiceKey ? []
        : pushToTalk.working ? ["PTT"] : ["Mute", "Unmute"];
    const voiceLabel = voiceLabels.length === 0 ? "" : pushToTalk.working ? "PTT" : voice.mine === "off" ? "Unmute" : "Mute";
    const sharedHint = !bigRoom && seatAction.own && Boolean(voiceLabel) && !pushToTalk.working;
    const voiceForms: ButtonHint[] = voiceLabels.map((label) => ({ button: voiceGlyphs, label: t(language, label) }));
    const voiceShown = voiceLabel && !sharedHint ? voiceLabels.indexOf(voiceLabel) : -1;
    const voiceOver: ButtonHint | undefined = sharedHint
        ? { button: voiceGlyphs, or: ["a"], label: t(language, voiceLabel) }
        : undefined;
    const seatForms: ButtonHint[] = ["Options", "Mute", "Unmute"].map((label) => ({ button: "a", label: t(language, label) }));
    const seatShown = seatHint && !sharedHint ? seatForms.findIndex((form) => form.label === seatHint) : -1;
    const hintsRow = !state.mouseKeyboardMode && (hosted || joined) && (
        <PanelSectionRow>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: "16px" }}>
                {roomHints}
                {voiceForms.length > 0 && <HintSlot forms={voiceForms} shown={voiceShown} over={voiceOver} />}
                {!bigRoom && <HintSlot forms={seatForms} shown={seatShown} />}
            </div>
        </PanelSectionRow>
    );
    const voiceLine = voice.on && !voice.available && (
        <PanelSectionRow>
            <div style={{ ...bodyTextStyle(), color: warnAmber, opacity: 1 }}>
                {t(language, "Voice needs the lobby server's relay, which isn't answering")}
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
            <SectionTitle label={t(language, "Chat")} />
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
                    mark: !seat ? "" : index === 0 ? hosted.hostState : seatMark(seat.ready, seat.seatState, seat.can),
                    activity: !seat ? "" : index === 0 ? (hosted.state === "lobby" ? "" : "game")
                        : seat.launched ? (hosted.watch ? "watch" : "game") : "",
                    stream: streamSeat(seat?.st),
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
                voice={tableVoice}
                onMic={() => pressOwnMic(language)}
                prompts={!state.mouseKeyboardMode}
                footer={bigRoom}
                ownPress={voice.on && !pushToTalk.working}
                onFocusAction={(label, own) => setSeatAction({ label, own })}
            />
            {voiceLine}
            {inviteRow}
            {chatRows}
        </>
    ) : joined && (
        <>
            <PanelSectionRow>
                <div style={{ ...bodyTextStyle(), visibility: mp.mode === "couch" && !runsRmg ? "visible" : "hidden" }}>
                    {t(language, joined.status?.hardcore ? "Host: Hardcore on" : "Host: Hardcore off")}
                    {joined.room.share && joined.room.emulator === "retroarch" ? ` · ${t(language, "Controls shared")}` : ""}
                </div>
            </PanelSectionRow>
            <RoomTable
                language={language}
                seats={Array.from({ length: joined.room.max }, (_, index) => {
                    const flags = joined.status?.seats[index];
                    const name = joined.status?.members[index] ?? joined.room.seats[index] ?? "";
                    const pic = joined.status?.ids[index]?.pic ?? "";
                    return {
                        name,
                        game: index === 0 ? joined.room.title : flags?.title ?? "",
                        tag: index === 0 ? "host" : "",
                        mark: !name ? "" : index === 0 ? joined.room.hostState : !flags ? "" : seatMark(flags.ready, flags.seatState, flags.can),
                        activity: !name ? "" : index === 0 ? (roomState === "lobby" ? "" : "game")
                            : (index === joined.seat ? joined.launched : flags?.launched)
                                ? (joined.room.watch ? "watch" : "game") : "",
                        stream: streamSeat(flags?.st),
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
                voice={tableVoice}
                onMic={() => pressOwnMic(language)}
                prompts={!state.mouseKeyboardMode}
                footer={bigRoom}
                ownPress={voice.on && !pushToTalk.working}
                onFocusAction={(label, own) => setSeatAction({ label, own })}
            />
            {voiceLine}
            {inviteRow}
            {chatRows}
        </>
    );

    const noteCount = warnings.length + tips.length;
    const chartLocked = joined !== null || (hosted !== null && hosted.state !== "lobby");

    function upIntoChart(evt: { detail?: { button?: number } }) {
        if (evt.detail?.button !== DIR_UP) {
            return false;
        }
        if ((chartLocked && mp.mode !== "stream") || !streamModeNav.current) {
            return false;
        }
        streamModeNav.current.TakeFocus(true);
        playMoveSound();
        return true;
    }

    const notesRow = (
        <PanelSectionRow>
            <FocusableItem
                bottomSeparator="none"
                outerStyle={buttonStyle}
                focusKey="multiplayer:notes"
                focusFallback={[joined ? "multiplayer:leave" : "multiplayer:host", `multiplayer:mode:${mp.mode}`, "multiplayer:back"]}
                onGamepadDirection={upIntoChart}
                onClick={() => showMultiplayerProblem(language, "Before You Play",
                    noteCount > 0 ? [...warnings, ...tips] : t(language, "Nothing to note for this game."))}
            >
                <div style={{ width: "100%", textAlign: "center" }}>
                    {t(language, "Before You Play")}
                    {noteCount > 0 && (
                        <span style={{ position: "absolute", top: "3px", right: "4px", color: warnAmber, fontWeight: 800,
                            fontSize: "0.76em", lineHeight: 1 }}>
                            {noteCount}
                        </span>
                    )}
                </div>
            </FocusableItem>
        </PanelSectionRow>
    );

    const showHardcore = (mp.mode === "link" || !couchGuest) && !runsRmg && mp.mode !== "stream";
    const showShare = mp.mode === "couch" && !joined && (hosted?.emulator ?? local?.emulator) === "retroarch";
    const showWatch = showShare || (mp.mode === "stream" && !joined);
    const showChangeGame = hosted !== null || (joined !== null && mp.mode === "link");
    const showAdapter = Boolean(hosted?.adapterShown);
    const roomKeys = [showCores && mp.mode !== "link" ? "multiplayer:core" : "",
        showRunsWith ? "multiplayer:runswith" : "",
        showHardcore ? "multiplayer:toggle:hardcore" : "", showShare ? "multiplayer:toggle:share" : "",
        showWatch ? "multiplayer:toggle:watch" : "", showAdapter ? "multiplayer:adapter" : "",
        hosted ? "multiplayer:toggle:voice" : "",
        joined ? "multiplayer:leave" : "multiplayer:host", "multiplayer:back"].filter(Boolean);
    const roomHasOptions = showCores || showHardcore || showWatch || hosted !== null;
    const afterSliders = ["multiplayer:roomtab:audio", ...roomKeys];
    const duckShown = gameVolume.output === "speaker" || gameVolume.output === "external";
    const voiceSliders = roomVoice && (
        <>
            {voice.micLevel !== null && (
                <SectionTitle label={t(language, "Global")} />
            )}
            {voice.micLevel !== null && (
                <PanelSectionRow>
                    <FocusTarget focusKey="multiplayer:voice:mic"
                        focusFallback={["multiplayer:voice:output", "multiplayer:voice:game", "multiplayer:voice:volume", ...afterSliders]}
                        style={buttonStyle}>
                        <SliderField
                            label={t(language, "Outgoing Chat Volume")}
                            description={t(language, "Volume for what they hear.")}
                            value={Math.round(voice.micLevel * 100)}
                            min={0}
                            max={100}
                            step={5}
                            showValue
                            valueSuffix="%"
                            layout="below"
                            bottomSeparator="none"
                            onChange={changeMicLevel}
                        />
                    </FocusTarget>
                </PanelSectionRow>
            )}
            <OutputVolumeRow
                language={language}
                heading={voice.micLevel === null}
                style={buttonStyle}
                focusFallback={["multiplayer:voice:mic", "multiplayer:voice:game", "multiplayer:voice:volume", ...afterSliders]}
            />
            <ToggleRow
                bottomSeparator="none"
                controlled
                label={t(language, "Push to Talk")}
                value={pushToTalk.on}
                outerStyle={buttonStyle}
                focusKey="multiplayer:toggle:ptt"
                focusFallback={["multiplayer:voice:output", "multiplayer:voice:mic", "multiplayer:voice:game", ...afterSliders]}
                onChange={changePushToTalk}
                help={t(language, "help_mp_push_to_talk")}
            />
            <ToggleRow
                bottomSeparator="none"
                controlled
                label={t(language, "PTT: Toggleable")}
                value={pushToTalk.toggle}
                disabled={!pushToTalk.on}
                outerStyle={buttonStyle}
                focusKey="multiplayer:toggle:ptttoggle"
                focusFallback={["multiplayer:toggle:ptt", "multiplayer:voice:output", "multiplayer:voice:game", ...afterSliders]}
                onChange={changePttToggle}
                help={t(language, "help_mp_ptt_toggle")}
            />
            <PanelSectionRow>
                <FocusableItem
                    bottomSeparator="none"
                    outerStyle={buttonStyle}
                    focusKey="multiplayer:pttsetup"
                    focusFallback={["multiplayer:toggle:ptttoggle", "multiplayer:toggle:ptt", "multiplayer:voice:output", ...afterSliders]}
                    onClick={page.onSetUpVoiceShortcuts}
                    help={t(language, "help_mp_ptt_setup")}
                >
                    {t(language, "Set Up PTT/Mute")}
                </FocusableItem>
            </PanelSectionRow>
            <PanelSectionRow>
                <FocusTarget focusKey="multiplayer:voice:sensitivity"
                    focusFallback={["multiplayer:pttsetup", "multiplayer:toggle:ptttoggle", "multiplayer:toggle:ptt", ...afterSliders]}
                    style={buttonStyle}>
                    <SliderField
                        label={t(language, "Mic Sensitivity")}
                        description={t(language, pushToTalk.working ? "Not used while Push to Talk is on." : "help_mic_sensitivity")}
                        value={pushToTalk.sensitivity}
                        min={1}
                        max={3}
                        step={1}
                        notchCount={3}
                        notchLabels={[
                            { notchIndex: 0, label: t(language, "Low") },
                            { notchIndex: 1, label: t(language, "Medium") },
                            { notchIndex: 2, label: t(language, "High") }
                        ]}
                        notchTicksVisible
                        layout="below"
                        bottomSeparator="none"
                        disabled={pushToTalk.working}
                        onChange={changeSensitivity}
                    />
                </FocusTarget>
            </PanelSectionRow>
            <SectionTitle label={t(language, "Per-Game")} />
            <PanelSectionRow>
                <FocusTarget focusKey="multiplayer:voice:game"
                    focusFallback={["multiplayer:voice:volume", "multiplayer:voice:output", "multiplayer:voice:mic", ...afterSliders]}
                    style={buttonStyle}>
                    <SliderField
                        label={t(language, "Game Volume")}
                        description={t(language, "Remembered per-game volume levels.")}
                        value={gameVolume.level}
                        min={0}
                        max={100}
                        step={5}
                        showValue
                        valueSuffix="%"
                        layout="below"
                        bottomSeparator="none"
                        onChange={changeGameVolume}
                    />
                </FocusTarget>
            </PanelSectionRow>
            <PanelSectionRow>
                <FocusTarget focusKey="multiplayer:voice:volume" focusFallback={["multiplayer:voice:game", ...afterSliders]}
                    style={buttonStyle}>
                    <SliderField
                        label={t(language, "Incoming Chat Volume")}
                        description={t(language, "Per-game: Volume for what you hear.")}
                        value={voice.volume}
                        min={0}
                        max={100}
                        step={5}
                        showValue
                        valueSuffix="%"
                        layout="below"
                        bottomSeparator="none"
                        onChange={changeIncomingVolume}
                    />
                </FocusTarget>
            </PanelSectionRow>
            {duckShown && (
                <ToggleRow
                    bottomSeparator="none"
                    controlled
                    label={t(language, "Duck Game While Talking")}
                    value={gameVolume.duck}
                    outerStyle={buttonStyle}
                    focusKey="multiplayer:toggle:duck"
                    focusFallback={["multiplayer:voice:volume", "multiplayer:voice:game", ...afterSliders]}
                    onChange={changeDuck}
                    help={t(language, "Lowers your game audio while you speak, so the receiving person does not hear audio through your speakers.")}
                />
            )}
            {duckShown && (
                <PanelSectionRow>
                    <FocusTarget focusKey="multiplayer:voice:duckstrength"
                        focusFallback={["multiplayer:toggle:duck", "multiplayer:voice:volume", ...afterSliders]} style={buttonStyle}>
                        <SliderField
                            label={t(language, "Duck Strength")}
                            description={t(language, "How much quieter the game gets while you talk.")}
                            value={gameVolume.duckStrength}
                            min={1}
                            max={4}
                            step={1}
                            notchCount={4}
                            notchLabels={[
                                { notchIndex: 0, label: t(language, "Low") },
                                { notchIndex: 1, label: t(language, "Mid") },
                                { notchIndex: 2, label: t(language, "High") },
                                { notchIndex: 3, label: t(language, "Max") }
                            ]}
                            notchTicksVisible
                            layout="below"
                            bottomSeparator="none"
                            disabled={!gameVolume.duck}
                            onChange={changeDuckStrength}
                        />
                    </FocusTarget>
                </PanelSectionRow>
            )}
        </>
    );
    const vote = hosted?.vote ?? joined?.status?.vote ?? null;
    const lounge = hosted?.lounge ?? joined?.status?.lounge ?? null;
    function explainTab(tab: MultiplayerRoomTab) {
        const text = tab === "audio"
            ? t(language, "Voice chat is off in this room. The host can turn it on in the Room tab.")
            : t(language, "Stream Options are for Stream Play rooms. This room uses {{mode}}.",
                { mode: t(language, mp.mode === "link" ? "Link Play" : "Couch Play") });
        showMultiplayerProblem(language, tab === "audio" ? "Audio" : "Stream Options", text);
    }
    const roomTabs = inSession && (
        <RoomTabs
            language={language}
            active={roomTab}
            disabled={tabOff}
            dot={{
                vote: Boolean(vote?.open && vote.mine < 0),
                lounge: lounge !== null && (lounge.ttt.players.length > 0 && !lounge.ttt.end
                    || lounge.c4.players.length > 0 && !lounge.c4.end
                    || lounge.rev.players.length > 0 && !lounge.rev.end)
            }}
            onPick={showRoomTab}
            onDisabled={explainTab}
            focusFallback={roomKeys}
        />
    );
    const voteBody = inSession && (
        <GameVoteTab
            language={language}
            showIcons={state.showIcons}
            host={hosted !== null}
            inLobby={inLobby}
            vote={vote}
            buttonStyle={buttonStyle}
            exitKey={exitKey}
            onPickGames={openVotePicker}
        />
    );
    const loungeBody = inSession && lounge !== null && (
        <>
            <PanelSectionRow>
                <RoomChatBox language={language} chat={chat} />
            </PanelSectionRow>
            <PanelSectionRow>
                <FocusableItem
                    bottomSeparator="none"
                    outerStyle={buttonStyle}
                    focusKey="multiplayer:lounge:say"
                    focusFallback={["multiplayer:roomtab:lounge", exitKey, "multiplayer:back"]}
                    onClick={() => openChatSay(language)}
                >
                    {t(language, "Say Something")}
                </FocusableItem>
            </PanelSectionRow>
            <LoungeTab
                language={language}
                lounge={lounge}
                ownSeat={hosted ? 0 : joined?.seat ?? -1}
                game={loungeGame}
                avatars={friends.state.avatars}
                self={hosted
                    ? { name: hosted.seats[0]?.name ?? "", pic: hosted.seats[0]?.pic ?? "" }
                    : { name: joined?.status?.members[joined.seat] ?? "", pic: joined?.status?.ids[joined.seat]?.pic ?? "" }}
                buttonStyle={buttonStyle}
                exitKey={exitKey}
                onGame={showLoungeGame}
            />
        </>
    );
    const miscRows = streamRoom && (
        <>
            <ToggleRow
                bottomSeparator="none"
                controlled
                label={t(language, "Slow Connection")}
                value={slowConnection}
                outerStyle={buttonStyle}
                focusKey="multiplayer:toggle:slowconnection"
                focusFallback={["multiplayer:roomtab:stream", ...roomKeys]}
                onChange={(next) => void changeSlowConnection(next)}
                help={t(language, "Halves the stream's quality so it fits a slow internet connection. Affects rooms you host and rooms you join.")}
            />
            <PanelSectionRow>
                <FocusableItem
                    bottomSeparator="none"
                    outerStyle={buttonStyle}
                    focusKey="multiplayer:updatestreaming"
                    focusFallback={["multiplayer:toggle:slowconnection", "multiplayer:roomtab:stream", ...roomKeys]}
                    onClick={pressUpdateStreaming}
                    help={t(language, "Updates Sunshine and Moonlight to their latest versions.")}
                >
                    <div style={{ opacity: updating ? 0.45 : 1 }}>{t(language, "Update Streaming Tools")}</div>
                </FocusableItem>
            </PanelSectionRow>
            <PanelSectionRow>
                <div style={{ width: "100%" }}>
                    {updating && <ProgressBar fraction={stream.progress >= 0 ? stream.progress / 100 : null} />}
                    <div style={{ ...bodyTextStyle(), minHeight: "1.4em", opacity: 1, color: updateLine?.color,
                        marginTop: updating ? "6px" : 0 }}>
                        {updateLine ? t(language, updateLine.key) : ""}
                        {updating && updateLine && stream.progress >= 0 ? ` ${stream.progress}%` : ""}
                    </div>
                </div>
            </PanelSectionRow>
            <PanelSectionRow>
                <ConfirmRow
                    buttonSpacing={state.buttonSpacing}
                    bottomSeparator="none"
                    focusKey="multiplayer:removestreaming"
                    focusFallback={["multiplayer:updatestreaming", "multiplayer:roomtab:stream", ...roomKeys]}
                    idleLabel={t(language, "Remove Stream Tools")}
                    armedLabel={t(language, "Press again to confirm")}
                    disabled={false}
                    labelStyle={{ fontWeight: "inherit" }}
                    onConfirm={() => pressRemoveStreaming(language)}
                    help={t(language, "Removes the streaming tools needed for Stream Play. If you host or join a Stream Play room again, CheevoDeck will offer to download them again.")}
                />
            </PanelSectionRow>
        </>
    );
    const changeGameRow = showChangeGame && (
        <PanelSectionRow>
            <FocusableItem
                bottomSeparator="none"
                outerStyle={buttonStyle}
                focusKey="multiplayer:changegame"
                focusFallback={["multiplayer:notes", "multiplayer:leave", "multiplayer:back"]}
                disabled={!inLobby || Boolean(joined?.ready)}
                onClick={() => {
                    if (!mp.busy) {
                        void (hosted ? openGamePicker(actions.changeGame) : openGuestGames());
                    }
                }}
            >
                {t(language, "Change Game")}
            </FocusableItem>
        </PanelSectionRow>
    );
    const chatToastRow = inSession && (
        <ToggleRow
            bottomSeparator="none"
            controlled
            label={t(language, "In-Game Chat Toasts")}
            value={chatToastsInGame}
            outerStyle={buttonStyle}
            focusKey="multiplayer:toggle:chattoasts"
            focusFallback={["multiplayer:toggle:voice", "multiplayer:adapter", "multiplayer:toggle:watch", "multiplayer:toggle:share", "multiplayer:toggle:hardcore", exitKey]}
            onChange={(next) => void changeChatToastsInGame(next)}
            help={t(language, "If enabled, whenever someone sends a chat message in the room, it will be pushed as a toast while you are playing your game.")}
        />
    );
    const optionRows = (roomHasOptions || inSession) && (
        <>
            <SectionTitle label={t(language, "Options")} />
            {inSession && !roomHasOptions && (
                <PanelSectionRow>
                    <div style={bodyTextStyle()}>{t(language, "The host sets this room's options.")}</div>
                </PanelSectionRow>
            )}
            {coreRows}
            {runsWithRow}
            {showHardcore && hardcoreRow}
            {showShare && shareRow}
            {showWatch && watchRow}
            {showAdapter && adapterRow}
            {voiceRow}
            {chatToastRow}
        </>
    );

    return (
        <Focusable
            key="multiplayer:view"
            flow-children="column"
            onGamepadFocus={(evt) => {
                const target = evt.target as Element;
                const key = target.closest?.("[data-focus-key]")?.getAttribute("data-focus-key") ?? "";
                cursorTab.current = tabBodyRef.current?.contains(target) || key === "multiplayer:bottom:anchor" ? roomTab : null;
                cursorOnChart.current = key.startsWith("multiplayer:mode:");
            }}
            onCancelButton={pressBack}
            onOptionsButton={onPlay && yStarts ? pressPlay : onPlay && yFixes ? openOwnFix : onPlay && yExplains ? explainStart : undefined}
            onOptionsActionDescription={onPlay && (yStarts || yFixes || yExplains) ? t(language, "mp_footer_start") : undefined}
            onSecondaryButton={onPlay && xReadies ? pressPlay : onPlay && xFixes ? openOwnFix : onPlay && xExplains ? explainStart : undefined}
            onSecondaryActionDescription={onPlay && (xReadies || xFixes || xExplains)
                ? t(language, joined?.ready ? "mp_footer_unready" : "mp_footer_ready") : undefined}
        >
            <PanelSection>
                <PageNavStrip
                    title={t(language, "Play Together")}
                    buttonSpacing={state.buttonSpacing}
                    onHome={page.onHome}
                    help={<PageHelpButton focusKey="multiplayer:help" guide="play-together" />}
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
                                <ModeChart
                                    language={language}
                                    mode={mp.mode}
                                    locked={chartLocked}
                                    states={mp.modes?.modes ?? {}}
                                    onChoose={actions.setTab}
                                    onStatus={openModeReason}
                                    streamNav={streamModeNav}
                                />
                                <PanelSectionRow>
                                    <div style={bodyTextStyle()}>
                                        {t(language, mp.mode === "link"
                                            ? "Each device runs its own copy of the game."
                                            : mp.mode === "stream"
                                                ? "Play your game with anyone even if they don't have it. Only you earn achievements. Requires fast internet to host."
                                                : "Everyone plays one shared game.")}
                                    </div>
                                </PanelSectionRow>
                                {problemLines.map((line) => (
                                    <PanelSectionRow key={line.text}>
                                        <div style={{ ...bodyTextStyle(), color: line.color, opacity: 1, display: "flex", gap: "6px" }}>
                                            {problemLines.length > 1 && <span>•</span>}
                                            <span style={{ flex: 1 }}>{line.text}</span>
                                        </div>
                                    </PanelSectionRow>
                                ))}
                                {needsSetup && (
                                    <PanelSectionRow>
                                        <FocusableItem
                                            bottomSeparator="none"
                                            outerStyle={buttonStyle}
                                            focusKey="multiplayer:stream:setup"
                                            focusFallback={["multiplayer:mode:stream", "multiplayer:notes", "multiplayer:back"]}
                                            onClick={() => {
                                                if (!installing) {
                                                    openStreamSetup(language, stream.size || "?");
                                                }
                                            }}
                                        >
                                            <div style={{ width: "100%", textAlign: "center", opacity: installing ? 0.45 : 1 }}>
                                                {t(language, "Set Up Streaming")}
                                            </div>
                                        </FocusableItem>
                                    </PanelSectionRow>
                                )}
                                {fixHere !== null && (fixHere.running || fixHere.failed) && (
                                    <PanelSectionRow>
                                        <FixRunLine language={language} run={fixHere} streamProgress={stream.progress} />
                                    </PanelSectionRow>
                                )}
                                {gameFilePick !== null && gameFilePick.gameId === mp.gameId && gameFilePick.state !== "done" && (
                                    <PanelSectionRow>
                                        <div style={{ width: "100%", paddingTop: "4px" }}>
                                            {gameFilePick.state === "running" ? (
                                                <>
                                                    <div style={bodyTextStyle()}>
                                                        {t(language, "Checking {{file}} with RetroAchievements...", { file: gameFilePick.fileName })}
                                                    </div>
                                                    <div style={{ marginTop: "6px" }}>
                                                        <ProgressBar fraction={null} />
                                                    </div>
                                                </>
                                            ) : (
                                                <div style={{ ...bodyTextStyle(), color: errorRed, opacity: 1 }}>
                                                    {gameFilePickFailure(language, gameFilePick)}
                                                </div>
                                            )}
                                        </div>
                                    </PanelSectionRow>
                                )}
                                {fixDoneShown && fixHere?.done && !fixHere.running && fixHere.next?.state === "ready" && (
                                    <PanelSectionRow>
                                        <div style={{ ...bodyTextStyle(), color: achievementGreen, opacity: 1 }}>{t(language, "Done")}</div>
                                    </PanelSectionRow>
                                )}
                                {needsSetup && installing && !fixRun?.running && (
                                    <PanelSectionRow>
                                        <div style={{ width: "100%", paddingTop: "4px" }}>
                                            <ProgressBar fraction={stream.progress >= 0 ? stream.progress / 100 : null} />
                                            <div style={{ ...bodyTextStyle(), marginTop: "6px" }}>
                                                {setupLine ? t(language, setupLine.key) : ""}
                                                {setupLine && stream.progress >= 0 ? ` ${stream.progress}%` : ""}
                                            </div>
                                        </div>
                                    </PanelSectionRow>
                                )}

                                <Focusable key={scopeKey} flow-children="column" resetNavOnEntry>
                                    {notesRow}
                                    {changeGameRow}
                                    {roomButton}
                                    {roomTabs}
                                    <Focusable key={`multiplayer:roomtab:${inSession ? roomTab : "room"}`} ref={tabBodyRef} flow-children="column"
                                        resetNavOnEntry navEntryPreferPosition={NAV_ENTER_MAINTAIN_Y}>
                                        {!inSession ? optionRows
                                            : roomTab === "audio" ? voiceSliders
                                                : roomTab === "stream" ? miscRows
                                                    : roomTab === "vote" ? voteBody
                                                        : roomTab === "lounge" ? loungeBody
                                                            : <>{hintsRow}{roomRows}{optionRows}</>}
                                    </Focusable>
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
