import { FileSelectionType, openFilePicker, toaster } from "@decky/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { downloadGamePatch, getGameHashes, type GameHashRow } from "../api";
import { t, type LanguageCode } from "../locales";
import { logError } from "../utils/errors";

export type UseGameHashesControllerOptions = {
    isActive: boolean;
    gameId: number | null;
    language: LanguageCode;
};

export function useGameHashesController(options: UseGameHashesControllerOptions) {
    const { isActive, gameId, language } = options;

    const [results, setResults] = useState<GameHashRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [needsSettings, setNeedsSettings] = useState(false);
    const [hashesForGameId, setHashesForGameId] = useState<number | null>(null);

    const [downloadingMd5, setDownloadingMd5] = useState<string | null>(null);

    const runIdRef = useRef(0);

    useEffect(() => {
        if (gameId === hashesForGameId) {
            return;
        }
        setResults([]);
        setError(null);
        setNeedsSettings(false);
        setHashesForGameId(null);
    }, [gameId, hashesForGameId]);

    const loadHashes = useCallback(async () => {
        if (gameId == null) {
            return;
        }
        const targetId = gameId;
        const runId = runIdRef.current + 1;
        runIdRef.current = runId;
        const owned = () => runIdRef.current === runId;

        setLoading(true);
        setError(null);
        setResults([]);

        try {
            const result = await getGameHashes(targetId);
            if (!owned()) {
                return;
            }
            if (result.needsSettings) {
                setNeedsSettings(true);
                return;
            }
            setResults(result.results ?? []);
            setHashesForGameId(targetId);
            if (result.error) {
                setError(result.error);
            }
        } catch (e: any) {
            if (!owned()) {
                return;
            }
            setError(String(e?.message || e || "Couldn't load supported hashes."));
        } finally {
            if (owned()) {
                setLoading(false);
            }
        }
    }, [gameId]);

    useEffect(() => {
        if (!isActive) {
            return;
        }
        if (gameId == null) {
            return;
        }
        if (loading) {
            return;
        }
        if (hashesForGameId === gameId) {
            return;
        }
        if (error) {
            return;
        }
        if (needsSettings) {
            return;
        }
        void loadHashes();
    }, [isActive, gameId, hashesForGameId, loading, error, needsSettings, loadHashes]);

    const downloadPatch = useCallback(async (row: GameHashRow) => {
        if (!row.patchUrl || downloadingMd5) {
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

        setDownloadingMd5(row.md5);
        try {
            const saved = await downloadGamePatch(row.patchUrl, folder);
            toaster.toast(saved.ok
                ? { title: t(language, "Patch saved"), body: saved.name ?? "" }
                : { title: t(language, "Patch not saved"), body: t(language, patchErrorKey(saved.error)) });
        }
        catch (e) {
            logError("downloadGamePatch", e);
            toaster.toast({
                title: t(language, "Patch not saved"),
                body: t(language, patchErrorKey(null))
            });
        }
        finally {
            setDownloadingMd5(null);
        }
    }, [downloadingMd5, language]);

    return {
        results,
        loading,
        error,
        needsSettings,
        downloadingMd5,
        downloadPatch
    };
}

function patchErrorKey(code: string | null | undefined): string {
    if (code === "exists") {
        return "There's already a file with that name in that folder.";
    }
    if (code === "bad_folder") {
        return "Couldn't save there. Pick another folder.";
    }
    if (code === "too_big") {
        return "That patch is bigger than expected, so it was left alone.";
    }
    if (code === "bad_link") {
        return "That patch link doesn't look right.";
    }
    return "Couldn't download that patch.";
}
