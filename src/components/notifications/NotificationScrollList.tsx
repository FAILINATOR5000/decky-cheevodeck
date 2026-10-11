import { useEffect, useMemo, useRef } from "react";
import {
    cacheAchievementIcons,
    getAchievementIcons,
    getCachedAchievementIcons,
    getCachedGameIconDataUri,
    prefetchGameIcons,
    prefetchUserAvatars
} from "../../api";
import { NotificationCard, notificationCardMetrics, type NotificationCardListProps } from "./NotificationCard";
import { useCardChrome } from "../../hooks/useCardChrome";
import { useSlidingWindow } from "../../hooks/useSlidingWindow";
import { focusHeldRow, useWhenHeld } from "../../hooks/useWhenHeld";
import { SlidingWindowRows } from "../ui/SlidingWindowRows";
import type { NotificationNav } from "../../notifications/registry";
import type { LanguageCode } from "../../locales";
import type { ArchivedNotification, CheevoNotification } from "../../types";
import { logError } from "../../utils/errors";
import { getCurrentModalScale } from "../../utils/scale";
import { modalBodyStyle } from "../../utils/style";

const NOTIF_INITIAL_ROWS = 30;
const NOTIF_ROW_STEP = 25;
const NOTIF_SENTINEL_ROOT_MARGIN_PX = 600;
const NOTIF_PREFETCH_DISTANCE = 10;

type NotificationRow = CheevoNotification | ArchivedNotification;

function notificationFocusKey(item: NotificationRow): string {
    return `notif:${item.id}`;
}

export type NotificationScrollListProps = {
    onMenuButton?: () => void;
    items: NotificationRow[];
    seenAt: number;
    showIcons: boolean;
    language: LanguageCode;
    nav: NotificationNav;
    emptyMessage: string;
    keyPrefix: string;
    archiveMode: "star" | "trash" | "none";
    archivedIds: Set<string>;
    archiveErrorId: string | null;
    archiveErrorMessage: string | null;
    onArchiveToggle: (notification: CheevoNotification) => void;
    onArchiveRemove: (id: string) => void;
    onTabButtons?: (evt: { detail?: { button?: number } }) => void;
    tabLegend?: Record<number, React.ReactNode>;
    close: () => void;
};

