import { useCallback, useEffect, useRef, useState } from "react";

import {
    cancelMemoriesTransfer,
    discardMemoriesRestore,
    discoverNearbyDevices,
    listMemoryBundles,
    memoriesExportCounts,
    memoriesExportWeight,
    memoriesTransferStatus,
    recoverMemoriesRestore,
    setNearbyVisible,
    startMemoriesExport,
    startMemoriesImport,
    startNearbyImport
} from "../api";
import { t, type LanguageCode } from "../locales";
import type {
    MemoriesExportCounts,
    MemoriesExportWeight,
    MemoriesTransferMode,
    MemoriesTransferStatus,
    MemoryBundleRow,
    NearbyDeviceRow
} from "../types";
import {
    forgetBundleFolder,
    rememberBundleFolder,
    takeBundleFolder
} from "../utils/memoriesBundleFolder";
import {
    currentIncludeVideos,
    currentTransferMode,
    forgetTransferChoices,
    rememberIncludeVideos,
    rememberTransferMode
} from "../utils/memoriesTransferChoices";
import { overrideRecord, pendingLandingKey, topEntryId } from "../focusRecords";
import { exportRefusalKey } from "../utils/memoriesTransferErrors";
import { lastNearbyDevices, rememberNearbyDevices } from "../utils/nearbyDevices";
import { announceMemoriesCaptureOn, announceMemoriesChanged } from "../utils/memoriesChanged";
import { logError } from "../utils/errors";
import { AFTER_DIALOG_TOAST_DELAY_MS, showToastAfter } from "../utils/delayedToast";
import { openPathPicker } from "../components/pickers/FilePickerModal";

type UseMemoriesTransferControllerArgs = {
    isActive: boolean;
    language: LanguageCode;
};

const RUNNING_POLL_MS = 1000;

const NEARBY_TICK_MS = 5000;

export const BUNDLE_FOCUS_PREFIX = "memoriesTransfer:bundle:";
export const IMPORT_AGAIN_FOCUS_KEY = "memoriesTransfer:import:another";
export const NEARBY_FOCUS_PREFIX = "memoriesTransfer:nearby:";

const RUNNING_STATES = [
    "scanning", "writing", "validating", "importing", "finishing",
    "connecting", "preparing", "receiving", "sending"
];

const PICKER_START_PATH = "/home/deck";

const TOAST_DURATION_MS = 4000;

function isRunning(status: MemoriesTransferStatus | null): boolean {
    return status !== null && RUNNING_STATES.includes(status.state);
}

function toastExportRefusal(language: LanguageCode, error: string) {
    showToastAfter({
        title: t(language, "Export"),
        body: t(language, exportRefusalKey(error)),
        duration: TOAST_DURATION_MS
    }, AFTER_DIALOG_TOAST_DELAY_MS);
}

