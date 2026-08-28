import { useEffect, useMemo, useRef, useState } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";

import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { playOkSound } from "../../utils/navSound";
import { addEventListener, removeEventListener } from "@decky/api";
import {
    NOTIFICATION_EVENT,
    archiveNotification,
    getArchivedNotifications,
    getNotifications,
    logNotificationsDebug,
    unarchiveNotification
} from "../../api";
import { CornerProbe } from "../ui/CornerProbe";
import { LabeledRow } from "../ui/LabeledRow";
import { NotificationScrollList } from "./NotificationScrollList";
import { SubTabButton } from "../ui/SubTabButton";
import type { NotificationNav } from "../../notifications/registry";
import { t, type LanguageCode } from "../../locales";
import type { ArchiveBucket, ArchiveSort, ArchivedNotification, CheevoNotification } from "../../types";
import { logError } from "../../utils/errors";
import {
    archiveBucketLabel,
    archiveSortLabel,
    filterAndSortArchived,
    nextArchiveBucket,
    nextArchiveSort
} from "../../utils/notifications";
import { BUTTON_BUMPER_LEFT, BUTTON_BUMPER_RIGHT } from "../../utils/gamepadButtons";
import { modalSize } from "../../utils/scale";
import { FADE_IN_KEYFRAMES, NOTES_DOT_KEYFRAMES } from "../../utils/style";

type NotifTab = "normal" | "archived";

type NotificationsModalProps = {
    initialNotifications: CheevoNotification[];
    seenAtSnapshot: number;
    language: LanguageCode;
    showIcons: boolean;
    nav: NotificationNav;
    close: () => void;
};

