import React, { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DialogButton, Focusable } from "@decky/ui";
import { FaTrophy } from "react-icons/fa";

import { DEVELOPER_AVATAR_IMAGE } from "../ui/developerAvatar";
import {
    cacheAchievementIcons,
    getAchievementIcons,
    getCachedAchievementIcons,
    getCachedGameIconDataUri,
    getGameIconCached,
    isGameIconBatchPending,
    subscribeToAchievementIcon,
    subscribeToGameIcon
} from "../../api";
import { ErrorText } from "../ui/ErrorText";
import { FadeImage } from "../ui/FadeImage";
import { FocusableItem } from "../ui/FocusableItem";
import { UserAvatar } from "../ui/UserAvatar";
import { SetMosaicSquare, type SetMosaicEntry } from "../mastery/SetMosaicBanner";
import { NOTIFICATION_REGISTRY, type NotificationNav } from "../../notifications/registry";
import { formatUnlockDate, noteBodyColor } from "../../utils/achievements";
import { localizeRuntimeText, t, type LanguageCode } from "../../locales";
import type { CheevoNotification, NoteColor, ScaleStep } from "../../types";
import { logError } from "../../utils/errors";
import { BUTTON_SECONDARY } from "../../utils/gamepadButtons";
import { playToggleSound } from "../../utils/navSound";
import { smallTextStyle, achievementGreen, warnAmber, skyBlue } from "../../utils/style";
import { modalSize, getCurrentModalScale, getDeviceIsSteamMachine, getCurrentLargeViewportBonusEnabled, getCurrentLargeViewportBonus } from "../../utils/scale";
import type { CardChrome } from "../../utils/cardChrome";

const ICON_APPLY_PER_FRAME = 4;
const iconApplyQueue: Array<() => void> = [];
let iconApplyRafId: number | null = null;

