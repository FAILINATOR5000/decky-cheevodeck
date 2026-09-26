import { getSavedCommentKeys, saveComment, unsaveComment } from "../../api";
import { t, type LanguageCode } from "../../locales";
import type { NotificationNav } from "../../notifications/registry";
import type { AotwComment, GameComment, SaveCommentResponse, SettingsResponse } from "../../types";
import { logError } from "../../utils/errors";
import { showManagedModal } from "../../utils/modalRegistry";
import { openExternalUrl } from "../../utils/navigation";
import { armNoteFocusReturn } from "../../utils/noteFocusReturn";
import type { PanelEntry } from "../../utils/pendingPanelEntry";
import { openPanelOn, quickAccessIsHidden } from "../../utils/quickAccess";
import { buildSaveCommentPayload, matchKeyForComment, type SavedCommentSourceInput } from "../../utils/savedComments";
import { CommentViewModal, type CommentSaveControl } from "../comments/CommentViewModal";
import { TextViewerModal } from "../ui/TextViewerModal";
import { NotificationsMultipathModal, type MultipathOption } from "./NotificationsMultipathModal";

function landLater(entry: PanelEntry) {
    window.setTimeout(() => {
        if (quickAccessIsHidden()) {
            openPanelOn(entry);
        }
    }, 0);
}

async function commentSaveControl(
    comment: AotwComment | GameComment,
    source: SavedCommentSourceInput
): Promise<CommentSaveControl | undefined> {
    const matchKey = matchKeyForComment(comment, source);
    if (!matchKey) {
        return undefined;
    }
    let savedId: string | null = null;
    try {
        const result = await getSavedCommentKeys();
        savedId = (result?.keys ?? []).find((entry) => entry?.matchKey === matchKey)?.id ?? null;
    } catch (e) {
        logError("standalone comment: couldn't read saved comment keys", e);
    }
    const payload = buildSaveCommentPayload(comment, source);
    return {
        saved: savedId !== null,
        onSave: async (): Promise<SaveCommentResponse> => {
            try {
                return await saveComment(payload);
            } catch (e) {
                logError("standalone comment: couldn't save", e);
                return { ok: false, error: "ipc_failed" };
            }
        },
        onUnsave: async (id?: string) => {
            const target = id ?? savedId;
            if (!target) {
                return false;
            }
            try {
                const result = await unsaveComment(target);
                return Boolean(result?.ok) || result?.error === "not_found";
            } catch (e) {
                logError("standalone comment: couldn't unsave", e);
                return false;
            }
        }
    };
}

async function openComment(
    comment: AotwComment | GameComment,
    externalUrl: string | null,
    source: SavedCommentSourceInput | undefined,
    language: LanguageCode,
    settings: SettingsResponse
) {
    const saveControl = source ? await commentSaveControl(comment, source) : undefined;
    const onOpenExternal = externalUrl
        ? async () => {
            const opened = await openExternalUrl(externalUrl);
            if (!opened) {
                landLater({ kind: "profile", username: comment.user, ulid: comment.ulid || null });
            }
        }
        : undefined;
    showManagedModal((close) => (
        <CommentViewModal
            comment={comment}
            language={language}
            close={close}
            onOpenExternal={onOpenExternal}
            saveControl={saveControl}
            controllerGlyphStyle={settings.controllerGlyphStyle}
            mouseKeyboardMode={settings.mouseKeyboardMode}
        />
    ));
}

function openText(title: string, body: string, language: LanguageCode, settings: SettingsResponse) {
    showManagedModal((close) => (
        <TextViewerModal
            language={language}
            mouseKeyboardMode={settings.mouseKeyboardMode}
            title={title}
            text={body}
            close={close}
        />
    ));
}

export function buildStandaloneNotificationNav(language: LanguageCode, settings: SettingsResponse): NotificationNav {
    const openProfile = (username: string, ulid: string | null) => {
        const trimmed = String(username || "").trim();
        if (trimmed) {
            landLater({ kind: "profile", username: trimmed, ulid });
        }
    };

    const nav: NotificationNav = {
        openGameNotes: (gameId, noteId) => {
            if (noteId) {
                armNoteFocusReturn(gameId, noteId, settings.activeUlid);
            }
            landLater({ kind: "gameNotes", gameId });
        },
        openGameOverview: (gameId, viewedUsername, viewedUserRef) => {
            landLater({ kind: "game", gameId, viewedUsername: viewedUsername ?? null, viewedUserRef: viewedUserRef ?? null });
        },
        openAchievementOverview: (gameId, achievementId, viewedUsername, viewedUserRef) => {
            landLater({
                kind: "achievement",
                gameId,
                achievementId,
                viewedUsername: viewedUsername ?? null,
                viewedUserRef: viewedUserRef ?? null
            });
        },
        openTrackedSet: (setId) => {
            landLater({ kind: "trackedSet", setId });
        },
        openCheevoCheck: () => {
            landLater({ kind: "cheevoCheck" });
        },
        openFileWatcher: () => {
            landLater({ kind: "fileWatcher" });
        },
        openMemoriesTransfer: () => {
            landLater({ kind: "memoriesTransfer" });
        },
        openAbout: () => {
            landLater({ kind: "about" });
        },
        openMessage: (body) => {
            openText(t(language, "Message from FAILINATOR5000"), body, language, settings);
        },
        openChangelog: (body) => {
            openText(t(language, "What's New in CheevoDeck"), body, language, settings);
        },
        openExternalUrl: (url) => {
            void openExternalUrl(url);
        },
        openMultipath: (ctx) => {
            const options: MultipathOption[] = [];
            if (ctx.kind === "bucketA") {
                if (ctx.achievementId != null) {
                    const achievementId = ctx.achievementId;
                    options.push({
                        label: t(language, "View Achievement Info"),
                        icon: { kind: "badge", gameId: ctx.gameId, badgeName: ctx.badgeName ?? "" },
                        onSelect: () => nav.openAchievementOverview?.(ctx.gameId, achievementId, ctx.username, ctx.ulid)
                    });
                }
                options.push({
                    label: t(language, "View Game Info"),
                    icon: { kind: "game", gameId: ctx.gameId, imageIcon: ctx.gameImageIcon ?? null },
                    onSelect: () => nav.openGameOverview?.(ctx.gameId, ctx.username, ctx.ulid)
                });
            }
            else {
                options.push({
                    label: t(language, "View/Post"),
                    icon: { kind: "avatar", username: ctx.username },
                    onSelect: () => {
                        if (ctx.comment) {
                            void openComment(ctx.comment, ctx.externalUrl, ctx.commentSource, language, settings);
                        }
                        else if (ctx.externalUrl) {
                            void openExternalUrl(ctx.externalUrl);
                        }
                    }
                });
            }
            options.push({
                label: t(language, "View User Profile"),
                icon: { kind: "avatar", username: ctx.username },
                onSelect: () => openProfile(ctx.username, ctx.ulid ?? null)
            });

            showManagedModal((close) => (
                <NotificationsMultipathModal
                    options={options}
                    showIcons={settings.showIcons}
                    language={language}
                    close={close}
                />
            ));
        }
    };
    return nav;
}
