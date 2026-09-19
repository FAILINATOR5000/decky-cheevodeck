import { useCallback, useEffect, useRef, useState } from "react";
import { getMemoriesVideoMoveStatus, startMemoriesVideoMove } from "../api";
import { t, type LanguageCode } from "../locales";
import type { MemoriesVideoMoveStatus } from "../types";
import { logError } from "../utils/errors";
import { openPathPicker } from "../components/pickers/FilePickerModal";
import { openMemoriesVideoMoveModal } from "../components/memories/MemoriesVideoMoveModal";
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
    root: "",
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

    const moveTo = useCallback(async (picked: string): Promise<boolean> => {
        try {
            const started = await startMemoriesVideoMove(picked);
            if (!started.ok) {
                if (started.error !== "same_place") {
                    setStatus({ ...IDLE, state: "failed", error: started.error ?? "failed" });
                }
                return false;
            }
            await readStatus();
            setRuns((count) => count + 1);
            return true;
        }
        catch (e) {
            logError("startMemoriesVideoMove", e);
            setStatus({ ...IDLE, state: "failed", error: "failed" });
            return false;
        }
    }, [readStatus]);

    const watchMove = useCallback((focusKey: string) => {
        armOptionsFocusKey(focusKey);
        openMemoriesVideoMoveModal(language);
    }, [language]);

    const pickLocation = useCallback(async () => {
        if (isRunning(status.state)) {
            watchMove("options:memories-video-path");
            return;
        }
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
        if (await moveTo(picked)) {
            watchMove("options:memories-video-path");
        }
    }, [language, moveTo, status.state, watchMove]);

    const useDefaultLocation = useCallback(async () => {
        if (isRunning(status.state)) {
            watchMove("options:memories-video-default");
            return;
        }
        if (await moveTo("")) {
            watchMove("options:memories-video-default");
        }
    }, [moveTo, status.state, watchMove]);

    return {
        status,
        pickLocation,
        useDefaultLocation
    };
}
