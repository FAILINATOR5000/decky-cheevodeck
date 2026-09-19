import { useCallback, useEffect, useRef, useState } from "react";
import { getMemoriesVideoMoveStatus, startMemoriesVideoMove } from "../api";
import { t, type LanguageCode } from "../locales";
import type { MemoriesVideoMoveStatus } from "../types";
import { logError } from "../utils/errors";
import { openPathPicker } from "../components/pickers/FilePickerModal";
import { armOptionsFocusKey } from "../utils/optionsFocusReturn";

const POLL_INTERVAL_MS = 900;

const IDLE: MemoriesVideoMoveStatus = {
    ok: true,
    state: "idle",
    error: "",
    copied: 0,
    files: 0,
    bytes: 0,
    totalBytes: 0,
    target: "",
    picked: "",
    rootAvailable: true
};

function isRunning(state: MemoriesVideoMoveStatus["state"]): boolean {
    return state === "checking" || state === "copying" || state === "verifying" || state === "finishing";
}

export type UseMemoriesVideoControllerOptions = {
    isActive: boolean;
    language: LanguageCode;
    onPathChanged: (next: string) => void;
};

export function useMemoriesVideoController(options: UseMemoriesVideoControllerOptions) {
    const { isActive, language, onPathChanged } = options;

    const [status, setStatus] = useState<MemoriesVideoMoveStatus>(IDLE);
    const [starting, setStarting] = useState(false);
    const [runs, setRuns] = useState(0);
    const pollingRef = useRef(false);
    const settledPathRef = useRef<string | null>(null);

    const readStatus = useCallback(async () => {
        try {
            const next = await getMemoriesVideoMoveStatus();
            setStatus(next);
            return next;
        }
        catch (e) {
            logError("getMemoriesVideoMoveStatus", e);
            return null;
        }
    }, []);

    useEffect(function followTheMove() {
        if (!isActive) {
            return;
        }
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        async function tick() {
            const next = await readStatus();
            if (cancelled) {
                return;
            }
            const running = next !== null && isRunning(next.state);
            pollingRef.current = running;
            if (running) {
                timer = setTimeout(tick, POLL_INTERVAL_MS);
                return;
            }
            if (next !== null && settledPathRef.current !== next.picked) {
                settledPathRef.current = next.picked;
                onPathChanged(next.picked);
            }
        }

        void tick();
        return () => {
            cancelled = true;
            if (timer !== null) {
                clearTimeout(timer);
            }
        };
    }, [isActive, runs, readStatus, onPathChanged]);

    const moveTo = useCallback(async (picked: string) => {
        setStarting(true);
        try {
            const started = await startMemoriesVideoMove(picked);
            if (!started.ok) {
                setStatus({ ...IDLE, state: "failed", error: started.error ?? "failed" });
                return;
            }
            await readStatus();
            setRuns((count) => count + 1);
        }
        catch (e) {
            logError("startMemoriesVideoMove", e);
            setStatus({ ...IDLE, state: "failed", error: "failed" });
        }
        finally {
            setStarting(false);
        }
    }, [readStatus]);

    const pickLocation = useCallback(async () => {
        armOptionsFocusKey("options:memories-video-path");
        let picked: string | undefined;
        try {
            const chosen = await openPathPicker({
                language,
                prompt: t(language, "Choose where clip videos are kept"),
                startPath: "/home/deck",
                includeFiles: false,
                includeFolders: true
            });
            picked = chosen.realpath || chosen.path;
        }
        catch {
            return;
        }
        if (!picked) {
            return;
        }
        await moveTo(picked);
    }, [language, moveTo]);

    const useDefaultLocation = useCallback(async () => {
        await moveTo("");
    }, [moveTo]);

    return {
        status,
        busy: starting || isRunning(status.state),
        pickLocation,
        useDefaultLocation
    };
}
