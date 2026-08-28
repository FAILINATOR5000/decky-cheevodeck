import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addEventListener, removeEventListener } from "@decky/api";
import {
    NOTIFICATION_EVENT,
    clearAllNotifications,
    getNotifications,
    logNotificationsDebug,
    markNotificationsSeen
} from "../api";
import type { CheevoNotification } from "../types";
import { logError } from "../utils/errors";

export function useNotificationsController(doNotDisturb: boolean, doNotDisturbDisablesDot: boolean, showBellDot: boolean) {
    const [notifications, setNotifications] = useState<CheevoNotification[]>([]);
    const [lastSeenAt, setLastSeenAt] = useState(0);

    const refreshIdRef = useRef(0);

    const refresh = useCallback(async () => {
        const refreshId = ++refreshIdRef.current;
        try {
            const payload = await getNotifications();
            if (refreshId !== refreshIdRef.current) {
                return;
            }
            setNotifications(payload?.notifications ?? []);
            setLastSeenAt(payload?.lastSeenAt ?? 0);
        }
        catch (e) {
            logError("getNotifications", e);
        }
    }, []);

    const markSeen = async () => {
        try {
            const result = await markNotificationsSeen();
            if (result?.ok) {
                setLastSeenAt(result.lastSeenAt ?? Math.floor(Date.now() / 1000));
                logNotificationsDebug("seen", String(result.lastSeenAt ?? ""));
            }
        }
        catch (e) {
            logError("markNotificationsSeen", e);
        }
    };

    const clearAll = async () => {
        try {
            await clearAllNotifications();
            setNotifications([]);
            setLastSeenAt(Math.floor(Date.now() / 1000));
            logNotificationsDebug("clear", "all");
        }
        catch (e) {
            logError("clearAllNotifications", e);
        }
    };

    useEffect(() => {
        void refresh();

        const onNotification = () => {
            void refresh();
        };
        addEventListener(NOTIFICATION_EVENT, onNotification);
        return () => {
            removeEventListener(NOTIFICATION_EVENT, onNotification);
        };
    }, [refresh]);

    const hasUnread = useMemo(() => {
        if (!showBellDot) {
            return false;
        }
        if (doNotDisturb && doNotDisturbDisablesDot) {
            return false;
        }
        return notifications.some((n) => n.createdAt > lastSeenAt);
    }, [notifications, lastSeenAt, doNotDisturb, doNotDisturbDisablesDot, showBellDot]);

    return { notifications, lastSeenAt, hasUnread, refresh, markSeen, clearAll };
}
