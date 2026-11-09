import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
    getGamePayload,
    multiplayerAcceptInvite,
    multiplayerChangeGame,
    multiplayerCheck,
    multiplayerModes,
    multiplayerSavePlayPick,
    multiplayerCloseRoom,
    multiplayerGames,
    multiplayerGuestGame,
    multiplayerLeave,
    multiplayerRoomOptions,
    multiplayerRoomStatus,
    multiplayerSetVisible
} from "../api";
import type {
    MultiplayerCheck,
    MultiplayerModes,
    PlayPick,
    MultiplayerGame,
    MultiplayerAdapter,
    MultiplayerMode,
    MultiplayerRoomStatus,
    Payload
} from "../types";
import { logError } from "../utils/errors";
import { getCurrentLanguage } from "../locales";
import { showMultiplayerProblem } from "../components/multiplayer/ProblemModal";
import { ROOM_ENDED, problemText } from "../utils/multiplayerProblems";
import {
    forgetMultiplayerRoomChoices,
    multiplayerChoices,
    rememberMultiplayerGame,
    rememberMultiplayerHardcore,
    rememberMultiplayerShare,
    rememberMultiplayerVoice,
    rememberMultiplayerWatch,
    rememberMultiplayerTab,
    takeMultiplayerInvite
} from "../utils/multiplayerChoices";
import { landOnTop } from "../focusRecords";
import {
    launchMultiplayer,
    multiplayerSessionSnapshot,
    startMultiplayerRound,
    subscribeMultiplayerSession
} from "../utils/multiplayerSession";
import { pressMultiplayerReady, subscribeMultiplayerRoom } from "../utils/multiplayerRoomState";
import { useStreamSetup } from "../utils/streamPlay";
import { useFixPlan, type FixAnswer } from "../utils/fixPlan";
import { useGameFilePick } from "../utils/gameFilePick";

const TICK_MS = 2000;
const RENEW_EVERY = 5;
const SAME_DIALOG_MS = 8000;
const JOIN_WAIT_MS = 8000;

type MultiplayerProblem = { code: string; detail?: Record<string, string> };
type ActionResult = { ok: boolean; error?: string; gate?: string; detail?: Record<string, string> };

const headerPayloads = new Map<number, Payload>();
const checkCache = new Map<string, MultiplayerCheck>();
const CHECK_CACHE_MAX = 30;
const ALL_MODES: MultiplayerMode[] = ["link", "couch", "stream"];
const NO_MODES: MultiplayerModes = { ok: false, modes: {}, shortcutFallback: true, tools: {} };

function rememberCheck(key: string, result: MultiplayerCheck) {
    if (checkCache.size >= CHECK_CACHE_MAX && !checkCache.has(key)) {
        checkCache.clear();
    }
    checkCache.set(key, result);
}

const modesCache = new Map<string, MultiplayerModes>();

function rememberModes(key: string, answer: MultiplayerModes) {
    if (modesCache.size >= CHECK_CACHE_MAX && !modesCache.has(key)) {
        modesCache.clear();
    }
    modesCache.set(key, answer);
}

const reported = new Set<string>();
let lastDialog = { titleKey: "", at: 0 };
let missedProblem: MultiplayerProblem | null = null;
let endedLineCleared = false;

function showProblem(titleKey: string, problem: MultiplayerProblem) {
    lastDialog = { titleKey, at: Date.now() };
    const language = getCurrentLanguage();
    showMultiplayerProblem(language, titleKey, problemText(language, problem.code, problem.detail));
}

function failureOf(result: ActionResult): MultiplayerProblem {
    return result.gate ? { code: result.gate, detail: result.detail } : { code: result.error ?? "unavailable" };
}

