import { FileSelectionType, openFilePicker } from "@decky/api";
import { toaster } from "@decky/api";
import { useCallback, useEffect, useRef, useState } from "react";

import {
    addFileWatcherRoot,
    cancelFileWatcherPass,
    dismissFileWatcherFinding,
    forgetFileWatcherRootHashes,
    getFileWatcherExcluded,
    getFileWatcherFindings,
    getFileWatcherPassStatus,
    getFileWatcherState,
    removeFileWatcherRoot,
    saveFileWatcherReport,
    saveFileWatcherSpeed,
    startFileWatcherPass,
    updateFileWatcherRoot,
    updateFileWatcherSchedule,
    updateFileWatcherWindow
} from "../api";
import { t, type LanguageCode } from "../locales";
import type { FileWatcherBucket, FileWatcherFinding, FileWatcherSpeed, FileWatcherState } from "../types";
import { logError } from "../utils/errors";
import { REPORTED_BUCKETS, buildFileWatcherReport } from "../utils/fileWatcher";

const ACTIVE_POLL_MS = 1000;

const PAUSED_POLL_MS = 10000;

const REPORT_PAGE_ROWS = 1000;

const REPORT_MAX_ROWS = 20000;

type UseFileWatcherControllerArgs = {
    isActive: boolean;
    language: LanguageCode;
};

