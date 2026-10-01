import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Focusable, PanelSectionRow } from "@decky/ui";
import { PanelSection } from "../components/ui/PanelSection";
import { BackButton } from "../components/ui/BackButton";
import { ErrorText } from "../components/ui/ErrorText";
import { FocusClaim } from "../components/ui/FocusClaim";
import { LabeledRow } from "../components/ui/LabeledRow";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { RestoreCurtain } from "../components/ui/RestoreCurtain";
import { SubTabButton } from "../components/ui/SubTabButton";
import { CommentActionStrip } from "../components/comments/CommentActionStrip";
import { CommentsList } from "../components/comments/CommentsList";
import { EventAchievementsBody, eventListOrder } from "../components/events/EventAchievementsBody";
import { EventChecklistBody } from "../components/events/EventChecklistBody";
import { EventViewerHeader, type EventHeaderButton } from "../components/events/EventViewerHeader";
import { useEvents } from "../components/events/EventsContext";
import { AotwView, type AotwViewProps } from "../components/events/AotwView";
import { useEventViewerController } from "../hooks/useEventViewerController";
import { useFocusClaim } from "../hooks/useFocusClaim";
import { useThreadSubscription } from "../hooks/useThreadSubscription";
import { localizeRuntimeText, t, type LanguageCode } from "../locales";
import type { AchievementRow, EventViewerTab, EventViewerTarget, GameComment, ViewKey } from "../types";
import type { SavedCommentSourceInput } from "../utils/savedComments";
import { gameCommentSource } from "../utils/savedComments";
import { unlockedHardcore } from "../utils/achievements";
import { canMarkComplete, checklistCards, checklistMasteryMarkable, checklistPoints, eventCompletion, EVENTS_CONSOLE_NAME } from "../utils/events";
import { armEventViewerButtonReturn, armEventViewerRowReturn, takeEventViewerReturn } from "../utils/eventViewerFocusReturn";
import {
    clearCommentsSnapshot,
    hasCommentsPostReturnFor,
    hasCommentsSnapshotFor,
    putCommentsPostReturn,
    putCommentsSnapshot
} from "../utils/commentsSnapshot";
import { measureCommentWindow } from "../utils/commentGeometry";
import { BUTTON_SECONDARY } from "../utils/gamepadButtons";
import { openExternalUrl, raForumTopicUrl, raGameCommentsUrl } from "../utils/navigation";
import { playOkSound } from "../utils/navSound";
import { bodyTextStyle } from "../utils/style";

const TABS: { value: EventViewerTab; labelKey: string; focusKey: string }[] = [
    { value: "achievements", labelKey: "Achievements", focusKey: "eventviewer:tab:achievements" },
    { value: "comments", labelKey: "Comments", focusKey: "eventviewer:tab:comments" }
];

type EventViewerPageState = {
    view: ViewKey;
    language: LanguageCode;
    target: EventViewerTarget;
    tab: EventViewerTab;
    panelOverlayVisible: boolean;
};

type EventViewState = Omit<EventViewerPageState, "target"> & { eventGameId: number };

type EventViewerPageActions = {
    onBack: () => void | Promise<void>;
    onHome: () => void | Promise<void>;
    onChangeTab: (tab: EventViewerTab) => void;
    onOpenAchievement: (achievement: AchievementRow, parentGameId: number) => void;
    onOpenGame: (gameId: number) => void;
    onOpenCommentModal: (comment: GameComment, url: string | null, source: SavedCommentSourceInput) => void;
    onRequestFocus: (focusKey: string) => void;
};

function EventViewerPage(props: { state: EventViewerPageState; actions: EventViewerPageActions; aotw: AotwViewProps }) {
    const { state, actions } = props;
    const { settings } = useEvents();
    if (state.view !== "eventViewer") {
        return null;
    }
    if (state.target === "aotw") {
        return (
            <AotwView
                language={state.language}
                aotw={props.aotw}
                uiSize={settings.uiSize}
                showIcons={settings.showIcons}
                buttonSpacing={settings.buttonSpacing}
                dynamicComments={settings.dynamicComments}
                dynamicCommentsSentinelRootMargin={settings.dynamicCommentsSentinelRootMargin}
                panelOverlayVisible={state.panelOverlayVisible}
                onBack={actions.onBack}
                onHome={actions.onHome}
            />
        );
    }
    return <EventView state={{ ...state, eventGameId: state.target }} actions={actions} />;
}

