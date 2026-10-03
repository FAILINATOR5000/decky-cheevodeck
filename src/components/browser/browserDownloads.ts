import { addEventListener, removeEventListener, toaster } from "@decky/api";
import { getCurrentLanguage, t } from "../../locales";

const BROWSER_DOWNLOAD_EVENT = "cheevodeck_browser_download";
const BROWSER_DOWNLOAD_PROGRESS_EVENT = "cheevodeck_browser_download_progress";

type DownloadToast = "Downloading" | "Download Complete" | "Download Failed";

export type DownloadFinished = { id?: string; ok?: boolean; name?: string; error?: string };

export type DownloadProgress = { id?: string; received?: number; total?: number };

const FAILURES: Record<string, string> = {
    refused: "The site refused the download.",
    failed: "The download didn't finish.",
    bad_link: "This link can't be downloaded.",
    bad_folder: "Downloads can't go there.",
    too_big: "The file is too large.",
    no_space: "Not enough free space.",
    write_failed: "The file couldn't be saved.",
    web_page: "Got a web page, not the file.",
    stalled: "The download stalled.",
    busy: "Two downloads already running.",
    unsupported: "The browser can't save this."
};

export function downloadFailure(code: string): string {
    const key = FAILURES[code];
    return key ? t(getCurrentLanguage(), key) : "";
}

export function toastDownload(title: DownloadToast, name: string, code = ""): void {
    toaster.toast({ title: t(getCurrentLanguage(), title), body: downloadFailure(code) || name });
}

const onDownloadFinished = (payload: DownloadFinished) => {
    if (payload?.error === "canceled") {
        return;
    }
    toastDownload(payload?.ok ? "Download Complete" : "Download Failed", String(payload?.name ?? ""), payload?.ok ? "" : String(payload?.error ?? ""));
};

export function registerBrowserDownloads(): void {
    addEventListener(BROWSER_DOWNLOAD_EVENT, onDownloadFinished);
}

export function unregisterBrowserDownloads(): void {
    removeEventListener(BROWSER_DOWNLOAD_EVENT, onDownloadFinished);
}

export function subscribeDownloads(onProgress: (progress: DownloadProgress) => void, onFinished: (finished: DownloadFinished) => void): () => void {
    addEventListener(BROWSER_DOWNLOAD_PROGRESS_EVENT, onProgress);
    addEventListener(BROWSER_DOWNLOAD_EVENT, onFinished);
    return () => {
        removeEventListener(BROWSER_DOWNLOAD_PROGRESS_EVENT, onProgress);
        removeEventListener(BROWSER_DOWNLOAD_EVENT, onFinished);
    };
}
