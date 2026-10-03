import { useEffect, useRef, useState } from "react";
import { cancelBrowserDownload, deleteBrowserDownloadFile, getBrowserDownloads, removeBrowserDownload } from "../api";
import { subscribeDownloads } from "../components/browser/browserDownloads";
import { logError } from "../utils/errors";
import type { BrowserDownload, BrowserDownloadsResponse } from "../types";

export type BrowserDownloads = {
    downloads: BrowserDownload[];
    loaded: boolean;
    notice: { id: string; text: string } | null;
    cancel: (downloadId: string) => void;
    remove: (downloadId: string) => void;
    deleteFile: (downloadId: string) => void;
};

export function useBrowserDownloads(isActive: boolean): BrowserDownloads {
    const [downloads, setDownloads] = useState<BrowserDownload[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
    const activeRef = useRef(isActive);
    activeRef.current = isActive;

    const knownRef = useRef(new Set<string>());

    const requestRef = useRef(0);

    const take = (request: number, state: BrowserDownloadsResponse | null | undefined) => {
        if (request === requestRef.current && activeRef.current && Array.isArray(state?.downloads)) {
            for (const row of state.downloads) {
                knownRef.current.add(row.id);
            }
            setDownloads(state.downloads);
            setLoaded(true);
        }
    };

    const reload = () => {
        const request = ++requestRef.current;
        getBrowserDownloads().then((state) => take(request, state)).catch((e) => logError("useBrowserDownloads.reload", e));
    };

    useEffect(() => {
        if (!isActive) {
            return;
        }
        reload();
        return subscribeDownloads(
            (progress) => {
                if (!progress?.id) {
                    return;
                }
                if (!knownRef.current.has(progress.id)) {
                    knownRef.current.add(progress.id);
                    reload();
                    return;
                }
                setDownloads((current) => current.map((row) => (
                    row.id === progress.id && row.state === "downloading"
                        ? { ...row, received: Number(progress.received) || 0, total: Number(progress.total ?? -1) }
                        : row
                )));
            },
            () => reload()
        );
    }, [isActive]);

    const cancel = (downloadId: string) => {
        setNotice(null);
        cancelBrowserDownload(downloadId).catch((e) => logError("useBrowserDownloads.cancel", e));
    };

    const remove = (downloadId: string) => {
        setNotice(null);
        const request = ++requestRef.current;
        removeBrowserDownload(downloadId).then((state) => take(request, state)).catch((e) => logError("useBrowserDownloads.remove", e));
    };

    const deleteFile = (downloadId: string) => {
        setNotice(null);
        const request = ++requestRef.current;
        deleteBrowserDownloadFile(downloadId)
            .then((state) => {
                take(request, state);
                if (state?.ok === false && state.error === "changed") {
                    setNotice({ id: downloadId, text: "The file has changed since it was downloaded, so it was left alone." });
                }
                else if (state?.ok === false && state.error === "unavailable") {
                    setNotice({ id: downloadId, text: "The file's folder isn't available right now." });
                }
            })
            .catch((e) => logError("useBrowserDownloads.deleteFile", e));
    };

    return { downloads, loaded, notice, cancel, remove, deleteFile };
}