function EventView(props: { state: EventViewState; actions: EventViewerPageActions }) {
    const { state, actions } = props;
    const { language, eventGameId, tab } = state;
    const events = useEvents();
    const { settings } = events;
    const pageRef = useRef<HTMLDivElement | null>(null);

    const viewer = useEventViewerController({
        isActive: state.view === "eventViewer",
        eventGameId,
        owner: events.state.owner,
        commentsActive: tab === "comments",
        dynamicComments: settings.dynamicComments,
        dynamicCommentsInitialRows: settings.dynamicCommentsInitialRows,
        dynamicCommentsRowStep: settings.dynamicCommentsRowStep,
        legacyCommentsLoading: settings.legacyCommentsLoading
    });
    const comments = viewer.comments.state;
    const commentActions = viewer.comments.actions;

    useEffect(() => {
        if (events.state.events === null) {
            events.actions.enter();
        }
    }, []);

    const [restore] = useState(() => takeEventViewerReturn(eventGameId, events.state.owner));
    const restoreRowId = restore?.achievementId ?? null;
    const restoreButtonKey = restore?.buttonKey ?? null;
    const [commentsRestore] = useState(() =>
        hasCommentsSnapshotFor("comments:event", eventGameId) || hasCommentsPostReturnFor("comments:event", eventGameId)
    );
    const [rowRestoreSettled, setRowRestoreSettled] = useState(restoreRowId === null);
    const restorePending = restoreRowId !== null || restoreButtonKey !== null || commentsRestore;

    const row = events.state.events?.find((entry) => entry.gameId === eventGameId) ?? null;
    const detail = viewer.detail;
    const payload = viewer.payload;
    const title = row?.title || detail?.title || payload?.title || "";
    const iconUrl = row?.imageIcon || detail?.imageIcon || "";
    const completion = row ? eventCompletion(row, events.state.user) : null;
    const tracked = Boolean(events.state.user?.tracked.items[String(eventGameId)]);

    const kindSource = detail ?? row;
    const markable = row !== null && kindSource !== null && canMarkComplete({ kind: kindSource.kind, earnedAt: row.earnedAt });

    const achievements = payload?.achievements ?? [];
    const hardcoreEarned = achievements.filter((entry) => unlockedHardcore(entry)).length;

    const checklist = viewer.isChecklist ? detail?.checklist ?? null : null;
    const ticks = events.state.user?.checklistTicks[String(eventGameId)];
    const activeFrom = detail?.activeFrom ?? row?.activeFrom ?? null;
    const cards = useMemo(
        () => (checklist ? checklistCards(checklist, viewer.checklistProgress, ticks ?? {}, activeFrom) : []),
        [checklist, viewer.checklistProgress, ticks, activeFrom]
    );
    const points = checklist ? checklistPoints(cards, checklist.rule) : null;
    const target = checklist?.rule.target ?? null;

    let progressText: ReactNode = null;
    let progressFraction: number | null = null;
    if (checklist) {
        if (points !== null && target !== null && viewer.checklistProgress !== null) {
            progressText = points >= target
                ? t(language, "{{points}} / {{target}} points, target reached", { points, target })
                : t(language, "{{points}} / {{target}} points", { points, target });
            progressFraction = Math.min(1, points / target);
        }
    }
    else if (achievements.length > 0) {
        progressText = t(language, "{{earned}} / {{total}} earned", { earned: hardcoreEarned, total: achievements.length });
        progressFraction = hardcoreEarned / achievements.length;
    }

    const lastProgress = events.state.user?.activity[String(eventGameId)]?.lastProgress ?? null;
    const isChecklistKind = kindSource?.kind === "checklist";
    const progressReady = isChecklistKind
        ? viewer.checklistProgress !== null
        : (payload !== null && payload.gameId === eventGameId) || viewer.payloadError !== null;
    if (progressText === null && !progressReady && lastProgress !== null) {
        const lastTarget = row?.checklistTarget ?? null;
        if (isChecklistKind && lastProgress.points !== null && lastTarget) {
            progressText = t(language, "{{points}} / {{target}} points", { points: lastProgress.points, target: lastTarget });
            progressFraction = Math.min(1, lastProgress.points / lastTarget);
        }
        else if (!isChecklistKind && lastProgress.total > 0) {
            progressText = t(language, "{{earned}} / {{total}} earned", { earned: lastProgress.earned, total: lastProgress.total });
            progressFraction = lastProgress.earned / lastProgress.total;
        }
    }
    const progressExpected = isChecklistKind ? Boolean(row?.checklistTarget) : (row?.numAchievements ?? 0) > 0;
    const progressPending = progressText === null && !progressReady && progressExpected;

    const touchedRef = useRef(false);
    const payloadHere = payload !== null && payload.gameId === eventGameId;
    useEffect(() => {
        if (touchedRef.current || !viewer.detailLoaded) {
            return;
        }
        if (checklist) {
            if (viewer.checklistProgress === null || events.state.user === null) {
                return;
            }
            touchedRef.current = true;
            events.actions.touchOpened(eventGameId, {
                earned: cards.filter((card) => card.ticked).length,
                total: cards.length,
                points
            });
            return;
        }
        if (!payloadHere && !viewer.payloadError) {
            return;
        }
        touchedRef.current = true;
        events.actions.touchOpened(
            eventGameId,
            payloadHere ? { earned: hardcoreEarned, total: achievements.length, points: null } : null
        );
    }, [payloadHere, viewer.payloadError, viewer.detailLoaded, viewer.checklistProgress, events.state.user]);

    function openChecklistGame(gameId: number) {
        playOkSound();
        armEventViewerRowReturn(eventGameId, gameId, events.state.owner);
        actions.onOpenGame(gameId);
    }

    const sources = detail?.sources ?? {};
    const ordered = useMemo(() => eventListOrder(achievements), [achievements]);
    const sourceBanners = kindSource?.kind === "spreadsheet";

    function openAchievement(achievement: AchievementRow) {
        if (sources[String(achievement.id)]?.obfuscated) {
            return;
        }
        playOkSound();
        armEventViewerRowReturn(eventGameId, achievement.id, events.state.owner);
        const source = sources[String(achievement.id)];
        if (source && !source.obfuscated) {
            actions.onOpenAchievement(
                { ...achievement, id: source.achievementId, points: source.points ?? achievement.points },
                source.gameId
            );
            return;
        }
        actions.onOpenAchievement(achievement, eventGameId);
    }

    function openSourceGame(achievement: AchievementRow): boolean {
        const source = sources[String(achievement.id)];
        if (!source || source.obfuscated) {
            return false;
        }
        playOkSound();
        armEventViewerRowReturn(eventGameId, achievement.id, events.state.owner);
        actions.onOpenGame(source.gameId);
        return true;
    }

    function handleButtonDown(evt: { detail?: { button?: number }; target?: EventTarget | null }) {
        if (evt?.detail?.button !== BUTTON_SECONDARY || settings.mouseKeyboardMode || tab !== "achievements" || sourceBanners) {
            return;
        }
        const target = evt.target as { closest?: (selector: string) => Element | null } | null | undefined;
        const focusKey = typeof target?.closest === "function"
            ? target.closest("[data-focus-key]")?.getAttribute("data-focus-key") ?? null
            : null;
        const match = focusKey === null ? null : /^achievement:(\d+)$/.exec(focusKey);
        const achievement = match ? ordered.find((entry) => entry.id === Number(match[1])) : undefined;
        if (achievement) {
            openSourceGame(achievement);
        }
    }

    const buttons: EventHeaderButton[] = [
        {
            key: "track",
            label: tracked ? t(language, "Untrack") : t(language, "Track"),
            onClick: () => events.actions.toggleTracked(eventGameId)
        }
    ];
    if (markable && completion?.kind !== "earned") {
        const marked = completion?.kind === "marked";
        buttons.push({
            key: "mark",
            label: marked ? t(language, "Mark Incomplete") : t(language, "Mark Complete"),
            onClick: () => void events.actions.setCompleted(eventGameId, !marked)
        });
    }
    const forumTopicId = detail?.forumTopicId ?? row?.forumTopicId ?? null;
    if (forumTopicId !== null) {
        buttons.push({
            key: "thread",
            label: t(language, "Event Thread"),
            onClick: () => openHeaderLink("thread", raForumTopicUrl(forumTopicId))
        });
    }
    if (detail?.infoUrl) {
        const infoUrl = detail.infoUrl;
        buttons.push({ key: "info", label: t(language, "More Info"), onClick: () => openHeaderLink("info", infoUrl) });
    }
    for (const [index, link] of (detail?.links ?? []).entries()) {
        buttons.push({
            key: `link:${index}`,
            label: link.label || t(language, "Open Sheet"),
            onClick: () => openHeaderLink(`link:${index}`, link.url)
        });
    }

    function openHeaderLink(key: string, url: string) {
        armEventViewerButtonReturn(eventGameId, key, events.state.owner);
        void openExternalUrl(url);
    }

    const buttonClaim = useFocusClaim();
    const [buttonRestoreSettled, setButtonRestoreSettled] = useState(restoreButtonKey === null);
    const buttonFiredRef = useRef(false);
    const buttonsKnown = viewer.detailLoaded && events.state.events !== null;
    const restoreButtonIndex = restoreButtonKey === null ? -1 : buttons.findIndex((button) => button.key === restoreButtonKey);
    useEffect(() => {
        if (restoreButtonKey === null || buttonFiredRef.current || !buttonsKnown) {
            return;
        }
        buttonFiredRef.current = true;
        if (restoreButtonIndex < 0) {
            setButtonRestoreSettled(true);
            actions.onRequestFocus("eventviewer:back");
            return;
        }
        buttonClaim.claimSlot(restoreButtonIndex);
        actions.onRequestFocus(`eventviewer:${restoreButtonKey}`);
    }, [buttonsKnown, restoreButtonIndex]);
    const buttonClaimSpent = buttonFiredRef.current && (buttonClaim.claim?.token ?? 0) > 0 && !buttonClaim.claim?.armed;
    useEffect(() => {
        if (buttonClaimSpent) {
            setButtonRestoreSettled(true);
        }
    }, [buttonClaimSpent]);

    const { isSubscribed, subscribeError, onToggleSubscribe } = useThreadSubscription({
        language,
        kind: "game",
        id: eventGameId,
        buildEntry: () => {
            if (!title) {
                return null;
            }
            return {
                kind: "game",
                id: eventGameId,
                gameId: eventGameId,
                title,
                gameTitle: title,
                console: EVENTS_CONSOLE_NAME,
                iconUrl,
                badgeName: "",
                seedComments: comments.comments,
                seedSort: comments.commentsSort,
                seedLoaded: comments.commentsLoaded
            };
        }
    });

    useEffect(() => {
        const cardClaim = comments.commentsCardClaim;
        if (cardClaim?.armed) {
            actions.onRequestFocus(`eventviewer:comment:${cardClaim.slotIndex}`);
            return;
        }
        if (comments.commentsPostClaim?.armed) {
            actions.onRequestFocus("eventviewer:comments:post");
        }
    }, [comments.commentsCardClaim, comments.commentsPostClaim]);

    function openComment(comment: GameComment) {
        const captured = commentActions.captureComments(comment);
        if (captured) {
            const geometry = measureCommentWindow(pageRef.current, "eventviewer:comment", captured.focusIndex);
            putCommentsSnapshot({
                surfaceKey: "comments:event",
                threadId: eventGameId,
                ulid: events.state.owner,
                ...captured,
                windowStart: geometry?.windowStart ?? 0,
                spacerPx: geometry?.spacerPx ?? 0
            });
        }
        else {
            clearCommentsSnapshot();
        }
        actions.onOpenCommentModal(
            comment,
            raGameCommentsUrl(eventGameId),
            gameCommentSource(eventGameId, title, iconUrl, EVENTS_CONSOLE_NAME)
        );
    }

    async function postComment() {
        clearCommentsSnapshot();
        putCommentsPostReturn("comments:event", eventGameId, events.state.owner);
        await openExternalUrl(raGameCommentsUrl(eventGameId));
    }

    const commentClaim = comments.commentsCardClaim ?? comments.commentsPostClaim;
    const commentsSettled = !commentsRestore
        || ((commentClaim?.token ?? 0) > 0 && !commentClaim?.armed);
    const curtainArmed = restorePending && !state.panelOverlayVisible;
    const curtainSettled = (rowRestoreSettled || tab !== "achievements") && buttonRestoreSettled && commentsSettled;

    const commentsEmpty = comments.commentsLoaded && comments.comments.length === 0 && !comments.commentsError;

    const commentsBody = commentsEmpty ? (
        <PanelSection>
            <PanelSectionRow>
                <div style={bodyTextStyle()}>{t(language, "No comments yet for this event.")}</div>
            </PanelSectionRow>
            {subscribeError ? (
                <PanelSectionRow>
                    <ErrorText>{localizeRuntimeText(language, subscribeError)}</ErrorText>
                </PanelSectionRow>
            ) : null}
            <FocusClaim
                token={comments.commentsPostClaim?.token ?? 0}
                armed={comments.commentsPostClaim?.armed ?? false}
                onSpent={commentActions.spendCommentsPostClaim}
            >
                <CommentActionStrip
                    language={language}
                    isSubscribed={isSubscribed}
                    onPost={postComment}
                    onToggleSubscribe={onToggleSubscribe}
                    postFocusKey="eventviewer:comments:post"
                    subscribeFocusKey="eventviewer:comments:subscribe"
                />
            </FocusClaim>
        </PanelSection>
    ) : (
        <>
            <PanelSection>
                {subscribeError ? (
                    <PanelSectionRow>
                        <ErrorText>{localizeRuntimeText(language, subscribeError)}</ErrorText>
                    </PanelSectionRow>
                ) : null}
                <FocusClaim
                    token={comments.commentsPostClaim?.token ?? 0}
                    armed={comments.commentsPostClaim?.armed ?? false}
                    onSpent={commentActions.spendCommentsPostClaim}
                >
                    <CommentActionStrip
                        language={language}
                        isSubscribed={isSubscribed}
                        onPost={postComment}
                        onToggleSubscribe={onToggleSubscribe}
                        postFocusKey="eventviewer:comments:post"
                        subscribeFocusKey="eventviewer:comments:subscribe"
                    />
                </FocusClaim>
            </PanelSection>
            <PanelSection title={t(language, "View Options")}>
                <LabeledRow
                    focusKey="eventviewer:comments:sort"
                    onClick={() => commentActions.setCommentsSort(comments.commentsSort === "newest" ? "oldest" : "newest")}
                    label={t(language, "Sort")}
                    value={comments.commentsSort === "newest" ? t(language, "Newest") : t(language, "Oldest")}
                />
            </PanelSection>
            <PanelSection title={t(language, "Comments")}>
                <CommentsList
                    comments={comments.comments}
                    language={language}
                    uiSize={settings.uiSize}
                    showIcons={settings.showIcons}
                    focusKeyPrefix="eventviewer:comment"
                    surfaceKey="comments:event"
                    onCommentClick={openComment}
                    dynamicLoading={settings.dynamicComments}
                    dynamicSentinelRootMargin={settings.dynamicCommentsSentinelRootMargin}
                    loading={comments.commentsLoading}
                    loadingMore={comments.commentsLoadingMore}
                    hasMore={comments.commentsHasMore}
                    error={comments.commentsError}
                    onLoadMore={commentActions.loadMoreComments}
                    emptyMessage={t(language, "No comments yet for this event.")}
                    claimedCard={comments.commentsCardClaim
                        ? { ...comments.commentsCardClaim, onSpent: commentActions.spendCommentsCardClaim }
                        : undefined}
                    restoredWindow={comments.commentsWindow}
                />
            </PanelSection>
        </>
    );

    const tabs = TABS.map((entry) => (
        <SubTabButton
            key={entry.value}
            label={checklist && entry.value === "achievements" ? t(language, "Checklist") : t(language, entry.labelKey)}
            active={tab === entry.value}
            onClick={() => actions.onChangeTab(entry.value)}
            focusKey={entry.focusKey}
        />
    ));

    const tabKey = `eventviewer:tab:${tab}`;

    const page = (
        <Focusable flow-children="column" onButtonDown={handleButtonDown}>
            <div ref={pageRef}>
                <PanelSection>
                    <PageNavStrip
                        title={t(language, "Event")}
                        buttonSpacing={settings.buttonSpacing}
                        onHome={actions.onHome}
                    />
                    <BackButton
                        label={t(language, "← Back")}
                        focusKey="eventviewer:back"
                        navAutoFocus={!restorePending}
                        buttonSpacing={settings.buttonSpacing}
                        onClick={actions.onBack}
                    />
                    {viewer.needsSettings && (
                        <PanelSectionRow>
                            <div style={bodyTextStyle()}>
                                {t(language, "Credentials are missing. Set them up under Options.")}
                            </div>
                        </PanelSectionRow>
                    )}
                    <EventViewerHeader
                        language={language}
                        eventGameId={eventGameId}
                        title={title}
                        imageIcon={row?.imageIcon ?? detail?.imageIcon ?? null}
                        row={row}
                        newestSiteGameId={events.state.newestSiteGameId}
                        completion={completion}
                        showIcons={settings.showIcons}
                        progressText={progressText}
                        progressFraction={progressFraction}
                        progressPending={progressPending}
                        buttons={buttons}
                        buttonClaim={buttonClaim}
                        tabs={tabs}
                    />
                    {tab === "achievements" && checklist && (
                        <Focusable key={tabKey}>
                            <EventChecklistBody
                                language={language}
                                eventGameId={eventGameId}
                                cards={cards}
                                games={viewer.games}
                                progress={viewer.checklistProgress}
                                progressLoading={viewer.checklistLoading}
                                progressError={viewer.checklistError}
                                ruleText={checklist.rule.text}
                                masteryMarkable={checklistMasteryMarkable(checklist.rule)}
                                undated={activeFrom === null}
                                restoreGameId={rowRestoreSettled ? null : restoreRowId}
                                onRestoreSettled={() => setRowRestoreSettled(true)}
                                onOpenGame={openChecklistGame}
                                onSetTick={(gameId, value) => events.actions.setTick(eventGameId, gameId, value)}
                                onRequestFocus={actions.onRequestFocus}
                            />
                        </Focusable>
                    )}
                </PanelSection>
                {tab === "achievements" && !checklist && (
                    <Focusable key={tabKey}>
                        <EventAchievementsBody
                            language={language}
                            eventGameId={eventGameId}
                            payload={payload && payload.gameId === eventGameId ? payload : null}
                            payloadLoading={viewer.payloadLoading}
                            payloadError={viewer.payloadError}
                            sources={sources}
                            sourceGames={viewer.games}
                            sourceBanners={sourceBanners}
                            restoreAchievementId={rowRestoreSettled ? null : restoreRowId}
                            onRestoreSettled={() => setRowRestoreSettled(true)}
                            onOpenAchievement={openAchievement}
                            onOpenGame={(achievement) => void openSourceGame(achievement)}
                            onRequestFocus={actions.onRequestFocus}
                        />
                    </Focusable>
                )}
                {tab === "comments" && <Focusable key={tabKey}>{commentsBody}</Focusable>}
            </div>
        </Focusable>
    );

    return (
        <RestoreCurtain armed={curtainArmed} settled={curtainSettled} covered={state.panelOverlayVisible}>
            {page}
        </RestoreCurtain>
    );
}

export default EventViewerPage;
