import { FileSelectionType, openFilePicker, toaster } from "@decky/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ButtonSpacing, UpdateStatusResponse } from "../types";
import { t, type LanguageCode } from "../locales";
import { checkForUpdateNow, downloadUpdateZip, getPluginVersion, getUpdateStatus } from "../api";
import { copyTextToClipboard } from "../utils/clipboard";
import { openExternalUrl } from "../utils/navigation";
import { logError } from "../utils/errors";

const GITHUB_OWNER = "FAILINATOR5000";
const GITHUB_REPO = "decky-cheevodeck";
const GITHUB_REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
const KOFI_URL = "https://ko-fi.com/failinator5000";
const RA_PATREON_URL = "https://www.patreon.com/retroachievements";
const GITHUB_ATTRIBUTIONS_URL = `${GITHUB_REPO_URL}/blob/main/ATTRIBUTIONS.md`;

export type AboutUpdateNotice =
    | ""
    | "upToDate"
    | "unreachable"
    | "copied"
    | "copyFailed"
    | "updateFound"
    | "stillNewest";

const DEFAULT_SAVE_DIR = "/home/deck/Downloads";

type UseAboutControllerArgs = {
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    focusScopeResetToken: number;
    onBack: () => void | Promise<void>;
};

export function useAboutController({
    language,
    buttonSpacing,
    focusScopeResetToken,
    onBack
}: UseAboutControllerArgs) {
    const [version, setVersion] = useState("");

    const [updateStatus, setUpdateStatus] = useState<UpdateStatusResponse | null>(null);
    const [checkingForUpdate, setCheckingForUpdate] = useState(false);
    const [updateNotice, setUpdateNotice] = useState<AboutUpdateNotice>("");

    const [downloadingZip, setDownloadingZip] = useState(false);

    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        getPluginVersion()
            .then((res) => {
                if (cancelled) {
                    return;
                }
                setVersion(String(res?.version || "").trim());
            })
            .catch((err) => {
                logError("get plugin version", err);
            });

        getUpdateStatus()
            .then((res) => {
                if (cancelled || !res) {
                    return;
                }
                setUpdateStatus(res);
            })
            .catch((err) => {
                logError("get update status", err);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const onCheckNow = useCallback(() => {
        if (checkingForUpdate) {
            return;
        }
        setCheckingForUpdate(true);
        setUpdateNotice("");

        void (async () => {
            try {
                const res = await checkForUpdateNow();
                if (!mountedRef.current) {
                    return;
                }
                if (!res) {
                    setUpdateNotice("unreachable");
                    return;
                }
                const previous = updateStatus?.latestVersion ?? "";
                setUpdateStatus(res);
                if (res.error) {
                    setUpdateNotice("unreachable");
                }
                else if (!res.updateAvailable) {
                    setUpdateNotice("upToDate");
                }
                else {
                    setUpdateNotice(res.latestVersion !== previous ? "updateFound" : "stillNewest");
                }
            }
            catch (err) {
                logError("check for update", err);
                if (mountedRef.current) {
                    setUpdateNotice("unreachable");
                }
            }
            finally {
                if (mountedRef.current) {
                    setCheckingForUpdate(false);
                }
            }
        })();
    }, [checkingForUpdate, updateStatus]);

    const installUrl = updateStatus?.installUrl ?? "";

    const onCopyInstallLink = useCallback((from: Element | null) => {
        if (!installUrl) {
            return;
        }
        setUpdateNotice(copyTextToClipboard(installUrl, from) ? "copied" : "copyFailed");
    }, [installUrl]);

    const onDownloadZip = useCallback(() => {
        if (downloadingZip) {
            return;
        }

        void (async () => {
            let folder: string | undefined;
            try {
                const picked = await openFilePicker(
                    FileSelectionType.FOLDER,
                    DEFAULT_SAVE_DIR,
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

            setDownloadingZip(true);
            setUpdateNotice("");
            try {
                const saved = await downloadUpdateZip(folder);
                toaster.toast(saved?.ok
                    ? { title: t(language, "Update saved"), body: saved.name ?? "" }
                    : { title: t(language, "Update not saved"), body: t(language, downloadErrorKey(saved?.error)) });
            }
            catch (err) {
                logError("download update zip", err);
                toaster.toast({
                    title: t(language, "Update not saved"),
                    body: t(language, downloadErrorKey(null))
                });
            }
            finally {
                setDownloadingZip(false);
            }
        })();
    }, [downloadingZip, language]);

    const patchNotesUrl = updateStatus?.patchNotesUrl ?? "";

    const onViewPatchNotes = useCallback(() => {
        if (!patchNotesUrl) {
            return;
        }
        void openExternalUrl(patchNotesUrl);
    }, [patchNotesUrl]);

    const state = useMemo(() => ({
        language,
        buttonSpacing,
        focusScopeResetToken,
        version,
        updateAvailable: updateStatus?.updateAvailable ?? false,
        latestVersion: updateStatus?.latestVersion ?? "",
        installUrl,
        patchNotesUrl,
        checkingForUpdate,
        downloadingZip,
        updateNotice,
        attributionsUrl: GITHUB_ATTRIBUTIONS_URL
    }), [
        buttonSpacing,
        checkingForUpdate,
        downloadingZip,
        focusScopeResetToken,
        installUrl,
        language,
        patchNotesUrl,
        updateNotice,
        updateStatus,
        version
    ]);

    const actions = useMemo(() => ({
        onBack,
        onOpenGithub: () => {
            void openExternalUrl(GITHUB_REPO_URL);
        },
        onOpenKofi: () => {
            void openExternalUrl(KOFI_URL);
        },
        onOpenRaPatreon: () => {
            void openExternalUrl(RA_PATREON_URL);
        },
        onCheckNow,
        onCopyInstallLink,
        onDownloadZip,
        onViewPatchNotes
    }), [onBack, onCheckNow, onCopyInstallLink, onDownloadZip, onViewPatchNotes]);

    return {
        state,
        actions
    };
}

function downloadErrorKey(code: string | null | undefined): string {
    if (code === "bad_folder") {
        return "Couldn't save there. Pick another folder.";
    }
    if (code === "too_big") {
        return "That download is bigger than expected, so it was left alone.";
    }
    return "Couldn't download the update.";
}