export function useFileWatcherController({ isActive, language }: UseFileWatcherControllerArgs) {
    const [state, setState] = useState<FileWatcherState | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [starting, setStarting] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [savingReport, setSavingReport] = useState(false);

    const loadingRef = useRef(false);
    const hadPassRef = useRef(false);

    const reload = useCallback(async () => {
        loadingRef.current = true;
        try {
            const next = await getFileWatcherState();
            setState(next ?? null);
        }
        catch (e) {
            logError("getFileWatcherState", e);
        }
        finally {
            loadingRef.current = false;
            setLoaded(true);
        }
    }, []);

    useEffect(() => {
        if (!isActive) {
            return;
        }
        setError(null);
        void reload();
    }, [isActive, reload]);

    const pollPass = useCallback(async () => {
        loadingRef.current = true;
        try {
            const status = await getFileWatcherPassStatus();
            if (!status.pass) {
                if (hadPassRef.current) {
                    await reload();
                }
                return;
            }
            setState((current) => (current ? { ...current, pass: status.pass } : current));
        }
        catch (e) {
            logError("getFileWatcherPassStatus", e);
        }
        finally {
            loadingRef.current = false;
        }
    }, [reload]);

    const running = state?.pass?.active ?? false;
    const hasPass = Boolean(state?.pass);
    const parked = hasPass && !running;

    useEffect(() => {
        hadPassRef.current = hasPass;
    }, [hasPass]);

    const watchingForSchedule = Boolean(state?.schedule.enabled);

    useEffect(() => {
        if (!isActive || (!hasPass && !watchingForSchedule)) {
            return;
        }
        const timer = window.setInterval(() => {
            if (document.visibilityState !== "visible" || loadingRef.current) {
                return;
            }
            void pollPass();
        }, running ? ACTIVE_POLL_MS : PAUSED_POLL_MS);
        return () => window.clearInterval(timer);
    }, [isActive, hasPass, watchingForSchedule, running, pollPass]);

    const startPass = useCallback(async () => {
        setStarting(true);
        setError(null);
        try {
            const started = await startFileWatcherPass();
            if (!started.ok) {
                setError(started.error ?? "failed");
            }
            await reload();
        }
        catch (e) {
            logError("startFileWatcherPass", e);
            setError("failed");
        }
        finally {
            setStarting(false);
        }
    }, [reload]);

    const cancelPass = useCallback(async () => {
        setCancelling(true);
        try {
            await cancelFileWatcherPass();
        }
        catch (e) {
            logError("cancelFileWatcherPass", e);
            setCancelling(false);
        }
    }, []);

    useEffect(() => {
        if (!hasPass) {
            setCancelling(false);
        }
    }, [hasPass]);

    const addRoot = useCallback(async () => {
        setError(null);
        let picked: string | undefined;
        try {
            const chosen = await openFilePicker(
                FileSelectionType.FOLDER,
                state?.startDir ?? "/home/deck",
                false,
                true
            );
            picked = chosen?.realpath || chosen?.path;
        }
        catch {
            return;
        }
        if (!picked) {
            return;
        }

        try {
            const added = await addFileWatcherRoot(picked);
            if (!added.ok) {
                setError(added.error ?? "failed");
            }
        }
        catch (e) {
            logError("addFileWatcherRoot", e);
            setError("failed");
        }
        await reload();
    }, [reload, state?.startDir]);

    const removeRoot = useCallback(async (rootId: number) => {
        setError(null);
        try {
            const removed = await removeFileWatcherRoot(rootId);
            if (!removed.ok) {
                setError(removed.error ?? "failed");
            }
        }
        catch (e) {
            logError("removeFileWatcherRoot", e);
            setError("failed");
        }
        await reload();
    }, [reload]);

    const saveRoot = useCallback(async (rootId: number, label: string | null, excludes: string[] | null) => {
        setError(null);
        let refusal: string | null = null;
        try {
            const saved = await updateFileWatcherRoot(rootId, label, excludes);
            if (!saved.ok) {
                refusal = saved.error ?? "failed";
                setError(refusal);
            }
        }
        catch (e) {
            logError("updateFileWatcherRoot", e);
            refusal = "failed";
            setError(refusal);
        }
        await reload();
        return refusal;
    }, [reload]);

    const forgetRootHashes = useCallback(async (rootId: number) => {
        setError(null);
        let refusal: string | null = null;
        try {
            const forgotten = await forgetFileWatcherRootHashes(rootId);
            if (!forgotten.ok) {
                refusal = forgotten.error ?? "failed";
                setError(refusal);
            }
        }
        catch (e) {
            logError("forgetFileWatcherRootHashes", e);
            refusal = "failed";
            setError(refusal);
        }
        await reload();
        return refusal;
    }, [reload]);

    const saveSchedule = useCallback(async (
        enabled: boolean,
        everyWeeks: number,
        weekday: number,
        hour: number,
        minute: number
    ) => {
        try {
            await updateFileWatcherSchedule(enabled, everyWeeks, weekday, hour, minute);
        }
        catch (e) {
            logError("updateFileWatcherSchedule", e);
        }
        await reload();
    }, [reload]);

    const saveWindow = useCallback(async (
        enabled: boolean,
        blockFrom: [number, number],
        blockTo: [number, number]
    ) => {
        try {
            await updateFileWatcherWindow(enabled, blockFrom, blockTo);
        }
        catch (e) {
            logError("updateFileWatcherWindow", e);
        }
        await reload();
    }, [reload]);

    const saveSpeed = useCallback(async (value: FileWatcherSpeed) => {
        try {
            await saveFileWatcherSpeed(value);
        }
        catch (e) {
            logError("saveFileWatcherSpeed", e);
        }
    }, []);

    const collectRows = useCallback(async <T extends { rootId: number; relPath: string }>(
        fetchPage: (
            limit: number, rootId: number | null, afterRootId: number, afterRelPath: string
        ) => Promise<{ rows: T[] }>
    ) => {
        const found: T[] = [];
        let afterRootId = 0;
        let afterRelPath = "";
        while (found.length < REPORT_MAX_ROWS) {
            const page = await fetchPage(REPORT_PAGE_ROWS, null, afterRootId, afterRelPath);
            const rows = page.rows ?? [];
            if (!rows.length) {
                break;
            }
            found.push(...rows);
            afterRootId = rows[rows.length - 1].rootId;
            afterRelPath = rows[rows.length - 1].relPath;
        }
        return found;
    }, []);

    const saveReport = useCallback(async () => {
        if (!state) {
            return;
        }
        let folder: string | undefined;
        try {
            const picked = await openFilePicker(
                FileSelectionType.FOLDER,
                "/home/deck/Downloads",
                false,
                true
            );
            folder = picked?.realpath || picked?.path;
        }
        catch {
            return;
        }
        if (!folder) {
            return;
        }

        setSavingReport(true);
        try {
            const rows: Partial<Record<FileWatcherBucket, FileWatcherFinding[]>> = {};
            for (const bucket of REPORTED_BUCKETS) {
                rows[bucket] = await collectRows((limit, rootId, afterRootId, afterRelPath) =>
                    getFileWatcherFindings(bucket, limit, rootId, afterRootId, afterRelPath));
            }
            const excluded = await collectRows(getFileWatcherExcluded);
            const report = buildFileWatcherReport({ watcher: state, rows, excluded, language });
            const saved = await saveFileWatcherReport(folder, report);
            toaster.toast(saved.ok
                ? { title: t(language, "Report saved"), body: saved.name ?? "" }
                : { title: t(language, "Report not saved"), body: t(language, "Couldn't save there. Pick another folder.") });
        }
        catch (e) {
            logError("saveFileWatcherReport", e);
            toaster.toast({
                title: t(language, "Report not saved"),
                body: t(language, "Couldn't save there. Pick another folder.")
            });
        }
        finally {
            setSavingReport(false);
        }
    }, [collectRows, language, state]);

    const dismissFinding = useCallback(async (rootId: number, relPath: string, action: "accept" | "forget") => {
        try {
            await dismissFileWatcherFinding(rootId, relPath, action);
        }
        catch (e) {
            logError("dismissFileWatcherFinding", e);
        }
        await reload();
    }, [reload]);

    return {
        state,
        loaded,
        starting,
        cancelling,
        savingReport,
        running,
        parked,
        error,
        reload,
        startPass,
        cancelPass,
        addRoot,
        removeRoot,
        saveRoot,
        forgetRootHashes,
        saveSchedule,
        saveWindow,
        saveSpeed,
        saveReport,
        dismissFinding
    };
}
