import { useCallback, useEffect, useRef, useState } from "react";

import {
    cancelDataTransfer,
    dataTransferStatus,
    discoverDataDevices,
    getDataTransferLocalSummary,
    setNearbyVisible,
    startDataImport
} from "../api";
import type {
    DataDeviceRow,
    DataKind,
    DataTransferMode,
    DataTransferStatus,
    DataTransferSummary
} from "../types";
import {
    currentDataKind,
    currentDataMode,
    forgetDataChoices,
    rememberDataKind,
    rememberDataMode
} from "../utils/dataTransferChoices";
import { lastDataDevices, rememberDataDevices } from "../utils/dataTransferDevices";
import { logError } from "../utils/errors";

type UseDataTransferControllerArgs = {
    isActive: boolean;
};

const RUNNING_POLL_MS = 1000;

const NEARBY_TICK_MS = 5000;

export const DATA_NEARBY_FOCUS_PREFIX = "dataTransfer:nearby:";

const RUNNING_STATES = ["connecting", "receiving", "saving", "committing"];

function isRunning(status: DataTransferStatus | null): boolean {
    return status !== null && RUNNING_STATES.includes(status.state);
}

export function useDataTransferController({ isActive }: UseDataTransferControllerArgs) {
    const [status, setStatus] = useState<DataTransferStatus | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [starting, setStarting] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [kind, setKindState] = useState<DataKind>(currentDataKind);
    const [mode, setModeState] = useState<DataTransferMode>(currentDataMode);
    const [startError, setStartError] = useState("");
    const [localSummary, setLocalSummary] = useState<DataTransferSummary | null>(null);
    const [nearby, setNearby] = useState<DataDeviceRow[] | null>(lastDataDevices);
    const [nearbyClosed, setNearbyClosed] = useState(false);
    const [sawRunning, setSawRunning] = useState(false);
    const discoveringRef = useRef(false);
    const runningRef = useRef(false);
    const loadingRef = useRef(false);

    const setKind = useCallback((next: DataKind) => {
        rememberDataKind(next);
        setKindState(next);
        setStartError("");
    }, []);

    const setMode = useCallback((next: DataTransferMode) => {
        rememberDataMode(next);
        setModeState(next);
    }, []);

    const reload = useCallback(async () => {
        loadingRef.current = true;
        try {
            setStatus(await dataTransferStatus());
        }
        catch (e) {
            logError("dataTransferStatus", e);
        }
        finally {
            loadingRef.current = false;
            setLoaded(true);
        }
    }, []);

    const reloadLocalSummary = useCallback(async () => {
        try {
            const summary = await getDataTransferLocalSummary();
            setLocalSummary(summary);
            return summary;
        }
        catch (e) {
            logError("getDataTransferLocalSummary", e);
            return null;
        }
    }, []);

    useEffect(() => {
        if (!isActive) {
            return;
        }
        setStartError("");
        void reload();
        void reloadLocalSummary();
    }, [isActive, reload, reloadLocalSummary]);

    const wasActiveRef = useRef(isActive);
    useEffect(function forgetTheVisitOnTheWayOut() {
        const wasActive = wasActiveRef.current;
        wasActiveRef.current = isActive;
        if (isActive || !wasActive) {
            return;
        }
        forgetDataChoices();
        rememberDataDevices(null);
        setKindState("all");
        setModeState("merge");
        setNearby(null);
        setNearbyClosed(false);
        setSawRunning(false);
    }, [isActive]);

    const running = isRunning(status);
    runningRef.current = running;

    useEffect(() => {
        if (running) {
            setSawRunning(true);
        }
    }, [running]);

    const discover = useCallback(async () => {
        if (discoveringRef.current) {
            return;
        }
        discoveringRef.current = true;
        try {
            const found = await discoverDataDevices();
            if (found.ok) {
                const rows = found.devices ?? [];
                rememberDataDevices(rows);
                setNearby(rows);
            }
        }
        catch (e) {
            logError("discoverDataDevices", e);
        }
        finally {
            discoveringRef.current = false;
        }
    }, []);

    useEffect(() => {
        if (!isActive || nearbyClosed) {
            return;
        }
        let alive = true;
        let tick = 0;
        const endVisit = () => {
            alive = false;
            rememberDataDevices([]);
            setNearby([]);
            setNearbyClosed(true);
        };
        void (async () => {
            try {
                const opened = await setNearbyVisible(true, true, "data");
                if (!alive) {
                    return;
                }
                if (!opened.ok) {
                    endVisit();
                    return;
                }
                if (!runningRef.current) {
                    await discover();
                }
            }
            catch (e) {
                logError("setNearbyVisible", e);
            }
        })();
        const timer = window.setInterval(() => {
            tick += 1;
            if (tick % 2 === 0) {
                setNearbyVisible(true, false, "data")
                    .then((renewed) => {
                        if (alive && !renewed.ok) {
                            endVisit();
                        }
                    })
                    .catch((e) => logError("setNearbyVisible", e));
            }
            if (alive && !runningRef.current) {
                void discover();
                if (!loadingRef.current) {
                    void reload();
                }
            }
        }, NEARBY_TICK_MS);
        return () => {
            alive = false;
            window.clearInterval(timer);
            setNearbyVisible(false, false, "data").catch((e) => logError("setNearbyVisible", e));
        };
    }, [isActive, nearbyClosed, discover, reload]);

    useEffect(() => {
        if (!isActive || !running) {
            return;
        }
        const timer = window.setInterval(() => {
            if (loadingRef.current) {
                return;
            }
            void reload();
        }, RUNNING_POLL_MS);
        return () => window.clearInterval(timer);
    }, [isActive, running, reload]);

    useEffect(() => {
        if (!running) {
            setCancelling(false);
        }
    }, [running]);

    const settledRef = useRef("");
    useEffect(() => {
        const landed = status?.state ?? "";
        if (landed === settledRef.current) {
            return;
        }
        settledRef.current = landed;
        if (landed === "done") {
            void reloadLocalSummary();
        }
    }, [status?.state, reloadLocalSummary]);

    const cancel = useCallback(async () => {
        setCancelling(true);
        try {
            const answer = await cancelDataTransfer();
            if (!answer.ok) {
                setCancelling(false);
            }
        }
        catch (e) {
            logError("cancelDataTransfer", e);
            setCancelling(false);
        }
    }, []);

    const forgetFinished = useCallback(() => setSawRunning(false), []);

    const pullFrom = useCallback(async (row: DataDeviceRow) => {
        setStarting(true);
        setStartError("");
        try {
            const started = await startDataImport(row.id, kind, kind === "milestones" ? "replace" : mode);
            if (!started.ok) {
                setStartError(started.error ?? "");
            }
            else {
                setSawRunning(true);
            }
            await reload();
        }
        catch (e) {
            logError("startDataImport", e);
        }
        finally {
            setStarting(false);
        }
    }, [kind, mode, reload]);

    return {
        status,
        loaded,
        running,
        starting,
        cancelling,
        kind,
        setKind,
        mode,
        setMode,
        startError,
        setStartError,
        localSummary,
        reloadLocalSummary,
        nearby,
        nearbyClosed,
        sawRunning,
        forgetFinished,
        pullFrom,
        cancel
    };
}