function notificationBodyClampLines(step: ScaleStep): number {
    switch (step) {
        case "large":
            return 13;
        case "xlarge":
            return 10;
        case "xxlarge":
            return 8;
        case "xxxlarge":
            return 7;
        default:
            return 12;
    }
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function TrashIcon({ size = 15 }: { size?: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 448 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M170.5 51.6L151.5 80l145 0-19-28.4c-1.5-2.2-4-3.6-6.7-3.6l-93.7 0c-2.7 0-5.2 1.3-6.7 3.6zm147-26.6L354.2 80 368 80l48 0 8 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-8 0 0 304c0 44.2-35.8 80-80 80l-224 0c-44.2 0-80-35.8-80-80l0-304-8 0c-13.3 0-24-10.7-24-24s10.7-24 24-24l8 0 48 0 13.8 0 36.7-55c10.4-15.6 27.9-25 46.7-25l93.7 0c18.7 0 36.2 9.4 46.7 25zM80 128l0 304c0 17.7 14.3 32 32 32l224 0c17.7 0 32-14.3 32-32l0-304L80 128zm80 64l0 208c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-208c0-8.8 7.2-16 16-16s16 7.2 16 16zm80 0l0 208c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-208c0-8.8 7.2-16 16-16s16 7.2 16 16zm80 0l0 208c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-208c0-8.8 7.2-16 16-16s16 7.2 16 16z" />
        </svg>
    );
}

function flushIconApplyQueue() {
    iconApplyRafId = null;
    let budget = ICON_APPLY_PER_FRAME;
    while (budget > 0 && iconApplyQueue.length > 0) {
        const apply = iconApplyQueue.shift();
        apply?.();
        budget -= 1;
    }
    if (iconApplyQueue.length > 0) {
        iconApplyRafId = window.requestAnimationFrame(flushIconApplyQueue);
    }
}

function scheduleIconApply(apply: () => void) {
    iconApplyQueue.push(apply);
    if (iconApplyRafId === null) {
        iconApplyRafId = window.requestAnimationFrame(flushIconApplyQueue);
    }
}

export function notificationCardMetrics() {
    return {
        iconSize: modalSize(44),
        iconGap: modalSize(7),
        rowPaddingY: modalSize(2),
        contentGap: modalSize(3),
        titleFontSize: modalSize(15.5),
        titleLineHeight: 1.2,
        bodyFontSize: modalSize(11.5),
        bodyLineHeight: 1.31,
        pointsFontSize: modalSize(11),
        pointsLineHeight: 1.12
    };
}

export type NotificationCardListProps = {
    onMenuButton?: () => void;
    metrics: ReturnType<typeof notificationCardMetrics>;
    chrome: CardChrome;
    seenAtSnapshot: number;
    showIcons: boolean;
    language: LanguageCode;
    nav: NotificationNav;
    coldGameIds: Set<number>;
    archiveMode: "star" | "trash" | "none";
    onArchiveToggle: (notification: CheevoNotification) => void;
    onArchiveRemove: (id: string) => void;
    onRowFocus: (index: number) => void;
    onTabButtons?: (evt: { detail?: { button?: number } }) => void;
    tabLegend?: Record<number, React.ReactNode>;
    close: () => void;
};

type NotificationCardProps = {
    notification: CheevoNotification;
    index: number;
    list: NotificationCardListProps;
    archived: boolean;
    archiveError: string | null;
};

function metaString(notification: CheevoNotification, key: string): string {
    const value = notification.meta?.[key];
    return typeof value === "string" ? value : "";
}

function metaNumber(notification: CheevoNotification, key: string): number {
    const value = notification.meta?.[key];
    return typeof value === "number" ? value : 0;
}

function isCheevoCheckScan(notification: CheevoNotification): boolean {
    return notification.type === "system" && notification.target?.view === "cheevoCheck";
}

function isFileWatcherPass(notification: CheevoNotification): boolean {
    return notification.type === "system" && notification.target?.view === "fileWatcher";
}

function isChangelogRow(notification: CheevoNotification): boolean {
    return notification.type === "system" && notification.target?.view === "changelog";
}

function isDeveloperMessage(notification: CheevoNotification): boolean {
    return notification.type === "system" && notification.target?.view === "message";
}

function cheevoCheckAbortKey(reason: string): string {
    if (reason === "root_gone") {
        return "The scan stopped: that folder went away. Check the drive or share is still connected.";
    }
    if (reason === "fetch_failed") {
        return "The scan stopped: we couldn't reach RetroAchievements. Your previous results are unchanged.";
    }
    if (reason === "no_data") {
        return "There's no saved RetroAchievements data to check against yet. Run a Scan first.";
    }
    if (reason === "no_hasher") {
        return "The hashing tool is missing from this install. Reinstalling CheevoDeck should fix it.";
    }
    return "The scan stopped before it finished. Your previous results are unchanged.";
}

function cheevoCheckScanBody(notification: CheevoNotification, language: LanguageCode): ReactNode {
    const buckets: Array<[string, string]> = [
        ["unsupported", "{{count}} unsupported files"],
        ["noAchievements", "{{count}} files with no achievements"],
        ["failed", "{{count}} files that couldn't be scanned"],
        ["supported", "{{count}} supported games"]
    ];
    const verified = notification.meta?.verify === "done";
    const verifyBuckets: Array<[string, string]> = [
        ["verified", "{{count}} files match a known good dump"],
        ["raFull", "{{count}} files RetroAchievements checked in full"],
        ["raPartial", "{{count}} files RetroAchievements only part-checked"],
        ["mismatch", "{{count}} files don't match the name they carry"],
        ["unrecognised", "{{count}} files nothing has a record of"],
        ["unverifiable", "{{count}} files we couldn't verify either way"]
    ];
    return (
        <>
            {t(language, verified
                ? "Cheevo Check finished checking your files against RA and the dump lists:"
                : "Cheevo Check finished checking your files against RA:")}
            <div style={{ marginTop: "4px" }}>
                {buckets.map(([metaKey, textKey]) => (
                    <div key={metaKey} style={{ display: "flex", gap: "6px" }}>
                        <span>•</span>
                        <span>{t(language, textKey, { count: metaNumber(notification, metaKey) })}</span>
                    </div>
                ))}
                {
}
                {verified && verifyBuckets.map(([metaKey, textKey]) => (
                    <div key={metaKey} style={{ display: "flex", gap: "6px" }}>
                        <span>•</span>
                        <span>{t(language, textKey, { count: metaNumber(notification, metaKey) })}</span>
                    </div>
                ))}
            </div>
        </>
    );
}

function fileWatcherPassBody(notification: CheevoNotification, language: LanguageCode): ReactNode {
    const buckets: Array<[string, string]> = [
        ["corrupted", "{{count}} files may be corrupted"],
        ["unreadable", "{{count}} files couldn't be read"],
        ["replaced", "{{count}} files were replaced"],
        ["missing", "{{count}} files have gone missing"],
        ["skipped", "{{count}} directories couldn't be reached"],
        ["added", "{{count}} new files recorded"],
        ["verified", "{{count}} files verified"]
    ];
    return (
        <>
            {t(language, "File Watcher completed with the following results:")}
            <div style={{ marginTop: "4px" }}>
                {buckets.map(([metaKey, textKey]) => (
                    <div key={metaKey} style={{ display: "flex", gap: "6px" }}>
                        <span>•</span>
                        <span>{t(language, textKey, { count: metaNumber(notification, metaKey) })}</span>
                    </div>
                ))}
            </div>
        </>
    );
}

function metaMosaicEntries(notification: CheevoNotification): SetMosaicEntry[] {
    const raw = notification.meta?.mosaicEntries;
    if (!Array.isArray(raw)) {
        return [];
    }
    const out: SetMosaicEntry[] = [];
    for (const item of raw) {
        const gameId = (item as { gameId?: unknown })?.gameId;
        if (typeof gameId !== "number") {
            continue;
        }
        const imageIcon = (item as { imageIcon?: unknown })?.imageIcon;
        out.push({
            gameId,
            imageIcon: typeof imageIcon === "string" ? imageIcon : null
        });
    }
    return out;
}

function templateParts(
    language: LanguageCode,
    templateKey: string,
    parts: Record<string, ReactNode>
): ReactNode[] {
    const tokens: Record<string, string> = {};
    for (const key of Object.keys(parts)) {
        tokens[key] = `__NOTIF_${key.toUpperCase()}__`;
    }
    const text = t(language, templateKey, tokens);
    const pattern = /(__NOTIF_[A-Z0-9_]+__)/g;
    return text.split(pattern).map((piece, index) => {
        const match = Object.entries(tokens).find(([, token]) => token === piece);
        if (!match) {
            return piece;
        }
        return <Fragment key={`${piece}:${index}`}>{parts[match[0]]}</Fragment>;
    });
}

function achievementSpan(title: string): ReactNode {
    return <span style={{ color: achievementGreen, fontWeight: 800 }}>{title}</span>;
}

function gameSpan(title: string): ReactNode {
    return <span style={{ color: skyBlue, fontWeight: 800 }}>{title}</span>;
}

function usernameSpan(name: string): ReactNode {
    return <span style={{ fontWeight: 800 }}>{name}</span>;
}

function commentTitle(notification: CheevoNotification, language: LanguageCode): ReactNode {
    const bulk = notification.meta?.bulk === true;
    const poster = metaString(notification, "username");
    const threadTitle = metaString(notification, "threadTitle");
    if (notification.type === "wall") {
        return bulk
            ? t(language, "Multiple Posts")
            : t(language, "{{user}} Commented on your wall.", { user: poster });
    }
    if (bulk) {
        return t(language, "Multiple Comments - {{title}}", { title: threadTitle });
    }
    const threadSpan = metaString(notification, "kind") === "achievement"
        ? achievementSpan(threadTitle)
        : gameSpan(threadTitle);
    return templateParts(language, "{{user}} posted in {{title}}", {
        user: poster,
        title: threadSpan
    });
}

function commentBulkBody(notification: CheevoNotification, language: LanguageCode): string {
    const rawCount = notification.meta?.count;
    const count = typeof rawCount === "number" ? rawCount : 0;
    return notification.type === "wall"
        ? t(language, "{{count}} new wall posts", { count })
        : t(language, "{{count}} new comments", { count });
}

export const NotificationCard = React.memo(function NotificationCard(props: NotificationCardProps) {
    const { notification, archived: archivedProp, archiveError, list } = props;
    const { seenAtSnapshot, showIcons, language, nav, coldGameIds, archiveMode, close } = list;
    const [archiveFocused, setArchiveFocused] = useState(false);
    const [trashArmed, setTrashArmed] = useState(false);
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const [bodyTruncated, setBodyTruncated] = useState(false);
    const metrics = list.metrics;

    const largeViewportBonus = getDeviceIsSteamMachine() && getCurrentLargeViewportBonusEnabled()
        ? getCurrentLargeViewportBonus()
        : 0;
    const bodyLineClamp = notificationBodyClampLines(getCurrentModalScale()) + largeViewportBonus;

    const isGameSource = notification.iconSource === "game";
    const gameId = notification.iconGameId;

    const [gameIconDataUri, setGameIconDataUri] = useState<string | null>(() => {
        return isGameSource ? getCachedGameIconDataUri(gameId) : null;
    });

    useEffect(() => {
        if (!isGameSource || gameId == null) {
            return;
        }
        const cached = getCachedGameIconDataUri(gameId);
        if (cached) {
            setGameIconDataUri(cached);
            return;
        }
        let cancelled = false;
        let backupTimer: ReturnType<typeof setTimeout> | null = null;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        const url = notification.iconImageIcon ?? null;

        async function fetchOnce() {
            try {
                const result = await getGameIconCached(gameId, url);
                if (cancelled) {
                    return null;
                }
                if (result?.dataUri) {
                    setGameIconDataUri(result.dataUri);
                    return result.dataUri;
                }
                return null;
            }
            catch (e) {
                logError("getGameIconCached (notification card)", e);
                return null;
            }
        }

        const unsubscribe = subscribeToGameIcon(gameId, (dataUri) => {
            if (cancelled) {
                return;
            }
            if (dataUri) {
                scheduleIconApply(() => {
                    if (cancelled) {
                        return;
                    }
                    setGameIconDataUri(dataUri);
                });
                return;
            }
            void (async () => {
                const got = await fetchOnce();
                if (got || cancelled || !url) {
                    return;
                }
                retryTimer = setTimeout(() => {
                    retryTimer = null;
                    void fetchOnce();
                }, 1500);
            })();
        });

        backupTimer = setTimeout(() => {
            backupTimer = null;
            if (cancelled) {
                return;
            }
            const warmed = getCachedGameIconDataUri(gameId);
            if (warmed) {
                setGameIconDataUri(warmed);
                return;
            }
            if (isGameIconBatchPending(gameId)) {
                return;
            }
            void (async () => {
                const first = await fetchOnce();
                if (first || cancelled || !url) {
                    return;
                }
                retryTimer = setTimeout(() => {
                    retryTimer = null;
                    void fetchOnce();
                }, 1500);
            })();
        }, 500);

        return () => {
            cancelled = true;
            unsubscribe();
            if (backupTimer !== null) {
                clearTimeout(backupTimer);
            }
            if (retryTimer !== null) {
                clearTimeout(retryTimer);
            }
        };
    }, [isGameSource, gameId, notification.iconImageIcon]);

    const isAchievementSource = notification.iconSource === "achievement";
    const badgeName = metaString(notification, "badgeName");
    const [badgeDataUri, setBadgeDataUri] = useState<string | null>(() => {
        if (!isAchievementSource || gameId == null || !badgeName) {
            return null;
        }
        return getCachedAchievementIcons(gameId, [badgeName])[badgeName] ?? null;
    });
    const badgeWasWarmAtMount = useRef(badgeDataUri !== null);

    useEffect(() => {
        if (!isAchievementSource || gameId == null || !badgeName || badgeDataUri) {
            return;
        }
        let cancelled = false;

        const unsubscribe = subscribeToAchievementIcon(gameId, badgeName, (dataUri) => {
            if (cancelled || !dataUri) {
                return;
            }
            scheduleIconApply(() => {
                if (cancelled) {
                    return;
                }
                setBadgeDataUri(dataUri);
            });
        });

        const backupTimer = setTimeout(() => {
            if (cancelled) {
                return;
            }
            const warmed = getCachedAchievementIcons(gameId, [badgeName])[badgeName];
            if (warmed) {
                setBadgeDataUri(warmed);
                return;
            }
            void (async () => {
                try {
                    const result = await getAchievementIcons(gameId, [badgeName]);
                    if (cancelled) {
                        return;
                    }
                    const dataUri = result?.icons?.[badgeName] ?? "";
                    if (dataUri) {
                        cacheAchievementIcons(gameId, { [badgeName]: dataUri });
                        setBadgeDataUri(dataUri);
                    }
                }
                catch (e) {
                    logError("getAchievementIcons (notification card)", e);
                }
            })();
        }, 500);

        return () => {
            cancelled = true;
            unsubscribe();
            clearTimeout(backupTimer);
        };
    }, [isAchievementSource, gameId, badgeName, badgeDataUri]);

    const isUnseen = notification.createdAt > seenAtSnapshot;
    const fallbackLetter = (notification.title.trim().charAt(0) || "?").toUpperCase();
    const createdLabel = formatUnlockDate(new Date(notification.createdAt * 1000).toISOString(), {}, language);

    const bodyColor = noteBodyColor(metaString(notification, "color") as NoteColor);

    const achievementTitle = metaString(notification, "achievementTitle");
    const gameTitle = metaString(notification, "gameTitle");
    const templatedBody: ReactNode | null =
        notification.type === "tracked" && achievementTitle
            ? templateParts(language, "Unlocked {{achievement}} in {{game}}", {
                  achievement: achievementSpan(achievementTitle),
                  game: gameSpan(gameTitle)
              })
            : (notification.type === "social" || notification.type === "nearYou") && achievementTitle
                ? templateParts(language, "{{username}} Unlocked {{achievement}} in {{game}}", {
                      username: usernameSpan(metaString(notification, "username")),
                      achievement: achievementSpan(achievementTitle),
                      game: gameSpan(gameTitle)
                  })
                : (notification.type === "commentTracker" || notification.type === "wall") && notification.meta?.bulk === true
                    ? commentBulkBody(notification, language)
                    : notification.type === "trackedSet"
                        ? t(language, "Congratulations, you completed your {{name}} goal", {
                              name: metaString(notification, "setName")
                          })
                        : isCheevoCheckScan(notification)
                            ? (metaString(notification, "scan") === "stopped"
                                ? t(language, cheevoCheckAbortKey(metaString(notification, "reason")))
                                : cheevoCheckScanBody(notification, language))
                            : isFileWatcherPass(notification)
                                ? fileWatcherPassBody(notification, language)
                                : isChangelogRow(notification)
                                    ? null
                                    : isDeveloperMessage(notification)
                                        ? null
                                        : notification.type === "system"
                                            ? t(language, "Version {{version}} available.", {
                                                  version: metaString(notification, "version")
                                              })
                                            : null;

    const isClampedBody =
        ((notification.type === "commentTracker" || notification.type === "wall")
            && notification.meta?.bulk !== true)
        || isChangelogRow(notification)
        || isDeveloperMessage(notification);

    useLayoutEffect(() => {
        if (!isClampedBody) {
            setBodyTruncated(false);
            return;
        }
        const el = bodyRef.current;
        if (!el) {
            setBodyTruncated(false);
            return;
        }
        const measure = () => {
            const over = el.scrollHeight > el.clientHeight + 1;
            setBodyTruncated((prev) => (prev === over ? prev : over));
        };
        measure();
        let cancelled = false;
        let observer: ResizeObserver | null = null;
        if (typeof ResizeObserver !== "undefined") {
            observer = new ResizeObserver(() => measure());
            observer.observe(el);
        }
        const fonts = el.ownerDocument?.fonts;
        if (fonts?.ready) {
            fonts.ready.then(() => {
                if (!cancelled) {
                    measure();
                }
            }).catch(() => {});
        }
        return () => {
            cancelled = true;
            if (observer) {
                observer.disconnect();
            }
        };
    }, [isClampedBody, notification.body, bodyLineClamp]);

    const reminderLabel = metaString(notification, "reminderLabel");
    const localizedTitle =
        notification.type === "tracked"
            ? t(language, "Unlocked Tracked Achievement")
            : notification.type === "social"
                ? t(language, "Unlocked Achievement")
                : notification.type === "commentTracker" || notification.type === "wall"
                    ? commentTitle(notification, language)
                    : notification.type === "trackedSet"
                        ? t(language, "Mastery Goal: {{name}} Completed", { name: metaString(notification, "setName") })
                        : notification.type === "noteReminder"
                            ? (reminderLabel
                                ? t(language, "Reminder: {{label}}", { label: reminderLabel })
                                : t(language, "Reminder"))
                            : notification.type === "nearYou"
                                ? t(language, "Player Near You")
                                : isCheevoCheckScan(notification)
                                    ? t(language, "Cheevo Check")
                                    : isFileWatcherPass(notification)
                                        ? t(language, "File Watcher")
                                        : isChangelogRow(notification)
                                            ? t(language, "What's New in CheevoDeck")
                                            : isDeveloperMessage(notification)
                                                ? t(language, "Message from FAILINATOR5000")
                                                : notification.type === "system"
                                                ? t(language, "CheevoDeck Update Available")
                                                : notification.title;

    const statsLine =
        notification.type === "trackedSet"
            ? t(language, "{{awarded}}/{{possible}} Achievements", {
                  awarded: metaNumber(notification, "awarded"),
                  possible: metaNumber(notification, "possible")
              })
            : null;

    const iconBoxSize = metrics.iconSize;
    const iconFontSize = Math.max(16, iconBoxSize * 0.42);

    function handleClick() {
        if (notification.kind === "actionable") {
            const entry = NOTIFICATION_REGISTRY[notification.type];
            entry?.onClick?.(notification, nav);
        }
        close();
    }

    function renderBoxedIcon(content: ReactNode) {
        return (
            <div
                style={{
                    width: `${iconBoxSize}px`,
                    height: `${iconBoxSize}px`,
                    borderRadius: "7px",
                    overflow: "hidden",
                    flexShrink: 0,
                    background: "rgba(255,255,255,0.10)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: `${iconFontSize}px`,
                    fontWeight: 800
                }}
            >
                {content}
            </div>
        );
    }

    function renderIcon() {
        if (!showIcons) {
            return null;
        }

        if (notification.type === "debug") {
            const glyphSize = Math.round(iconBoxSize * 0.58);
            return renderBoxedIcon(
                <svg
                    width={glyphSize}
                    height={glyphSize}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.7}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <ellipse cx="12" cy="13.5" rx="5" ry="6.5" />
                    <line x1="12" y1="8" x2="12" y2="19" />
                    <circle cx="12" cy="5.5" r="2.3" />
                    <line x1="10.6" y1="3.9" x2="9" y2="2.2" />
                    <line x1="13.4" y1="3.9" x2="15" y2="2.2" />
                    <line x1="7.2" y1="10" x2="4" y2="8.5" />
                    <line x1="7" y1="13.5" x2="3.5" y2="13.5" />
                    <line x1="7.2" y1="17" x2="4" y2="18.5" />
                    <line x1="16.8" y1="10" x2="20" y2="8.5" />
                    <line x1="17" y1="13.5" x2="20.5" y2="13.5" />
                    <line x1="16.8" y1="17" x2="20" y2="18.5" />
                </svg>
            );
        }

        if (isDeveloperMessage(notification)) {
            return renderBoxedIcon(
                <img
                    src={DEVELOPER_AVATAR_IMAGE}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
            );
        }

        if (notification.type === "system") {
            return renderBoxedIcon(<FaTrophy size={Math.round(iconBoxSize * 0.5)} />);
        }

        if (notification.iconSource === "avatar") {
            return (
                <UserAvatar
                    username={metaString(notification, "username")}
                    size={iconBoxSize}
                    fontSize={iconFontSize}
                />
            );
        }

        if (notification.iconSource === "game") {
            return renderBoxedIcon(
                gameIconDataUri ? (
                    <FadeImage
                        src={gameIconDataUri}
                        fadeOnLoad={gameId != null && coldGameIds.has(gameId)}
                        decoding="async"
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                ) : (
                    fallbackLetter
                )
            );
        }

        if (notification.iconSource === "achievement") {
            return renderBoxedIcon(
                badgeDataUri ? (
                    <FadeImage
                        src={badgeDataUri}
                        fadeOnLoad={!badgeWasWarmAtMount.current}
                        decoding="async"
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                ) : (
                    fallbackLetter
                )
            );
        }

        if (notification.iconSource === "setMosaic") {
            const entries = metaMosaicEntries(notification);
            if (entries.length > 0) {
                return <SetMosaicSquare entries={entries} size={iconBoxSize} />;
            }
            return renderBoxedIcon(fallbackLetter);
        }

        return renderBoxedIcon(fallbackLetter);
    }

    function handleStarPress() {
        if (archiveMode === "star") {
            list.onArchiveToggle(notification);
        }
    }
    function handleTrashPress() {
        if (archiveMode !== "trash") {
            return;
        }
        if (!trashArmed) {
            setTrashArmed(true);
            return;
        }
        setTrashArmed(false);
        list.onArchiveRemove(notification.id);
    }
    function handleRowFocus() {
        list.onRowFocus(props.index);
    }
    function handleCardButtonDown(evt: { detail?: { button?: number } }) {
        if (evt?.detail?.button === BUTTON_SECONDARY && archiveMode === "star") {
            playToggleSound(!archivedProp);
            list.onArchiveToggle(notification);
            return;
        }
        list.onTabButtons?.(evt);
    }
    function handleArchiveBlur() {
        setArchiveFocused(false);
        setTrashArmed(false);
    }

    const card = (
        <FocusableItem
            focusKey={`notif:${notification.id}`}
            onClick={handleClick}
            onGamepadFocus={handleRowFocus}
            onMenuButton={list.onMenuButton}
            onButtonDown={handleCardButtonDown}
            actionDescriptionMap={archiveMode === "star"
                ? { ...list.tabLegend, [BUTTON_SECONDARY]: archivedProp ? t(language, "Unarchive") : t(language, "Archive") }
                : list.tabLegend}
            outerStyle={{ width: "100%", minWidth: 0 }}
        >
            <div
                style={{
                    position: "relative",
                    width: "100%",
                    display: "flex",
                    gap: `${Math.max(8, metrics.iconGap - 2)}px`,
                    alignItems: "flex-start",
                    padding: `${Math.max(3, Math.round(metrics.rowPaddingY * 0.42))}px 0`,
                    minWidth: 0
                }}
            >
                {isUnseen && (
                    <div
                        className="da-notes-dot"
                        style={{
                            position: "absolute",
                            top: "2px",
                            left: "2px",
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            background: warnAmber,
                            boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
                            animation: "da-notes-dot-pulse 3.2s ease-in-out infinite",
                            zIndex: 1
                        }}
                    />
                )}
                {renderIcon()}
                <div
                    style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: `${Math.max(2, metrics.contentGap - 1)}px`,
                        textAlign: "left",
                        paddingRight: archiveMode === "none" ? 0 : `${modalSize(52)}px`
                    }}
                >
                    <div
                        style={{
                            fontSize: `${metrics.titleFontSize}px`,
                            lineHeight: metrics.titleLineHeight,
                            fontWeight: 800,
                            minWidth: 0,
                            wordBreak: "break-word"
                        }}
                    >
                        {localizedTitle}
                    </div>
                    {(templatedBody || notification.body) && (
                        <div
                            ref={isClampedBody ? bodyRef : undefined}
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${metrics.bodyFontSize}px`,
                                lineHeight: metrics.bodyLineHeight,
                                opacity: 1,
                                color: bodyColor,
                                minWidth: 0,
                                wordBreak: "break-word",
                                ...(isClampedBody ? {
                                    display: "-webkit-box",
                                    WebkitBoxOrient: "vertical",
                                    WebkitLineClamp: bodyLineClamp,
                                    overflow: "hidden",
                                    whiteSpace: "pre-wrap"
                                } : {})
                            } as CSSProperties}
                        >
                            {templatedBody ?? notification.body}
                        </div>
                    )}
                    {isClampedBody && bodyTruncated && (
                        <div
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${metrics.pointsFontSize}px`,
                                lineHeight: metrics.pointsLineHeight,
                                opacity: 0.9,
                                fontWeight: 800
                            }}
                        >
                            {t(language, "Press A to view more")}
                        </div>
                    )}
                    {statsLine && (
                        <div
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${metrics.bodyFontSize}px`,
                                lineHeight: metrics.bodyLineHeight,
                                opacity: 0.7,
                                minWidth: 0
                            }}
                        >
                            {statsLine}
                        </div>
                    )}
                    {createdLabel && (
                        <div
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${metrics.pointsFontSize}px`,
                                lineHeight: metrics.pointsLineHeight,
                                fontWeight: 800,
                                minWidth: 0
                            }}
                        >
                            {createdLabel}
                        </div>
                    )}
                    {archiveMode === "star" && archiveError && (
                        <div style={{ marginTop: "2px" }}>
                            <ErrorText>{localizeRuntimeText(language, archiveError)}</ErrorText>
                        </div>
                    )}
                </div>
            </div>
        </FocusableItem>
    );

    if (archiveMode === "none") {
        return card;
    }

    const isStar = archiveMode === "star";
    const archived = isStar && archivedProp;
    const glyphColor = trashArmed
        ? "rgba(255,255,255,0.98)"
        : archived
            ? "#fbbf24"
            : archiveFocused
                ? "rgba(24,24,24,0.98)"
                : "rgba(255,255,255,0.92)";
    const cornerSize = modalSize(24);
    const cornerButton = (
        <Focusable
            flow-children="column"
            onMenuButton={list.onMenuButton}
            style={{
                position: "absolute",
                top: `${list.chrome.top + modalSize(5)}px`,
                right: `${list.chrome.right + modalSize(6)}px`,
                zIndex: 2,
                display: "flex"
            }}
        >
            <DialogButton
                onClick={isStar ? handleStarPress : handleTrashPress}
                onGamepadFocus={() => setArchiveFocused(true)}
                onGamepadBlur={handleArchiveBlur}
                style={{
                    minWidth: 0,
                    width: `${cornerSize}px`,
                    height: `${cornerSize}px`,
                    padding: 0,
                    fontSize: `${modalSize(13)}px`,
                    fontWeight: 800,
                    lineHeight: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: glyphColor,
                    background: trashArmed
                        ? "rgba(220,38,38,0.92)"
                        : archiveFocused
                            ? "rgba(255,255,255,0.96)"
                            : "rgba(24,24,24,0.82)",
                    border: archiveFocused
                        ? "1px solid rgba(255,255,255,1)"
                        : trashArmed
                            ? "1px solid rgba(255,255,255,0.9)"
                            : "1px solid rgba(255,255,255,0.4)",
                    boxShadow: archiveFocused
                        ? "0 0 0 2px rgba(255,255,255,0.85), 0 2px 8px rgba(0,0,0,0.5)"
                        : trashArmed
                            ? "0 0 0 2px rgba(220,38,38,0.7), 0 2px 8px rgba(0,0,0,0.5)"
                            : "0 2px 6px rgba(0,0,0,0.4)",
                    transition: "background 120ms ease, box-shadow 120ms ease, color 120ms ease"
                }}
            >
                <span style={{ color: glyphColor, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {isStar ? (archived ? "★" : "☆") : <TrashIcon size={modalSize(12)} />}
                </span>
            </DialogButton>
        </Focusable>
    );

    return (
        <Focusable
            flow-children="row"
            onMenuButton={list.onMenuButton}
            style={{
                position: "relative",
                display: "flex",
                alignItems: "stretch",
                width: "100%",
                minWidth: 0
            }}
        >
            {card}
            {cornerButton}
        </Focusable>
    );
});