export function NotificationsModal(props: NotificationsModalProps) {
    const { initialNotifications, seenAtSnapshot, language, showIcons, nav, close } = props;

    const [items, setItems] = useState<CheevoNotification[]>(initialNotifications);

    const [activeTab, setActiveTab] = useState<NotifTab>("normal");
    const titleRef = useRef<HTMLDivElement | null>(null);
    const isArchivedTab = activeTab === "archived";

    const [archivedItems, setArchivedItems] = useState<ArchivedNotification[]>([]);

    const [archiveFilter, setArchiveFilter] = useState<ArchiveBucket>("all");
    const [archiveSort, setArchiveSort] = useState<ArchiveSort>("archivedDesc");

    const [archiveError, setArchiveError] = useState<{ id: string; message: string } | null>(null);

    const archivedIds = useMemo(() => new Set(archivedItems.map((item) => item.id)), [archivedItems]);
    const archivedView = useMemo(
        () => filterAndSortArchived(archivedItems, archiveFilter, archiveSort),
        [archivedItems, archiveFilter, archiveSort]
    );

    const seenAtRef = useRef(seenAtSnapshot);
    const seenAt = seenAtRef.current;

    useEffect(function logOpen() {
        logNotificationsDebug("open", String(initialNotifications.length));
    }, []);

    useEffect(function loadArchive() {
        let cancelled = false;
        void (async () => {
            try {
                const payload = await getArchivedNotifications();
                if (!cancelled) {
                    setArchivedItems(payload?.archived ?? []);
                }
            }
            catch (e) {
                logError("getArchivedNotifications (modal mount)", e);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(function subscribeToNotificationEvent() {
        const onNotification = () => {
            void (async () => {
                try {
                    const payload = await getNotifications();
                    setItems(payload?.notifications ?? []);
                }
                catch (e) {
                    logError("getNotifications (modal live refresh)", e);
                }
            })();
        };
        addEventListener(NOTIFICATION_EVENT, onNotification);
        return () => {
            removeEventListener(NOTIFICATION_EVENT, onNotification);
        };
    }, []);

    const toggleArchive = async function toggleArchive(notification: CheevoNotification) {
        const id = notification.id;
        if (archivedIds.has(id)) {
            setArchivedItems((prev) => prev.filter((item) => item.id !== id));
            setArchiveError((prev) => (prev?.id === id ? null : prev));
            try {
                await unarchiveNotification(id);
            }
            catch (e) {
                logError("unarchiveNotification", e);
            }
            return;
        }
        try {
            const result = await archiveNotification(notification);
            if (result?.ok && result.archived) {
                setArchivedItems((prev) => [...prev, result.archived as ArchivedNotification]);
                setArchiveError((prev) => (prev?.id === id ? null : prev));
            }
            else if (result?.error === "archive_full") {
                setArchiveError({ id, message: t(language, "Archive is full (2000 max). Remove some archived notifications first.") });
            }
            else {
                setArchiveError({ id, message: t(language, "Couldn't archive that notification.") });
            }
        }
        catch (e) {
            logError("archiveNotification", e);
            setArchiveError({ id, message: t(language, "Couldn't archive that notification.") });
        }
    };

    const removeArchived = async function removeArchived(id: string) {
        setArchivedItems((prev) => prev.filter((item) => item.id !== id));
        try {
            await unarchiveNotification(id);
        }
        catch (e) {
            logError("unarchiveNotification (archived tab)", e);
        }
    };

    const handleArchiveToggle = function handleArchiveToggle(notification: CheevoNotification) {
        void toggleArchive(notification);
    };
    const handleArchiveRemove = function handleArchiveRemove(id: string) {
        void removeArchived(id);
    };

    const archivedEmpty = archivedItems.length === 0
        ? t(language, "There are no archived notifications here yet. Simply press the star button on the notification you wish to archive.")
        : t(language, "Nothing archived in this filter.");

    function closeOnMenu() {
        playOkSound();
        close();
    }

    function goToTab(tab: NotifTab) {
        if (tab === activeTab) {
            return;
        }
        playOkSound();
        setActiveTab(tab);
    }
    function handleTabButtons(evt: { detail?: { button?: number } }) {
        const button = evt?.detail?.button;
        if (button === BUTTON_BUMPER_LEFT) {
            goToTab("normal");
            return;
        }
        if (button === BUTTON_BUMPER_RIGHT) {
            goToTab("archived");
        }
    }
    const tabLegend = useMemo(() => ({
        [BUTTON_BUMPER_LEFT]: t(language, "Notifications"),
        [BUTTON_BUMPER_RIGHT]: t(language, "Archived")
    }), [language]);

    const tabFocusArmed = useRef(false);
    useEffect(() => {
        if (!tabFocusArmed.current) {
            tabFocusArmed.current = true;
            return;
        }
        const doc = titleRef.current?.ownerDocument;
        if (!doc) {
            return;
        }
        const pill = doc.querySelector(`[data-focus-key="notif:tab:${activeTab}"]`);
        const target = (pill?.querySelector("button, [tabindex]") ?? pill) as HTMLElement | null;
        target?.focus();
    }, [activeTab]);

    return (
        <ModalRoot onCancel={close} onEscKeypress={close} onMenuButton={closeOnMenu} onButtonDown={handleTabButtons} actionDescriptionMap={tabLegend}>
            <SnapshotHotkey language={language} />
            <style>{FADE_IN_KEYFRAMES}</style>
            <style>{NOTES_DOT_KEYFRAMES}</style>
            <CornerProbe key={`corner:${activeTab}`} surface={`modal:notifications:${activeTab}`} />
            <div ref={titleRef} style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                {t(language, "Notifications")}
            </div>

            <Focusable
                flow-children="row"
                onMenuButton={closeOnMenu}
                onButtonDown={handleTabButtons}
                actionDescriptionMap={tabLegend}
                style={{ display: "flex", flexDirection: "row", gap: "8px", marginBottom: "12px" }}
            >
                <SubTabButton
                    focusKey="notif:tab:normal"
                    label={t(language, "Notifications")}
                    active={!isArchivedTab}
                    onClick={() => setActiveTab("normal")}
                />
                <SubTabButton
                    focusKey="notif:tab:archived"
                    label={t(language, "Archived")}
                    active={isArchivedTab}
                    onClick={() => setActiveTab("archived")}
                />
            </Focusable>

            {isArchivedTab && (
                <>
                    <LabeledRow
                        onMenuButton={closeOnMenu}
                        onButtonDown={handleTabButtons}
                        actionDescriptionMap={tabLegend}
                        focusKey="notif-archive:sort"
                        label={t(language, "Sort")}
                        value={archiveSortLabel(archiveSort, language)}
                        onClick={() => setArchiveSort((current) => nextArchiveSort(current))}
                    />
                    <LabeledRow
                        onMenuButton={closeOnMenu}
                        onButtonDown={handleTabButtons}
                        actionDescriptionMap={tabLegend}
                        focusKey="notif-archive:filter"
                        label={t(language, "Filter")}
                        value={archiveBucketLabel(archiveFilter, language)}
                        onClick={() => setArchiveFilter((current) => nextArchiveBucket(current))}
                    />
                </>
            )}

            {
}
            {isArchivedTab ? (
                <NotificationScrollList
                    onMenuButton={closeOnMenu}
                    onTabButtons={handleTabButtons}
                    tabLegend={tabLegend}
                    key={`archived:${archiveFilter}:${archiveSort}`}
                    items={archivedView}
                    seenAt={seenAt}
                    showIcons={showIcons}
                    language={language}
                    nav={nav}
                    emptyMessage={archivedEmpty}
                    keyPrefix="archived"
                    archiveMode="trash"
                    archivedIds={archivedIds}
                    archiveErrorId={archiveError?.id ?? null}
                    archiveErrorMessage={archiveError?.message ?? null}
                    onArchiveToggle={handleArchiveToggle}
                    onArchiveRemove={handleArchiveRemove}
                    close={close}
                />
            ) : (
                <NotificationScrollList
                    onMenuButton={closeOnMenu}
                    onTabButtons={handleTabButtons}
                    tabLegend={tabLegend}
                    items={items}
                    seenAt={seenAt}
                    showIcons={showIcons}
                    language={language}
                    nav={nav}
                    emptyMessage={t(language, "Nothing here yet.")}
                    keyPrefix="normal"
                    archiveMode="star"
                    archivedIds={archivedIds}
                    archiveErrorId={archiveError?.id ?? null}
                    archiveErrorMessage={archiveError?.message ?? null}
                    onArchiveToggle={handleArchiveToggle}
                    onArchiveRemove={handleArchiveRemove}
                    close={close}
                />
            )}

            <Focusable
                onMenuButton={closeOnMenu}
                onButtonDown={handleTabButtons}
                actionDescriptionMap={tabLegend}
                style={{
                    display: "flex",
                    justifyContent: "flex-start",
                    gap: "8px",
                    marginTop: "16px"
                }}
                flow-children="row"
            >
                <DialogButton onClick={close}>
                    {t(language, "Done")}
                </DialogButton>
            </Focusable>
        </ModalRoot>
    );
}