export function useMultiplayerController({ isActive }: { isActive: boolean }) {
    const [tab, setTabState] = useState<MultiplayerMode>(() => multiplayerChoices().tab);
    const [currentGameId, setCurrentGameId] = useState<number | null>(null);
    const [pickedGameId, setPickedGameId] = useState<number | null>(() => multiplayerChoices().gameId);
    const [hardcore, setHardcoreState] = useState(() => multiplayerChoices().hardcore);
    const [shareControls, setShareState] = useState(() => multiplayerChoices().share);
    const [watchOnly, setWatchState] = useState(() => multiplayerChoices().watch);
    const [visibleError, setVisibleError] = useState("");
    const [status, setStatus] = useState<MultiplayerRoomStatus | null>(null);
    const [check, setCheck] = useState<MultiplayerCheck | null>(null);
    const [checkedFor, setCheckedFor] = useState("");
    const [games, setGames] = useState<MultiplayerGame[] | null>(null);
    const [scanned, setScanned] = useState(true);
    const [installedCores, setInstalledCores] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [missed, setMissedState] = useState<MultiplayerProblem | null>(() => missedProblem);
    const [headerPayload, setHeaderPayload] = useState<Payload | null>(null);
    const [activeSeen, setActiveSeen] = useState(isActive);
    if (activeSeen !== isActive) {
        setActiveSeen(isActive);
        if (isActive) {
            setPickedGameId(multiplayerChoices().gameId);
            setTabState(multiplayerChoices().tab);
        }
    }
    const session = useSyncExternalStore(subscribeMultiplayerSession, multiplayerSessionSnapshot);
    const checkTokenRef = useRef(0);
    const changingModeRef = useRef(false);
    const modesTokenRef = useRef(0);
    const [modes, setModes] = useState<{ key: string; answer: MultiplayerModes } | null>(null);
    const statusTokenRef = useRef(0);
    const previousStatusRef = useRef<MultiplayerRoomStatus | null>(null);
    const failureSeqRef = useRef<number | null>(null);

    function setMissed(next: MultiplayerProblem | null) {
        missedProblem = next;
        setMissedState(next);
    }

    function report(key: string, titleKey: string, problem: MultiplayerProblem, witnessed: boolean) {
        if (reported.has(key)) {
            return;
        }
        reported.add(key);
        if (!witnessed) {
            setMissed(problem);
            return;
        }
        if (lastDialog.titleKey === titleKey && Date.now() - lastDialog.at < SAME_DIALOG_MS) {
            return;
        }
        showProblem(titleKey, problem);
    }

    const hosted = status?.role === "host" ? status.room : null;
    const joined = status?.role === "guest" ? status : null;
    const mode: MultiplayerMode = hosted?.mode ?? joined?.room.mode ?? tab;
    const ownGameId = pickedGameId ?? currentGameId;
    const gameId = hosted
        ? hosted.gameId
        : joined
            ? joined.local?.gameId ?? joined.room.gameId
            : ownGameId;
    const roomGameId = hosted || joined ? gameId : null;
    const lastRoomGameRef = useRef<number | null>(null);
    useEffect(() => {
        if (roomGameId !== null) {
            lastRoomGameRef.current = roomGameId;
            return;
        }
        const last = lastRoomGameRef.current;
        lastRoomGameRef.current = null;
        if (last !== null) {
            rememberMultiplayerGame(last);
            setPickedGameId(last);
        }
    }, [roomGameId]);
    const checkRoom = joined ? joined.room.room : "";
    const checkCore = hosted ? hosted.core : "";
    const checkKey = [mode, gameId ?? 0, checkCore, checkRoom].join("|");

    const reloadStatus = useCallback(async () => {
        const token = statusTokenRef.current + 1;
        statusTokenRef.current = token;
        try {
            const next = await multiplayerRoomStatus();
            if (statusTokenRef.current === token) {
                setStatus(next);
            }
        }
        catch (e) {
            logError("multiplayerRoomStatus", e);
        }
    }, []);

    useEffect(() => {
        if (!isActive) {
            return;
        }
        void reloadStatus();
        void (async () => {
            try {
                const listed = await multiplayerGames();
                setGames(listed.games ?? []);
                setScanned(listed.scanned !== false);
                setInstalledCores(listed.installedCores ?? []);
            }
            catch (e) {
                logError("multiplayerGames", e);
                setGames([]);
            }
        })();
    }, [isActive, reloadStatus]);

    const wasActiveRef = useRef(isActive);
    useEffect(function endTheVisitOnTheWayOut() {
        const wasActive = wasActiveRef.current;
        wasActiveRef.current = isActive;
        if (isActive || !wasActive) {
            return;
        }
        multiplayerSetVisible(false, false).catch((e) => logError("multiplayerSetVisible", e));
        statusTokenRef.current += 1;
        previousStatusRef.current = null;
        failureSeqRef.current = null;
        setStatus(null);
        setCheck(null);
        setModes(null);
        setVisibleError("");
    }, [isActive]);

    useEffect(() => {
        if (!isActive) {
            return;
        }
        let alive = true;
        let tick = 0;
        void (async () => {
            try {
                const opened = await multiplayerSetVisible(true, true);
                if (!alive) {
                    return;
                }
                setVisibleError(opened.ok ? "" : opened.error ?? "unavailable");
                const invite = opened.ok ? takeMultiplayerInvite() : null;
                if (invite && await run("Couldn't Join the Room", () => multiplayerAcceptInvite(invite, hardcore))) {
                    landOnTop("multiplayer", "multiplayer:leave");
                }
            }
            catch (e) {
                logError("multiplayerSetVisible", e);
            }
        })();
        const timer = window.setInterval(() => {
            tick += 1;
            if (tick % RENEW_EVERY === 0) {
                multiplayerSetVisible(true, false)
                    .then((renewed) => {
                        if (alive) {
                            setVisibleError(renewed.ok || renewed.error === "cap_reached" ? "" : renewed.error ?? "unavailable");
                        }
                    })
                    .catch((e) => logError("multiplayerSetVisible", e));
            }
            void reloadStatus();
        }, TICK_MS);
        return () => {
            alive = false;
            window.clearInterval(timer);
        };
    }, [isActive, reloadStatus]);

    useEffect(() => {
        if (!isActive) {
            return;
        }
        return subscribeMultiplayerRoom(() => void reloadStatus());
    }, [isActive, reloadStatus]);

    useEffect(function reportWhatTheRoomDid() {
        if (!isActive || status === null) {
            return;
        }
        const previous = previousStatusRef.current;
        previousStatusRef.current = status;
        const witnessed = previous !== null;
        if (status.role === "host") {
            endedLineCleared = false;
            const last = status.room.lastStart;
            if (last && !last.ok) {
                report(`start:${status.room.id}:${last.round}`, "Couldn't Start", { code: last.error }, witnessed);
            }
            return;
        }
        if (status.role === "guest") {
            if (ROOM_ENDED.includes(status.error)) {
                if (witnessed && (previous.role !== "guest" || previous.error !== status.error)) {
                    report(`ended:${status.room.room}`, "The Room Closed", { code: status.error }, true);
                    endedLineCleared = true;
                }
                return;
            }
            endedLineCleared = false;
            const last = status.status?.lastStart;
            if (last && !last.ok) {
                report(`start:${status.room.room}:${last.round}`, "Couldn't Start", { code: "host_start_failed" }, witnessed);
            }
            return;
        }
        if (status.closedReason && previous && previous.role !== null) {
            const room = previous.role === "host" ? previous.room.id : previous.room.room;
            report(`ended:${room}`, "The Room Closed", { code: status.closedReason }, true);
            endedLineCleared = true;
        }
    }, [isActive, status]);

    const joining = Boolean(joined?.ready && joined.status && joined.status.state !== "lobby" && !joined.status.start);
    useEffect(() => {
        if (!isActive || !joining) {
            return;
        }
        const timer = window.setTimeout(() => {
            void pressMultiplayerReady(false, "", false);
            showProblem("Couldn't Start", { code: "seat_not_taken" });
        }, JOIN_WAIT_MS);
        return () => window.clearTimeout(timer);
    }, [isActive, joining]);

    useEffect(function reportFailedLaunches() {
        if (!isActive) {
            return;
        }
        const seen = failureSeqRef.current;
        failureSeqRef.current = session.failureSeq;
        if (session.failureSeq === 0 || session.failureSeq === seen) {
            return;
        }
        report(`failure:${session.failureSeq}`, "Couldn't Start", { code: session.failure }, seen !== null);
    }, [isActive, session.failureSeq]);

    const joinedState = joined?.status?.state ?? "";
    const streamReady = useStreamSetup(isActive).status?.ready ?? false;
    const fixesFinished = useFixPlan().finished;
    const gameFilesChanged = useGameFilePick().changed;
    const hostedSeats = hosted?.seats.filter(Boolean).length ?? 0;
    useEffect(() => {
        if (!isActive || gameId === null) {
            setCheck(null);
            return;
        }
        const token = checkTokenRef.current + 1;
        checkTokenRef.current = token;
        void (async () => {
            try {
                const result = await multiplayerCheck(mode, gameId, checkCore, checkRoom);
                rememberCheck(checkKey, result);
                if (checkTokenRef.current === token) {
                    setCheck(result);
                    setCheckedFor(checkKey);
                }
                if (!hosted && !joined) {
                    for (const other of ALL_MODES.filter((each) => each !== mode)) {
                        const otherKey = [other, gameId, checkCore, ""].join("|");
                        multiplayerCheck(other, gameId, checkCore, "")
                            .then((answer) => rememberCheck(otherKey, answer))
                            .catch((e) => logError("multiplayerCheck: the other modes", e));
                    }
                }
            }
            catch (e) {
                logError("multiplayerCheck", e);
                if (checkTokenRef.current === token) {
                    setCheck(null);
                    setCheckedFor(checkKey);
                }
            }
        })();
    }, [isActive, mode, gameId, checkCore, checkRoom, hosted?.core, hosted?.rev, hostedSeats, joinedState, joined?.status?.rev,
        joined?.reason, streamReady, fixesFinished, gameFilesChanged]);

    const modesKey = [gameId ?? 0, checkRoom].join("|");
    useEffect(() => {
        if (!isActive || gameId === null) {
            return;
        }
        const token = modesTokenRef.current + 1;
        modesTokenRef.current = token;
        const key = [gameId, checkRoom].join("|");
        multiplayerModes(gameId, checkRoom)
            .then((answer) => {
                if (modesTokenRef.current === token) {
                    setModes({ key, answer });
                }
                if (answer.ok) {
                    rememberModes(key, answer);
                }
            })
            .catch((e) => {
                logError("multiplayerModes", e);
                if (modesTokenRef.current === token) {
                    setModes({ key, answer: NO_MODES });
                }
            });
    }, [isActive, gameId, checkRoom, games, hosted?.mode, hosted?.core, hosted?.rev, hostedSeats, joinedState,
        joined?.status?.rev, joined?.reason, streamReady, fixesFinished, gameFilesChanged]);

    useEffect(() => {
        if (!isActive || gameId === null || gameId === currentGameId) {
            setHeaderPayload(null);
            return;
        }
        const cached = headerPayloads.get(gameId);
        setHeaderPayload(cached ?? null);
        if (cached) {
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const response = await getGamePayload(gameId);
                if (response.payload) {
                    headerPayloads.set(gameId, response.payload);
                    if (!cancelled) {
                        setHeaderPayload(response.payload);
                    }
                }
            }
            catch (e) {
                logError("multiplayer header getGamePayload", e);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isActive, gameId, currentGameId]);

    function pressed() {
        setMissed(null);
        endedLineCleared = true;
    }

    async function run(titleKey: string, task: () => Promise<ActionResult>) {
        setBusy(true);
        pressed();
        try {
            const result = await task();
            if (!result.ok) {
                showProblem(titleKey, failureOf(result));
            }
            return result.ok;
        }
        catch (e) {
            logError("multiplayer action", e);
            showProblem(titleKey, { code: "unavailable" });
            return false;
        }
        finally {
            setBusy(false);
            await reloadStatus();
        }
    }

    function setTab(next: MultiplayerMode) {
        if (joined || (hosted && hosted.state !== "lobby")) {
            return;
        }
        if (hosted) {
            if (next === hosted.mode || changingModeRef.current) {
                return;
            }
            changingModeRef.current = true;
            void run("Couldn't Change the Game", async () => {
                const changed = await multiplayerChangeGame(next, hosted.gameId, "");
                if (changed.ok) {
                    rememberMultiplayerTab(next);
                    setTabState(next);
                }
                return changed;
            }).finally(() => {
                changingModeRef.current = false;
            });
            return;
        }
        rememberMultiplayerTab(next);
        setTabState(next);
        pressed();
    }

    function changeGame(next: number, nextMode?: MultiplayerMode) {
        rememberMultiplayerGame(next);
        pressed();
        if (hosted) {
            const toMode = nextMode ?? hosted.mode;
            multiplayerChangeGame(toMode, next, "")
                .then((changed) => {
                    if (changed.ok) {
                        rememberMultiplayerTab(toMode);
                        setTabState(toMode);
                    }
                    else {
                        showProblem("Couldn't Change the Game", failureOf(changed));
                    }
                })
                .catch((e) => logError("multiplayerChangeGame", e));
        }
        else if (joined) {
            void multiplayerGuestGame(next).catch((e) => logError("multiplayerGuestGame", e));
        }
    }

    function pickGame(next: number | null) {
        rememberMultiplayerGame(next);
        setPickedGameId(next);
        pressed();
    }

    async function chooseCouchPick(pick: PlayPick | null) {
        if (gameId === null) {
            return;
        }
        try {
            await multiplayerSavePlayPick(gameId, "couch", pick);
        }
        catch (e) {
            logError("multiplayer: saving the Couch pick", e);
        }
    }

    function setHardcore(next: boolean) {
        rememberMultiplayerHardcore(next);
        setHardcoreState(next);
        if ((hosted && (mode === "couch" || mode === "stream")) || (joined && mode === "link")) {
            void run("Couldn't Change That", () => multiplayerRoomOptions(next, null, null, null, null));
        }
    }

    function setShare(next: boolean) {
        rememberMultiplayerShare(next);
        setShareState(next);
        if (hosted) {
            void run("Couldn't Change That", () => multiplayerRoomOptions(null, null, next, null, null));
        }
    }

    function setWatch(next: boolean) {
        rememberMultiplayerWatch(next);
        setWatchState(next);
        if (hosted) {
            void run("Couldn't Change That", () => multiplayerRoomOptions(null, null, null, next, null));
        }
    }

    function setAdapter(next: MultiplayerAdapter) {
        if (hosted) {
            void run("Couldn't Change That", () => multiplayerRoomOptions(null, null, null, null, null, next));
        }
    }

    function setVoice(next: boolean) {
        rememberMultiplayerVoice(next);
        if (hosted) {
            void run("Couldn't Change That", () => multiplayerRoomOptions(null, null, null, null, next));
        }
    }

    async function closeRoom() {
        await run("Couldn't Leave the Room", () => multiplayerCloseRoom());
        forgetMultiplayerRoomChoices();
        setHardcoreState(false);
    }

    async function leave() {
        if (joined) {
            await run("Couldn't Leave the Room", () => multiplayerLeave());
        }
    }

    async function fixFor(forMode: MultiplayerMode, forGame: number): Promise<FixAnswer | null> {
        const entry = (await multiplayerModes(forGame, checkRoom)).modes[forMode];
        return entry?.plan ? { state: entry.state, gate: entry.gate, detail: entry.detail, plan: entry.plan } : null;
    }

    function play() {
        const appid = check?.local?.appid ?? 0;
        if (!appid) {
            return Promise.resolve(false);
        }
        return run("Couldn't Start", () => launchMultiplayer(appid, hardcore));
    }

    function start() {
        const roomId = hosted?.id ?? "";
        return run("Couldn't Start", async () => {
            const steps = hosted?.mode === "couch" && (hosted.emulator === "dolphin" || hosted.emulator === "rmg") ? hosted.emulator : "";
            const result = await startMultiplayerRound(steps, hosted?.title ?? "");
            if (!result.ok && result.round) {
                reported.add(`start:${roomId}:${result.round}`);
            }
            return result;
        });
    }

    function joinLate() {
        return run("Couldn't Start", () => pressMultiplayerReady(true, "", false));
    }

    function toggleReady() {
        if (!joined) {
            return Promise.resolve(false);
        }
        const next = !joined.ready;
        return run("Couldn't Start", () => pressMultiplayerReady(next));
    }

    return {
        state: {
            tab,
            mode,
            gameId,
            currentGameId,
            pickedGameId,
            hardcore: mode === "couch" && joined?.status
                ? joined.status.hardcore
                : hosted && (mode === "couch" || mode === "stream") ? hosted.hardcore : joined ? joined.hardcore : hardcore,
            shareControls: hosted ? hosted.share : shareControls,
            watchOnly: hosted ? hosted.watch : watchOnly,
            visibleError,
            hosted,
            joined,
            closedReason: status?.role === null ? status.closedReason : "",
            lobby: status?.role === null ? Boolean(status.lobby) : false,
            check: checkedFor === checkKey ? check : checkCache.get(checkKey) ?? check,
            checkCurrent: checkedFor === checkKey,
            modes: modes?.key === modesKey ? modes.answer : modesCache.get(modesKey) ?? null,
            games,
            scanned,
            installedCores,
            busy,
            missed,
            endedLineCleared,
            headerPayload,
            session,
            loaded: games !== null && status !== null
        },
        actions: {
            fixFor,
            setCurrentGameId,
            setTab,
            pickGame,
            changeGame,
            chooseCouchPick,
            setHardcore,
            setShare,
            setWatch,
            setAdapter,
            setVoice,
            closeRoom,
            leave,
            play,
            start,
            joinLate,
            toggleReady
        }
    };
}
