import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
    getGamePayload,
    multiplayerChangeGame,
    multiplayerCheck,
    multiplayerCloseRoom,
    multiplayerDropSeat,
    multiplayerGames,
    multiplayerGuestGame,
    multiplayerLeave,
    multiplayerRoomOptions,
    multiplayerRoomStatus,
    multiplayerSetVisible
} from "../api";
import type {
    MultiplayerCheck,
    MultiplayerGame,
    MultiplayerMode,
    MultiplayerRoomStatus,
    Payload
} from "../types";
import { logError } from "../utils/errors";
import {
    forgetMultiplayerRoomChoices,
    multiplayerChoices,
    multiplayerCoreFor,
    rememberMultiplayerCore,
    rememberMultiplayerGame,
    rememberMultiplayerHardcore,
    rememberMultiplayerShare,
    rememberMultiplayerTab
} from "../utils/multiplayerChoices";
import {
    forgetMultiplayerFailure,
    launchMultiplayer,
    multiplayerSessionSnapshot,
    startMultiplayerRound,
    subscribeMultiplayerSession
} from "../utils/multiplayerSession";
import { pressMultiplayerReady } from "../utils/multiplayerRoomState";

const TICK_MS = 2000;
const RENEW_EVERY = 5;

export type MultiplayerProblem = { code: string; detail?: Record<string, string> };

const headerPayloads = new Map<number, Payload>();

