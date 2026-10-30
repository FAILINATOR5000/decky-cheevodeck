import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
    getGamePayload,
    multiplayerCheck,
    multiplayerCloseRoom,
    multiplayerDiscover,
    multiplayerDropSeat,
    multiplayerGames,
    multiplayerHost,
    multiplayerJoin,
    multiplayerLeave,
    multiplayerLookup,
    multiplayerRoomOptions,
    multiplayerRoomStatus,
    multiplayerSetVisible
} from "../api";
import type {
    MultiplayerCheck,
    MultiplayerGame,
    MultiplayerMode,
    MultiplayerRoomRow,
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
    rememberMultiplayerPrivate,
    rememberMultiplayerTab
} from "../utils/multiplayerChoices";
import {
    forgetMultiplayerFailure,
    launchMultiplayer,
    multiplayerSessionSnapshot,
    subscribeMultiplayerSession
} from "../utils/multiplayerSession";

const TICK_MS = 2000;
const DISCOVER_EVERY = 2;
const RENEW_EVERY = 5;

export type MultiplayerProblem = { code: string; detail?: Record<string, string> };

const headerPayloads = new Map<number, Payload>();

export function useMultiplayerController({ isActive }: { isActive: boolean }) {
    const [tab, setTabState] = useState<MultiplayerMode>(() => multiplayerChoices().tab);
    const [currentGameId, setCurrentGameId] = useState<number | null>(null);
    const [pickedGameId, setPickedGameId] = useState<number | null>(() => multiplayerChoices().gameId);
    const [hardcore, setHardcoreState] = useState(() => multiplayerChoices().hardcore);
    const [privateRoom, setPrivateState] = useState(() => multiplayerChoices().private);
    const [visibleError, setVisibleError] = useState("");
    const [rooms, setRooms] = useState<MultiplayerRoomRow[] | null>(null);
    const [status, setStatus] = useState<MultiplayerRoomStatus | null>(null);
    const [check, setCheck] = useState<MultiplayerCheck | null>(null);
    const [games, setGames] = useState<MultiplayerGame[] | null>(null);
    const [scanned, setScanned] = useState(true);
    const [installedCores, setInstalledCores] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<MultiplayerProblem | null>(null);
    const [pendingRoom, setPendingRoom] = useState<MultiplayerRoomRow | null>(null);
    const [headerPayload, setHeaderPayload] = useState<Payload | null>(null);
    const session = useSyncExternalStore(subscribeMultiplayerSession, multiplayerSessionSnapshot);
    const discoveringRef = useRef(false);
    const checkTokenRef = useRef(0);

    const hosted = status?.role === "host" ? status.room : null;
    const joined = status?.role === "guest" ? status : null;
    const mode: MultiplayerMode = hosted?.mode ?? joined?.room.mode ?? tab;
    const ownGameId = pickedGameId ?? currentGameId;
    const gameId = hosted
        ? hosted.gameId
        : joined?.room.mode === "couch"
            ? joined.room.gameId
            : pendingRoom?.mode === "couch" ? pendingRoom.gameId : ownGameId;
    const [core, setCoreState] = useState(() => multiplayerCoreFor(gameId));
    const checkRoom = joined ? joined.room.room : pendingRoom?.room ?? "";

    const reloadStatus = useCallback(async () => {
        try {
            setStatus(await multiplayerRoomStatus());
        }
        catch (e) {
            logError("multiplayerRoomStatus", e);
        }
    }, []);

    const discover = useCallback(async () => {
        if (discoveringRef.current) {
            return;
        }
        discoveringRef.current = true;
        try {
            const found = await multiplayerDiscover();
            if (found.ok) {
                setRooms(found.rooms ?? []);
            }
        }
        catch (e) {
            logError("multiplayerDiscover", e);
        }
        finally {
            discoveringRef.current = false;
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
        setRooms(null);
        setStatus(null);
        setCheck(null);
        setPendingRoom(null);
        setProblem(null);
        setVisibleError("");
    }, [isActive]);

    const hostingOrJoined = hosted !== null || joined !== null;
    const hostingOrJoinedRef = useRef(hostingOrJoined);
    hostingOrJoinedRef.current = hostingOrJoined;

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
                if (opened.ok) {
                    await discover();
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
                            setVisibleError(renewed.ok ? "" : renewed.error ?? "unavailable");
                        }
                    })
                    .catch((e) => logError("multiplayerSetVisible", e));
            }
            void reloadStatus();
            if (tick % DISCOVER_EVERY === 0 && !hostingOrJoinedRef.current) {
                void discover();
            }
        }, TICK_MS);
        return () => {
            alive = false;
            window.clearInterval(timer);
        };
    }, [isActive, discover, reloadStatus]);

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
                const result = await multiplayerCheck(mode, gameId, core, checkRoom);
                if (checkTokenRef.current === token) {
                    setCheck(result);
                }
            }
            catch (e) {
                logError("multiplayerCheck", e);
            }
        })();
    }, [isActive, mode, gameId, core, checkRoom, hosted?.core, hostedSeats, joinedState]);

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
        if (hostingOrJoined) {
            return;
        }
        rememberMultiplayerTab(next);
        setTabState(next);
        setPendingRoom(null);
        setProblem(null);
    }

    function pickGame(next: number | null) {
        rememberMultiplayerGame(next);
        setPickedGameId(next);
        setProblem(null);
    }

    function chooseCore(next: string) {
        rememberMultiplayerCore(gameId, next);
        setCoreState(next);
        if (hosted) {
            void run(() => multiplayerRoomOptions(null, null, next));
        }
    }

    function setHardcore(next: boolean) {
        rememberMultiplayerHardcore(next);
        setHardcoreState(next);
        if (hosted && mode === "couch") {
            void run(() => multiplayerRoomOptions(next, null, null));
        }
    }

    function setPrivate(next: boolean) {
        rememberMultiplayerPrivate(next);
        setPrivateState(next);
        if (hosted) {
            void run(() => multiplayerRoomOptions(null, next, null));
        }
    }

    async function freshVisit() {
        if (!visibleError) {
            return;
        }
        const opened = await multiplayerSetVisible(true, true);
        setVisibleError(opened.ok ? "" : opened.error ?? "unavailable");
    }

    function host() {
        if (gameId === null) {
            return Promise.resolve(false);
        }
        return run(async () => {
            await freshVisit();
            return multiplayerHost(tab, gameId, hardcore, privateRoom, core);
        });
    }

    async function closeRoom() {
        await run(() => multiplayerCloseRoom());
        forgetMultiplayerRoomChoices();
        setHardcoreState(false);
        setPrivateState(false);
    }

    function dropSeat(seat: number) {
        return run(() => multiplayerDropSeat(seat));
    }

    function join(row: MultiplayerRoomRow, code: string) {
        return run(async () => {
            const own = row.mode === "couch" ? 0 : ownGameId ?? 0;
            await freshVisit();
            const joinedRoom = await multiplayerJoin(row.room, code, own, core);
            if (joinedRoom.ok) {
                setPendingRoom(null);
            }
            return joinedRoom;
        });
    }

    function pickRoom(row: MultiplayerRoomRow) {
        setProblem(null);
        if (row.private) {
            setPendingRoom(row);
            return;
        }
        void join(row, "");
    }

    async function lookup(address: string) {
        setBusy(true);
        setProblem(null);
        try {
            const found = await multiplayerLookup(address);
            if (!found.ok || !found.room) {
                setProblem({ code: found.error ?? "not_found" });
                return null;
            }
            const room = found.room;
            setRooms((listed) => [room, ...(listed ?? []).filter((row) => row.room !== room.room)]);
            return room;
        }
        catch (e) {
            logError("multiplayerLookup", e);
            setProblem({ code: "not_found" });
            return null;
        }
        finally {
            setBusy(false);
        }
    }

    async function leave() {
        setPendingRoom(null);
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

    return {
        state: {
            tab,
            mode,
            gameId,
            currentGameId,
            pickedGameId,
            hardcore: mode === "couch" && joined?.status ? joined.status.hardcore : hosted && mode === "couch" ? hosted.hardcore : hardcore,
            privateRoom: hosted ? hosted.private : privateRoom,
            core,
            visibleError,
            rooms,
            hosted,
            joined,
            closedReason: status?.role === null ? status.closedReason : "",
            check,
            games,
            scanned,
            installedCores,
            busy,
            problem,
            pendingRoom,
            headerPayload,
            session,
            loaded: games !== null && status !== null
        },
        actions: {
            setCurrentGameId,
            setTab,
            pickGame,
            chooseCore,
            setHardcore,
            setPrivate,
            host,
            closeRoom,
            dropSeat,
            pickRoom,
            join,
            lookup,
            leave,
            cancelPendingRoom: () => setPendingRoom(null),
            play
        }
    };
}
