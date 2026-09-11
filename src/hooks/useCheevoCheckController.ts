import { toaster } from "@decky/api";
import { useCallback, useEffect, useRef, useState } from "react";

import {
    cancelCheevoCheckScan,
    clearCheevoCheckHashCache,
    getCheevoCheckScanStatus,
    getCheevoCheckState,
    saveCheevoCheckReport,
    startCheevoCheckScan
} from "../api";
import { t, type LanguageCode } from "../locales";
import type { CheevoCheckState } from "../types";
import { clearCheevoCheckFocusReturn } from "../utils/cheevoCheckFocusReturn";
import { logError } from "../utils/errors";
import { openPathPicker } from "../components/pickers/FilePickerModal";

type UseCheevoCheckControllerArgs = {
    isActive: boolean;
    language: LanguageCode;
};

const RUNNING_POLL_MS = 1000;

export function useCheevoCheckController({ isActive, language }: UseCheevoCheckControllerArgs) {
    const [state, setState] = useState<CheevoCheckState | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [starting, setStarting] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [savingReport, setSavingReport] = useState(false);

    const loadingRef = useRef(false);

    const reload = useCallback(async () => {
        loadingRef.current = true;
        try {
            const next = await getCheevoCheckState();
            setState(next ?? null);
        }
        catch (e) {
            logError("getCheevoCheckState", e);
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
        void reload();
    }, [isActive, reload]);

    const pollScan = useCallback(async () => {
        loadingRef.current = true;
        try {
            const status = await getCheevoCheckScanStatus();
            if (!status.running) {
                await reload();
                return;
            }
            setState((current) => {
                if (!current) {
                    return current;
                }
                return {
                    ...current,
                    running: true,
                    error: status.error ?? null,
                    progress: status.progress ?? null
                };
            });
        }
        catch (e) {
            logError("getCheevoCheckScanStatus", e);
        }
        finally {
            loadingRef.current = false;
        }
    }, [reload]);

    useEffect(() => {
        if (!isActive || !state?.running) {
            return;
        }
        const timer = window.setInterval(() => {
            if (document.visibilityState !== "visible" || loadingRef.current) {
                return;
            }
            void pollScan();
        }, RUNNING_POLL_MS);
        return () => window.clearInterval(timer);
    }, [isActive, state?.running, pollScan]);

    const cancelScan = useCallback(async () => {
        setCancelling(true);
        try {
            await cancelCheevoCheckScan();
        }
        catch (e) {
            logError("cancelCheevoCheckScan", e);
            setCancelling(false);
        }
    }, []);

    useEffect(() => {
        if (!state?.running) {
            setCancelling(false);
        }
    }, [state?.running]);

    const startScan = useCallback(async (offline: boolean) => {
        setStarting(true);
        try {
            const picked = await openPathPicker({
                language,
                prompt: t(language, "Choose your ROMs collection folder"),
                startPath: state?.startDir ?? "/home/deck",
                includeFiles: false,
                includeFolders: true
            });
            const root = picked.realpath || picked.path;
            if (!root) {
                return;
            }
            clearCheevoCheckFocusReturn();
            await startCheevoCheckScan(root, offline);
            await reload();
        }
        catch {
        }
        finally {
            setStarting(false);
        }
    }, [language, reload, state?.startDir]);

    const saveReport = useCallback(async (report: string) => {
        let folder: string | undefined;
        try {
            const picked = await openPathPicker({
                language,
                prompt: t(language, "Choose where to save the report."),
                startPath: "/home/deck/Downloads",
                includeFiles: false,
                includeFolders: true
            });
            folder = picked.realpath || picked.path;
        }
        catch {
            return;
        }
        if (!folder) {
            return;
        }

        setSavingReport(true);
        try {
            const saved = await saveCheevoCheckReport(folder, report);
            toaster.toast(saved.ok
                ? { title: t(language, "Report saved"), body: saved.name ?? "" }
                : { title: t(language, "Report not saved"), body: t(language, "Couldn't save there. Pick another folder.") });
        }
        catch (e) {
            logError("saveCheevoCheckReport", e);
            toaster.toast({
                title: t(language, "Report not saved"),
                body: t(language, "Couldn't save there. Pick another folder.")
            });
        }
        finally {
            setSavingReport(false);
        }
    }, [language]);

    const clearHashCache = useCallback(async () => {
        try {
            await clearCheevoCheckHashCache();
        }
        catch (e) {
            logError("clearCheevoCheckHashCache", e);
        }
        await reload();
    }, [reload]);

    return {
        state,
        loaded,
        starting,
        cancelling,
        savingReport,
        startScan,
        cancelScan,
        saveReport,
        clearHashCache
    };
}
