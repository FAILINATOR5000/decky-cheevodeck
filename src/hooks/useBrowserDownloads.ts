import { useEffect, useRef, useState } from "react";
import {
    cancelBrowserDownload,
    deleteBrowserDownloadFile,
    getBrowserDownloads,
    pauseBrowserDownload,
    removeBrowserDownload,
    restartBrowserDownload,
    resumeBrowserDownload
} from "../api";
import { subscribeDownloads } from "../components/browser/browserDownloads";
import { requestHeadersFor } from "../components/browser/browserSession";
import { logError } from "../utils/errors";
import type { BrowserDownload, BrowserDownloadsResponse } from "../types";

export type BrowserDownloads = {
    downloads: BrowserDownload[];
    loaded: boolean;
    notice: { id: string; text: string } | null;
    cancel: (downloadId: string) => void;
    pause: (downloadId: string) => void;
    resume: (downloadId: string) => void;
    restart: (downloadId: string) => void;
    remove: (downloadId: string) => void;
    deleteFile: (downloadId: string) => void;
};

const UNAVAILABLE = "The file's folder isn't available right now.";

export function useBrowserDownloads(isActive: boolean): BrowserDownloads {
    const [downloads, setDownloads] = useState<BrowserDownload[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
    const activeRef = useRef(isActive);
    activeRef.current = isActive;

    const knownRef = useRef(new Set<string>());

    const queuedRef = useRef(new Set<string>());

    const pausingRef = useRef(new Set<string>());

    const asShown = (row: BrowserDownload): BrowserDownload => {
        if (!pausingRef.current.has(row.id)) {
            return row;
        }
        if (row.state !== "downloading") {
            pausingRef.current.delete(row.id);
            return row;
        }
        return { ...row, state: "paused", action: "pausing" };
    };

    const requestRef = useRef(0);

    const take = (request: number, state: BrowserDownloadsResponse | null | undefined) => {
        if (request === requestRef.current && activeRef.current && Array.isArray(state?.downloads)) {
            queuedRef.current.clear();
            for (const row of state.downloads) {
                knownRef.current.add(row.id);
                if (row.state === "queued") {
                    queuedRef.current.add(row.id);
                }
            }
            setDownloads(state.downloads.map(asShown));
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
                if (!knownRef.current.has(progress.id) || queuedRef.current.has(progress.id)) {
                    knownRef.current.add(progress.id);
                    queuedRef.current.delete(progress.id);
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
        cancelBrowserDownload(downloadId)
            .then((answer) => {
                if (answer?.ok === false) {
                    reload();
                }
            })
            .catch((e) => logError("useBrowserDownloads.cancel", e));
    };

    const pause = (downloadId: string) => {
        setNotice(null);
        pausingRef.current.add(downloadId);
        setDownloads((current) => current.map(asShown));
        pauseBrowserDownload(downloadId)
            .then((answer) => {
                if (answer?.ok === false) {
                    pausingRef.current.delete(downloadId);
                    reload();
                }
            })
            .catch((e) => {
                logError("useBrowserDownloads.pause", e);
                pausingRef.current.delete(downloadId);
                reload();
            });
    };

    const runAgain = (downloadId: string, restart: boolean) => {
        setNotice(null);
        const row = downloads.find((entry) => entry.id === downloadId);
        if (!row?.url && !row?.origin) {
            return;
        }
        const request = ++requestRef.current;
        (async () => {
            try {
                const { cookie, userAgent } = await requestHeadersFor(row.origin || row.url);
                const second = row.origin && row.url && row.origin !== row.url ? (await requestHeadersFor(row.url)).cookie : "";
                const state = await (restart ? restartBrowserDownload : resumeBrowserDownload)(downloadId, cookie, userAgent, second);
                take(request, state);
                if (state?.ok === false && state.error === "unavailable") {
                    setNotice({ id: downloadId, text: UNAVAILABLE });
                }
            }
            catch (e) {
                logError(restart ? "useBrowserDownloads.restart" : "useBrowserDownloads.resume", e);
            }
        })();
    };

    const remove = (downloadId: string) => {
        setNotice(null);
        const request = ++requestRef.current;
        removeBrowserDownload(downloadId)
            .then((state) => {
                take(request, state);
                if (state?.ok === false && state.error === "unavailable") {
                    setNotice({ id: downloadId, text: UNAVAILABLE });
                }
            })
            .catch((e) => logError("useBrowserDownloads.remove", e));
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
                    setNotice({ id: downloadId, text: UNAVAILABLE });
                }
            })
            .catch((e) => logError("useBrowserDownloads.deleteFile", e));
    };

    return {
        downloads,
        loaded,
        notice,
        cancel,
        pause,
        resume: (downloadId: string) => runAgain(downloadId, false),
        restart: (downloadId: string) => runAgain(downloadId, true),
        remove,
        deleteFile
    };
}