export function NotificationScrollList(props: NotificationScrollListProps) {
    const {
        items, seenAt, showIcons, language, nav, emptyMessage, keyPrefix,
        archiveMode, archivedIds, archiveErrorId, archiveErrorMessage,
        onArchiveToggle, onArchiveRemove, close, onMenuButton, onTabButtons, tabLegend
    } = props;

    const rowKeys = useMemo(() => {
        const seen = new Map<string, number>();
        const keys = new Map<NotificationRow, string>();
        for (const item of items) {
            const count = seen.get(item.id) ?? 0;
            seen.set(item.id, count + 1);
            keys.set(item, count === 0 ? item.id : `${item.id}#${count}`);
        }
        return keys;
    }, [items]);

    const windowId = `notifications:${keyPrefix}`;
    const cardWindow = useSlidingWindow({
        items,
        itemKey: (item) => rowKeys.get(item) ?? item.id,
        focusKeyFor: notificationFocusKey,
        windowId,
        heightScope: ["notifications", getCurrentModalScale(), showIcons, language].join("|"),
        dynamicLoading: true,
        initialRows: NOTIF_INITIAL_ROWS,
        rowStep: NOTIF_ROW_STEP,
        fullSteps: true,
        prefetchDistance: NOTIF_PREFETCH_DISTANCE,
        sentinelRootMarginPx: NOTIF_SENTINEL_ROOT_MARGIN_PX,
        resetKey: `${keyPrefix}|${items.length > 0}`,
        debugLabel: windowId
    });
    const visible = cardWindow.mountedItems;
    const onItemFocus = cardWindow.onItemFocus;

    const whenCardHeld = useWhenHeld(cardWindow, items, notificationFocusKey);

    function removeArchived(id: string) {
        const at = items.findIndex((item) => item.id === id);
        const heir = items[at + 1] ?? items[at - 1];
        onArchiveRemove(id);
        if (heir) {
            whenCardHeld(notificationFocusKey(heir), () => focusHeldRow(cardWindow, notificationFocusKey(heir)), `notif:${id}`);
        }
    }

    const warmedGameIdsRef = useRef<Set<number>>(new Set());
    const warmedBadgeKeysRef = useRef<Set<string>>(new Set());
    const warmedAvatarKeysRef = useRef<Set<string>>(new Set());

    const coldGameIdsRef = useRef<Set<number>>(new Set());

    useEffect(function prefetchMountedWindowIcons() {
        if (!showIcons) {
            return;
        }
        const warmed = warmedGameIdsRef.current;
        const freshRows: Array<{ gameId: number; imageIcon: string | null }> = [];
        for (const notification of visible) {
            if (notification.iconSource === "setMosaic") {
                const faces = notification.meta?.mosaicEntries;
                if (Array.isArray(faces)) {
                    for (const face of faces) {
                        const faceId = (face as { gameId?: unknown })?.gameId;
                        if (typeof faceId !== "number" || warmed.has(faceId)) {
                            continue;
                        }
                        const faceIcon = (face as { imageIcon?: unknown })?.imageIcon;
                        warmed.add(faceId);
                        freshRows.push({ gameId: faceId, imageIcon: typeof faceIcon === "string" ? faceIcon : null });
                    }
                }
                continue;
            }
            const gameId = notification.iconGameId;
            if (notification.iconSource !== "game" || gameId == null) {
                continue;
            }
            if (warmed.has(gameId)) {
                continue;
            }
            warmed.add(gameId);
            if (getCachedGameIconDataUri(gameId) === null) {
                coldGameIdsRef.current.add(gameId);
            }
            freshRows.push({ gameId, imageIcon: notification.iconImageIcon ?? null });
        }
        if (freshRows.length > 0) {
            void prefetchGameIcons(freshRows);
        }

        const warmedBadges = warmedBadgeKeysRef.current;
        const badgesByGame = new Map<number, string[]>();
        for (const notification of visible) {
            if (notification.iconSource !== "achievement") {
                continue;
            }
            const badgeGameId = notification.iconGameId;
            const rawBadge = notification.meta?.badgeName;
            const badge = typeof rawBadge === "string" ? rawBadge.trim() : "";
            if (badgeGameId == null || !badge) {
                continue;
            }
            const key = `${badgeGameId}:${badge}`;
            if (warmedBadges.has(key)) {
                continue;
            }
            warmedBadges.add(key);
            const list = badgesByGame.get(badgeGameId);
            if (list) {
                list.push(badge);
            }
            else {
                badgesByGame.set(badgeGameId, [badge]);
            }
        }
        if (badgesByGame.size === 0) {
            return;
        }
        let cancelled = false;
        void (async () => {
            for (const [badgeGameId, badgeNames] of badgesByGame) {
                if (cancelled) {
                    return;
                }
                const cached = getCachedAchievementIcons(badgeGameId, badgeNames);
                const missing = badgeNames.filter((name) => !cached[name]);
                if (missing.length === 0) {
                    continue;
                }
                try {
                    const result = await getAchievementIcons(badgeGameId, missing);
                    cacheAchievementIcons(badgeGameId, result?.icons ?? {});
                }
                catch (e) {
                    logError("NotificationScrollList achievement badge warm", e);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [visible, showIcons]);

    useEffect(function prefetchMountedWindowAvatars() {
        if (!showIcons) {
            return;
        }
        const warmed = warmedAvatarKeysRef.current;
        const freshNames: string[] = [];
        for (const notification of visible) {
            if (notification.iconSource !== "avatar") {
                continue;
            }
            const rawName = notification.meta?.username;
            const name = typeof rawName === "string" ? rawName.trim() : "";
            if (!name) {
                continue;
            }
            const key = name.toLowerCase();
            if (warmed.has(key)) {
                continue;
            }
            warmed.add(key);
            freshNames.push(name);
        }
        if (freshNames.length > 0) {
            void prefetchUserAvatars(freshNames);
        }
    }, [visible, showIcons]);

    const { chrome, markerRef: chromeMarkerRef } = useCardChrome("notif:n", archiveMode);

    const toggleRef = useRef(onArchiveToggle);
    toggleRef.current = onArchiveToggle;
    const removeRef = useRef(removeArchived);
    removeRef.current = removeArchived;
    const focusRef = useRef(onItemFocus);
    focusRef.current = onItemFocus;
    const closeRef = useRef(close);
    closeRef.current = close;
    const tabButtonsRef = useRef(onTabButtons);
    tabButtonsRef.current = onTabButtons;

    const cardList = useMemo<NotificationCardListProps>(() => ({
        onMenuButton,
        metrics: notificationCardMetrics(),
        chrome,
        seenAtSnapshot: seenAt,
        showIcons,
        language,
        nav,
        coldGameIds: coldGameIdsRef.current,
        archiveMode,
        onArchiveToggle: (notification: CheevoNotification) => {
            toggleRef.current(notification);
        },
        onArchiveRemove: (id: string) => {
            removeRef.current(id);
        },
        onRowFocus: (index: number) => {
            focusRef.current(index);
        },
        onTabButtons: (evt: { detail?: { button?: number } }) => {
            tabButtonsRef.current?.(evt);
        },
        tabLegend,
        close: () => {
            closeRef.current();
        }
    }), [chrome, seenAt, showIcons, language, nav, archiveMode, onMenuButton, tabLegend]);

    if (items.length === 0) {
        return <div style={modalBodyStyle()}>{emptyMessage}</div>;
    }

    return (
        <div>
            <div ref={chromeMarkerRef} style={{ display: "none" }} />
            <SlidingWindowRows list={cardWindow}>
                {visible.map((notification, index) => (
                    <div key={`notif:${rowKeys.get(notification) ?? notification.id}`} style={{ paddingBottom: "4px" }}>
                        <NotificationCard
                            notification={notification}
                            index={cardWindow.start + index}
                            list={cardList}
                            archived={archiveMode === "star" && archivedIds.has(notification.id)}
                            archiveError={archiveErrorId === notification.id ? archiveErrorMessage : null}
                            onGamepadDirection={cardWindow.guardTopRow(cardWindow.start + index)}
                        />
                    </div>
                ))}
            </SlidingWindowRows>
        </div>
    );
}
