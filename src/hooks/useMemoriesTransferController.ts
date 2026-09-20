import { useCallback, useEffect, useRef, useState } from "react";

import {
    cancelMemoriesTransfer,
    discardMemoriesRestore,
    listMemoryBundles,
    memoriesExportCounts,
    memoriesExportWeight,
    memoriesTransferStatus,
    recoverMemoriesRestore,
    startMemoriesExport,
    startMemoriesImport
} from "../api";
import { t, type LanguageCode } from "../locales";
import type {
    MemoriesExportCounts,
    MemoriesExportWeight,
    MemoriesTransferMode,
    MemoriesTransferStatus,
    MemoryBundleRow
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
import { clearMemoriesTransferFocusReturn } from "../utils/memoriesTransferFocusReturn";
import { logError } from "../utils/errors";
import { openPathPicker } from "../components/pickers/FilePickerModal";

type UseMemoriesTransferControllerArgs = {
    isActive: boolean;
    language: LanguageCode;
};

const RUNNING_POLL_MS = 1000;

const RUNNING_STATES = ["scanning", "writing", "validating", "importing", "finishing"];

const PICKER_START_PATH = "/home/deck";

function isRunning(status: MemoriesTransferStatus | null): boolean {
    return status !== null && RUNNING_STATES.includes(status.state);
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

    const listFolder = useCallback(async (folder: string) => {
        setListing(true);
        try {
            const found = await listMemoryBundles(folder);
            setBundles(found.bundles ?? []);
            setBundleFolderEmpty((found.bundles ?? []).length === 0);
        }
        catch (e) {
            logError("listMemoryBundles", e);
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
        const folder = takeBundleFolder();
        if (folder !== null) {
            void listFolder(folder);
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
        setBundles(null);
        setBundleFolderEmpty(false);
        setIncludeVideosState(true);
        setModeState("merge");
    }, [isActive]);

    useEffect(() => {
        if (!isActive) {
            return;
        }
        void reloadEstimate();
    }, [isActive, reloadEstimate]);

    const running = isRunning(status);

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
            clearMemoriesTransferFocusReturn();
            const started = await startMemoriesExport(folder, includeVideos);
            if (!started.ok) {
                setStartError(started.error ?? "");
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
            rememberBundleFolder(folder);
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

    const recoverStashed = useCallback(async () => {
        try {
            await recoverMemoriesRestore();
        }
        catch (e) {
            logError("recoverMemoriesRestore", e);
        }
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
            void reloadEstimate();
        }
    }, [status?.state, reloadEstimate]);

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
        cancel,
        recoverStashed,
        discardStashed
    };
}