export function useMemoriesTransferController({ isActive, language }: UseMemoriesTransferControllerArgs) {
    const [status, setStatus] = useState<MemoriesTransferStatus | null>(null);
    const [counts, setCounts] = useState<MemoriesExportCounts | null>(null);
    const [weight, setWeight] = useState<MemoriesExportWeight | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [starting, setStarting] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [includeVideos, setIncludeVideosState] = useState(currentIncludeVideos);
    const [mode, setModeState] = useState<MemoriesTransferMode>(currentTransferMode);

    const setIncludeVideos = useCallback((next: boolean) => {
        rememberIncludeVideos(next);
        setIncludeVideosState(next);
    }, []);

    const setMode = useCallback((next: MemoriesTransferMode) => {
        rememberTransferMode(next);
        setModeState(next);
    }, []);
    const [bundles, setBundles] = useState<MemoryBundleRow[] | null>(null);
    const [bundleFolderEmpty, setBundleFolderEmpty] = useState(false);
    const [listing, setListing] = useState(false);
    const [startError, setStartError] = useState("");
    const [nearby, setNearby] = useState<NearbyDeviceRow[] | null>(lastNearbyDevices);
    const [nearbyClosed, setNearbyClosed] = useState(false);
    const discoveringRef = useRef(false);
    const runningRef = useRef(false);

    const loadingRef = useRef(false);

    const reload = useCallback(async () => {
        loadingRef.current = true;
        try {
            setStatus(await memoriesTransferStatus());
        }
        catch (e) {
            logError("memoriesTransferStatus", e);
        }
        finally {
            loadingRef.current = false;
            setLoaded(true);
        }
    }, []);

    const reloadCounts = useCallback(async () => {
        try {
            setCounts(await memoriesExportCounts());
        }
        catch (e) {
            logError("memoriesExportCounts", e);
        }
    }, []);

    const reloadEstimate = useCallback(async () => {
        await reloadCounts();
        try {
            setWeight(await memoriesExportWeight());
        }
        catch (e) {
            logError("memoriesExportWeight", e);
        }
    }, [reloadCounts]);

    const listFolder = useCallback(async (folder: string, landEntry: number | null = null) => {
        const land = (rows: MemoryBundleRow[]) => {
            if (landEntry === null || pendingLandingKey("memoriesTransfer") === null) {
                return;
            }
            overrideRecord(landEntry, { focusKey: rows.length > 0 ? BUNDLE_FOCUS_PREFIX + rows[0].path : IMPORT_AGAIN_FOCUS_KEY });
        };
        setListing(true);
        try {
            const found = await listMemoryBundles(folder);
            land(found.bundles ?? []);
            setBundles(found.bundles ?? []);
            setBundleFolderEmpty((found.bundles ?? []).length === 0);
        }
        catch (e) {
            logError("listMemoryBundles", e);
            land([]);
            setBundles([]);
            setBundleFolderEmpty(true);
        }
        finally {
            setListing(false);
        }
    }, []);

    useEffect(() => {
        if (!isActive) {
            return;
        }
        setStartError("");
        void reload();
        const picked = takeBundleFolder();
        if (picked !== null) {
            void listFolder(picked.path, picked.entryId);
        }
    }, [isActive, reload, listFolder]);

    const wasActiveRef = useRef(isActive);
    useEffect(function forgetTheListingOnTheWayOut() {
        const wasActive = wasActiveRef.current;
        wasActiveRef.current = isActive;
        if (isActive || !wasActive) {
            return;
        }
        forgetBundleFolder();
        forgetTransferChoices();
        rememberNearbyDevices(null);
        setBundles(null);
        setBundleFolderEmpty(false);
        setIncludeVideosState(true);
        setModeState("merge");
        setNearby(null);
        setNearbyClosed(false);
    }, [isActive]);

    useEffect(() => {
        if (!isActive) {
            return;
        }
        void reloadEstimate();
    }, [isActive, reloadEstimate]);

    const running = isRunning(status);
    runningRef.current = running;

    const discover = useCallback(async () => {
        if (discoveringRef.current) {
            return;
        }
        discoveringRef.current = true;
        try {
            const found = await discoverNearbyDevices();
            if (found.ok) {
                const rows = found.devices ?? [];
                rememberNearbyDevices(rows);
                setNearby(rows);
            }
        }
        catch (e) {
            logError("discoverNearbyDevices", e);
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
            rememberNearbyDevices([]);
            setNearby([]);
            setNearbyClosed(true);
        };
        void (async () => {
            try {
                const opened = await setNearbyVisible(true, true);
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
                setNearbyVisible(true, false)
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
            setNearbyVisible(false, false).catch((e) => logError("setNearbyVisible", e));
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

    const cancel = useCallback(async () => {
        setCancelling(true);
        try {
            await cancelMemoriesTransfer();
        }
        catch (e) {
            logError("cancelMemoriesTransfer", e);
            setCancelling(false);
        }
    }, []);

    const startExport = useCallback(async () => {
        setStarting(true);
        setStartError("");
        try {
            const picked = await openPathPicker({
                language,
                prompt: t(language, "Choose where to save the bundle."),
                startPath: PICKER_START_PATH,
                includeFiles: false,
                includeFolders: true
            });
            const folder = picked.realpath || picked.path;
            if (!folder) {
                return;
            }
            const started = await startMemoriesExport(folder, includeVideos);
            if (!started.ok) {
                toastExportRefusal(language, started.error ?? "");
            }
            await reload();
        }
        catch {
        }
        finally {
            setStarting(false);
        }
    }, [language, includeVideos, reload]);

    const browseForBundles = useCallback(async () => {
        const entryId = topEntryId();
        setStarting(true);
        setStartError("");
        try {
            const picked = await openPathPicker({
                language,
                prompt: t(language, "Choose the folder holding your bundle."),
                startPath: PICKER_START_PATH,
                includeFiles: true,
                includeFolders: true
            });
            const folder = picked.realpath || picked.path;
            if (!folder) {
                return;
            }
            rememberBundleFolder(folder, entryId);
            await listFolder(folder);
        }
        catch {
        }
        finally {
            setStarting(false);
        }
    }, [language, listFolder]);

    const forgetBundles = useCallback(() => {
        forgetBundleFolder();
        setBundles(null);
        setBundleFolderEmpty(false);
    }, []);

    const startImport = useCallback(async (bundlePath: string) => {
        setStarting(true);
        setStartError("");
        try {
            const started = await startMemoriesImport(bundlePath, mode);
            if (!started.ok) {
                setStartError(started.error ?? "");
            }
            else {
                forgetBundleFolder();
                setBundles(null);
            }
            await reload();
        }
        catch (e) {
            logError("startMemoriesImport", e);
        }
        finally {
            setStarting(false);
        }
    }, [mode, reload]);

    const pullFromNearby = useCallback(async (row: NearbyDeviceRow) => {
        setStarting(true);
        setStartError("");
        try {
            const started = await startNearbyImport(row.id, includeVideos, mode);
            if (!started.ok) {
                setStartError(started.error ?? "");
            }
            await reload();
        }
        catch (e) {
            logError("startNearbyImport", e);
        }
        finally {
            setStarting(false);
        }
    }, [includeVideos, mode, reload]);

    const recoverStashed = useCallback(async () => {
        try {
            await recoverMemoriesRestore();
        }
        catch (e) {
            logError("recoverMemoriesRestore", e);
        }
        announceMemoriesChanged();
        await reload();
        await reloadEstimate();
    }, [reload, reloadEstimate]);

    const discardStashed = useCallback(async () => {
        try {
            await discardMemoriesRestore();
        }
        catch (e) {
            logError("discardMemoriesRestore", e);
        }
        await reload();
    }, [reload]);

    const settledRef = useRef<string>("");
    useEffect(() => {
        const landed = status?.state ?? "";
        if (landed === settledRef.current) {
            return;
        }
        settledRef.current = landed;
        if (landed === "done" || landed === "canceled" || landed === "failed") {
            announceMemoriesChanged();
            void reloadEstimate();
        }
        if (landed === "done" && status?.captureTurnedOn) {
            announceMemoriesCaptureOn();
        }
    }, [status?.state, status?.captureTurnedOn, reloadEstimate]);

    return {
        status,
        counts,
        weight,
        loaded,
        running,
        starting,
        cancelling,
        includeVideos,
        setIncludeVideos,
        mode,
        setMode,
        bundles,
        bundleFolderEmpty,
        refreshCounts: reloadCounts,
        refreshEstimate: reloadEstimate,
        listing,
        startError,
        startExport,
        browseForBundles,
        forgetBundles,
        startImport,
        nearby,
        nearbyClosed,
        pullFromNearby,
        cancel,
        recoverStashed,
        discardStashed
    };
}
