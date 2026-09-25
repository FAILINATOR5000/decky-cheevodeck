import { addEventListener, removeEventListener, toaster } from "@decky/api";
import { getCurrentLanguage, t } from "../../locales";

const BROWSER_DOWNLOAD_EVENT = "cheevodeck_browser_download";

type DownloadToast = "Downloading" | "Download Complete" | "Download Failed";

export function toastDownload(title: DownloadToast, name: string): void {
    toaster.toast({ title: t(getCurrentLanguage(), title), body: name });
}

const onDownloadFinished = (payload: { ok?: boolean; name?: string }) => {
    toastDownload(payload?.ok ? "Download Complete" : "Download Failed", String(payload?.name ?? ""));
};

export function registerBrowserDownloads(): void {
    addEventListener(BROWSER_DOWNLOAD_EVENT, onDownloadFinished);
}

export function unregisterBrowserDownloads(): void {
    removeEventListener(BROWSER_DOWNLOAD_EVENT, onDownloadFinished);
}