export function useMultiplayerController({ isActive }: { isActive: boolean }) {
    const [tab, setTabState] = useState<MultiplayerMode>(() => multiplayerChoices().tab);
    const [currentGameId, setCurrentGameId] = useState<number | null>(null);
    const [pickedGameId, setPickedGameId] = useState<number | null>(() => multiplayerChoices().gameId);
    const [hardcore, setHardcoreState] = useState(() => multiplayerChoices().hardcore);
    const [shareControls, setShareState] = useState(() => multiplayerChoices().share);
    const [visibleError, setVisibleError] = useState("");
    const [status, setStatus] = useState<MultiplayerRoomStatus | null>(null);
    const [check, setCheck] = useState<MultiplayerCheck | null>(null);
    const [checkedFor, setCheckedFor] = useState("");
    const [games, setGames] = useState<MultiplayerGame[] | null>(null);
    const [scanned, setScanned] = useState(true);
    const [installedCores, setInstalledCores] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<MultiplayerProblem | null>(null);
    const [headerPayload, setHeaderPayload] = useState<Payload | null>(null);
    const session = useSyncExternalStore(subscribeMultiplayerSession, multiplayerSessionSnapshot);
    const checkTokenRef = useRef(0);

    const hosted = status?.role === "host" ? status.room : null;
    const joined = status?.role === "guest" ? status : null;
    const mode: MultiplayerMode = hosted?.mode ?? joined?.room.mode ?? tab;
    const ownGameId = pickedGameId ?? currentGameId;
    const gameId = hosted
        ? hosted.gameId
        : joined
            ? joined.local?.gameId ?? joined.room.gameId
            : ownGameId;
    const [core, setCoreState] = useState(() => multiplayerCoreFor(gameId));
    const checkRoom = joined ? joined.room.room : "";
    const checkCore = hosted ? hosted.core : core;
    const checkKey = [mode, gameId ?? 0, checkCore, checkRoom].join("|");

    const reloadStatus = useCallback(async () => {
        try {
            setStatus(await multiplayerRoomStatus());
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
        setStatus(null);
        setCheck(null);
        setProblem(null);
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
                            setVisibleError(renewed.ok ? "" : renewed.error ?? "unavailable");
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
        setCoreState(multiplayerCoreFor(gameId));
    }, [gameId]);

    const joinedState = joined?.status?.state ?? "";
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
                if (checkTokenRef.current === token) {
                    setCheck(result);
                    setCheckedFor(checkKey);
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
        joined?.reason]);

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

    async function run(task: () => Promise<{ ok: boolean; error?: string; gate?: string; detail?: Record<string, string> }>) {
        setBusy(true);
        setProblem(null);
        forgetMultiplayerFailure();
        try {
            const result = await task();
            if (!result.ok) {
                setProblem(result.gate
                    ? { code: result.gate, detail: result.detail }
                    : { code: result.error ?? "unavailable" });
            }
            return result.ok;
        }
        catch (e) {
            logError("multiplayer action", e);
            setProblem({ code: "unavailable" });
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
            if (next === hosted.mode) {
                if (hosted.notice) {
                    void run(() => multiplayerChangeGame(next, hosted.gameId, ""));
                }
                return;
            }
            void run(async () => {
                const changed = await multiplayerChangeGame(next, hosted.gameId, "");
                if (changed.ok) {
                    rememberMultiplayerTab(next);
                    setTabState(next);
                }
                return changed;
            });
            return;
        }
        rememberMultiplayerTab(next);
        setTabState(next);
        setProblem(null);
    }

    function changeGame(next: number) {
        rememberMultiplayerGame(next);
        if (hosted) {
            void multiplayerChangeGame(hosted.mode, next, multiplayerCoreFor(next))
                .catch((e) => logError("multiplayerChangeGame", e));
        }
        else if (joined) {
            void multiplayerGuestGame(next).catch((e) => logError("multiplayerGuestGame", e));
        }
    }

    function pickGame(next: number | null) {
        rememberMultiplayerGame(next);
        setPickedGameId(next);
        setProblem(null);
    }

    function chooseCore(next: string) {
        if (hosted) {
            const forGame = gameId;
            void run(async () => {
                const changed = await multiplayerRoomOptions(null, next, null);
                if (changed.ok) {
                    rememberMultiplayerCore(forGame, next);
                    setCoreState(next);
                }
                return changed;
            });
            return;
        }
        rememberMultiplayerCore(gameId, next);
        setCoreState(next);
    }

    function setHardcore(next: boolean) {
        rememberMultiplayerHardcore(next);
        setHardcoreState(next);
        if ((hosted && mode === "couch") || (joined && mode === "link")) {
            void run(() => multiplayerRoomOptions(next, null, null));
        }
    }

    function setShare(next: boolean) {
        rememberMultiplayerShare(next);
        setShareState(next);
        if (hosted) {
            void run(() => multiplayerRoomOptions(null, null, next));
        }
    }


    async function closeRoom() {
        await run(() => multiplayerCloseRoom());
        forgetMultiplayerRoomChoices();
        setHardcoreState(false);
    }

    function dropSeat(seat: number) {
        return run(() => multiplayerDropSeat(seat));
    }

    async function leave() {
        if (joined) {
            await run(() => multiplayerLeave());
        }
    }

    function play() {
        const appid = check?.local?.appid ?? 0;
        if (!appid) {
            return Promise.resolve(false);
        }
        return run(() => launchMultiplayer(appid, hardcore));
    }

    function start() {
        return run(() => startMultiplayerRound(hosted?.mode === "couch" && hosted.emulator === "dolphin"));
    }

    function toggleReady() {
        if (!joined) {
            return Promise.resolve(false);
        }
        const next = !joined.ready;
        return run(() => pressMultiplayerReady(next));
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
                : hosted && mode === "couch" ? hosted.hardcore : joined ? joined.hardcore : hardcore,
            shareControls: hosted ? hosted.share : shareControls,
            core,
            visibleError,
            hosted,
            joined,
            closedReason: status?.role === null ? status.closedReason : "",
            lobby: status?.role === null ? Boolean(status.lobby) : false,
            check,
            checkCurrent: checkedFor === checkKey,
            games,
            scanned,
            installedCores,
            busy,
            problem,
            headerPayload,
            session,
            loaded: games !== null && status !== null
        },
        actions: {
            setCurrentGameId,
            setTab,
            pickGame,
            changeGame,
            chooseCore,
            setHardcore,
            setShare,
            closeRoom,
            dropSeat,
            leave,
            play,
            start,
            toggleReady
        }
    };
}
