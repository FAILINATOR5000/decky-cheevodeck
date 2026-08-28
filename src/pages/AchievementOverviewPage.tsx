import { useEffect, useState, type CSSProperties } from "react";
import { PanelSection, PanelSectionRow } from "@decky/ui";
import { AchievementList } from "../components/achievements/AchievementList";
import { BackButton } from "../components/ui/BackButton";
import { CommentsList } from "../components/comments/CommentsList";
import { CommentActionStrip } from "../components/comments/CommentActionStrip";
import { ErrorText } from "../components/ui/ErrorText";
import { FocusClaim } from "../components/ui/FocusClaim";
import { RestoreCurtain } from "../components/ui/RestoreCurtain";
import { GameContextBanner } from "../components/social/GameContextBanner";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { LabeledRow } from "../components/ui/LabeledRow";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { ViewingFriendBanner } from "../components/social/ViewingFriendBanner";
import type {
    AchievementOverviewSnapshot,
    AchievementRow,
    AchievementStyle,
    AotwComment,
    ButtonSpacing,
    GameComment,
    Payload,
    UiSize
} from "../types";
import type { LanguageCode } from "../locales";
import { localizeRuntimeText, t } from "../locales";
import type { CommentsSort } from "../hooks/useAchievementOverviewController";
import type { RestoredCommentsWindow } from "../hooks/useCommentsWindow";
import { useThreadSubscription } from "../hooks/useThreadSubscription";
import { regularButtonSpacingStyle, bodyTextStyle } from "../utils/style";

type AchievementOverviewPageProps = {
    view: string;
    language: LanguageCode;
    uiSize: UiSize;
    blockPadding: number;
    buttonSpacing: ButtonSpacing;
    showIcons: boolean;
    showRetroPoints: boolean;
    achievementStyle: AchievementStyle;

    viewedUsername: string | null;

    achievementSnapshot: AchievementOverviewSnapshot | null;
    achievementId: number | null;
    gameId: number | null;
    loadedPayload: Payload | null;

    onBack: () => void;
    onCommentClick: (comment: AotwComment | GameComment) => void | Promise<void>;
    onPostComment: () => void | Promise<void>;
    onAchievementClick: () => void | Promise<void>;

    comments: GameComment[];
    commentsLoading: boolean;
    commentsLoadingMore: boolean;
    commentsError: string | null;
    commentsHasMore: boolean;
    commentsSort: CommentsSort;
    commentsLoaded: boolean;
    commentsCardClaim?: {
        slotIndex: number;
        token: number;
        armed: boolean;
    };
    onSpendCommentsCardClaim: () => void;
    commentsPostClaim?: {
        token: number;
        armed: boolean;
    };
    onSpendCommentsPostClaim: () => void;
    panelOverlayVisible: boolean;
    restorePending: boolean;
    holdCommentsBody: boolean;
    commentsWindow: RestoredCommentsWindow | null;
    needsSettings: boolean;

    onChangeCommentsSort: (next: CommentsSort) => void;
    onLoadMoreComments: () => void | Promise<void>;

    dynamicComments: boolean;
    dynamicCommentsSentinelRootMargin: number;

    onHome: () => void | Promise<void>;
};

function buildHeaderPayload(
    achievementId: number | null,
    loadedPayload: Payload | null,
    snapshot: AchievementOverviewSnapshot | null,
    gameId: number | null
): Payload | null {
    if (loadedPayload && achievementId != null) {
        const row = loadedPayload.achievements.find((a) => a.id === achievementId);
        if (row) {
            return {
                gameId,
                title: null,
                consoleName: null,
                numAchievements: 1,
                numAwardedToUser: row.dateEarned ? 1 : 0,
                numDistinctPlayers: loadedPayload.numDistinctPlayers ?? null,
                numDistinctPlayersCasual: loadedPayload.numDistinctPlayersCasual ?? null,
                achievements: [row]
            };
        }
    }
    if (!snapshot) {
        return null;
    }
    const row: AchievementRow = {
        id: snapshot.id,
        title: snapshot.title,
        description: snapshot.description,
        points: snapshot.points,
        trueRatio: 0,
        badgeName: snapshot.badgeName,
        badgeUrl: snapshot.imageIcon ?? null,
        displayOrder: 0,
        type: null,
        dateEarned: snapshot.isLocked ? null : snapshot.dateEarned,
        dateEarnedHardcore: snapshot.isLocked ? null : snapshot.dateEarnedHardcore ?? null,
        measured: false,
        numAwarded: 0,
        numAwardedHardcore: 0
    };
    return {
        gameId,
        title: null,
        consoleName: null,
        numAchievements: 1,
        numAwardedToUser: snapshot.isLocked ? 0 : 1,
        numDistinctPlayers: null,
        numDistinctPlayersCasual: null,
        achievements: [row]
    };
}

function AchievementOverviewPage(props: AchievementOverviewPageProps) {
    const {
        view,
        language,
        uiSize,
        blockPadding,
        buttonSpacing,
        showIcons,
        showRetroPoints,
        achievementStyle,
        viewedUsername,
        achievementSnapshot,
        achievementId,
        gameId,
        loadedPayload,
        onBack,
        onCommentClick,
        onAchievementClick,
        onPostComment,
        comments,
        commentsLoading,
        commentsLoadingMore,
        commentsError,
        commentsHasMore,
        commentsSort,
        commentsLoaded,
        commentsCardClaim,
        onSpendCommentsCardClaim,
        commentsPostClaim,
        onSpendCommentsPostClaim,
        panelOverlayVisible,
        restorePending,
        holdCommentsBody,
        commentsWindow,
        needsSettings,
        onChangeCommentsSort,
        onLoadMoreComments,
        dynamicComments,
        dynamicCommentsSentinelRootMargin,
        onHome,
    } = props;

    const { isSubscribed, subscribeError, onToggleSubscribe } = useThreadSubscription({
        language,
        kind: "achievement",
        id: achievementId,
        buildEntry: () => {
            if (achievementId == null) {
                return null;
            }
            const row = loadedPayload?.achievements.find((a) => a.id === achievementId);
            const title = row?.title ?? achievementSnapshot?.title ?? "";
            const badgeUrl = row?.badgeUrl ?? achievementSnapshot?.imageIcon ?? "";
            const badgeName = row?.badgeName ?? achievementSnapshot?.badgeName ?? "";
            if (!title) {
                return null;
            }
            return {
                kind: "achievement",
                id: achievementId,
                gameId: gameId ?? achievementId,
                title,
                gameTitle: loadedPayload?.title ?? "",
                console: loadedPayload?.consoleName ?? "",
                iconUrl: badgeUrl,
                badgeName,
                seedComments: comments,
                seedSort: commentsSort,
                seedLoaded: commentsLoaded
            };
        }
    });

    if (view !== "achievementOverview") {
        return null;
    }

    function handleCommentsSortCycle() {
        onChangeCommentsSort(commentsSort === "newest" ? "oldest" : "newest");
    }

    if (needsSettings) {
        return (
            <PanelSection>
                <PageNavStrip
                    title={t(language, "Overview")}
                    buttonSpacing={buttonSpacing}
                    onHome={onHome}
                />
                <BackButton
                    label={t(language, "← Back")}
                    focusKey="ao:back"
                    navAutoFocus
                    buttonSpacing={buttonSpacing}
                    onClick={onBack}
                />
                <ViewingFriendBanner
                    username={viewedUsername}
                    kind="achievement"
                    language={language}
                />
                <PanelSectionRow>
                    <div style={bodyTextStyle()}>
                        {t(language, "Credentials are missing. Set them up under Options.")}
                    </div>
                </PanelSectionRow>
            </PanelSection>
        );
    }

    const headerPayload = buildHeaderPayload(
        achievementId,
        loadedPayload,
        achievementSnapshot,
        gameId
    );
    const buttonOuterStyle = regularButtonSpacingStyle(buttonSpacing);
    const firstRowOuterStyle: CSSProperties = {
        ...buttonOuterStyle,
        marginTop: "8px"
    };

    const [settledAchievementId, setSettledAchievementId] = useState<number | null>(null);
    useEffect(() => {
        if (commentsLoaded && achievementId != null) {
            setSettledAchievementId(achievementId);
        }
    }, [commentsLoaded, achievementId]);
    const commentsSettled = achievementId != null
        && (commentsLoaded || settledAchievementId === achievementId);

    const commentsRegionReady = commentsSettled || Boolean(commentsError) || restorePending;

    const commentsEmpty = commentsSettled && comments.length === 0 && !commentsLoading && !commentsError;

    const restoreCurtainArmed = restorePending && !panelOverlayVisible;
    const restoreCurtainCovered = panelOverlayVisible || (commentsLoading && !commentsLoaded);
    const restoreCurtainClaim = commentsCardClaim ?? commentsPostClaim;
    const restoreCurtainSettled = !holdCommentsBody
        && (restoreCurtainClaim?.token ?? 0) > 0
        && !restoreCurtainClaim?.armed;

    if (holdCommentsBody && !commentsLoaded) {
        const restoreShell = (
            <PanelSection>
                <PageNavStrip
                    title={t(language, "Overview")}
                    buttonSpacing={buttonSpacing}
                    onHome={onHome}
                />
                <BackButton
                    label={t(language, "← Back")}
                    focusKey="ao:back"
                    buttonSpacing={buttonSpacing}
                    onClick={onBack}
                />
                <PanelSectionRow>
                    <InlineSpinner label={t(language, "Loading comments...")} />
                </PanelSectionRow>
            </PanelSection>
        );
        return (
            <RestoreCurtain
                armed={restoreCurtainArmed}
                settled={restoreCurtainSettled}
                covered={restoreCurtainCovered}
            >
                {restoreShell}
            </RestoreCurtain>
        );
    }

    const page = (
        <>
            <PanelSection>
                <PageNavStrip
                    title={t(language, "Overview")}
                    buttonSpacing={buttonSpacing}
                    onHome={onHome}
                />
                <BackButton
                    label={t(language, "← Back")}
                    focusKey="ao:back"
                    navAutoFocus={!restorePending}
                    buttonSpacing={buttonSpacing}
                    onClick={onBack}
                />
                <ViewingFriendBanner
                    username={viewedUsername}
                    kind="achievement"
                    language={language}
                />
                <GameContextBanner
                    gameId={gameId}
                    title={loadedPayload?.title}
                    imageIcon={loadedPayload?.gameId === gameId ? loadedPayload?.imageIcon : null}
                    showIcons={showIcons}
                />
            </PanelSection>

            {headerPayload ? (
                <AchievementList
                    key={`ao:row:${headerPayload.achievements[0]?.id ?? "none"}`}
                    payload={headerPayload}
                    language={language}
                    showIcons={showIcons}
                    achievementStyle={achievementStyle}
                    uiSize={uiSize}
                    topPadding={0}
                    blockPadding={blockPadding}
                    showAll={true}
                    mode="overview"
                    trackedIds={[]}
                    showRetroPoints={showRetroPoints}
                    titleOverride={t(language, "Achievement Info")}
                    onAchievementClick={() => onAchievementClick()}
                />
            ) : (
                <PanelSectionRow>
                    <div style={bodyTextStyle()}>
                        {t(language, "No achievement to display.")}
                    </div>
                </PanelSectionRow>
            )}

            {commentsEmpty ? (
                <PanelSection>
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>
                            {t(language, "No comments yet for this achievement.")}
                        </div>
                    </PanelSectionRow>
                    {subscribeError ? (
                        <PanelSectionRow>
                            <ErrorText>{localizeRuntimeText(language, subscribeError)}</ErrorText>
                        </PanelSectionRow>
                    ) : null}
                    <FocusClaim
                        token={commentsPostClaim?.token ?? 0}
                        armed={commentsPostClaim?.armed ?? false}
                        onSpent={onSpendCommentsPostClaim}
                    >
                        <CommentActionStrip
                            language={language}
                            isSubscribed={isSubscribed}
                            onPost={onPostComment}
                            onToggleSubscribe={onToggleSubscribe}
                            postFocusKey="ao:comments:post"
                            subscribeFocusKey="ao:comments:subscribe"
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
                        {
}
                        <FocusClaim
                            token={commentsPostClaim?.token ?? 0}
                            armed={commentsPostClaim?.armed ?? false}
                            onSpent={onSpendCommentsPostClaim}
                        >
                            <CommentActionStrip
                                language={language}
                                isSubscribed={isSubscribed}
                                onPost={onPostComment}
                                onToggleSubscribe={onToggleSubscribe}
                                postFocusKey="ao:comments:post"
                                subscribeFocusKey="ao:comments:subscribe"
                            />
                        </FocusClaim>
                    </PanelSection>

                    {commentsRegionReady ? (
                        <>
                            <PanelSection title={t(language, "View Options")}>
                                <LabeledRow
                                    outerStyle={firstRowOuterStyle}
                                    focusKey="ao:comments:sort"
                                    onClick={handleCommentsSortCycle}
                                    label={t(language, "Sort")}
                                    value={commentsSort === "newest"
                                        ? t(language, "Newest")
                                        : t(language, "Oldest")}
                                />
                            </PanelSection>

                            <PanelSection title={t(language, "Comments")}>
                                <CommentsList
                                    comments={comments}
                                    language={language}
                                    uiSize={uiSize}
                                    showIcons={showIcons}
                                    focusKeyPrefix="ao:comment"
                                    surfaceKey="comments:ao"
                                    onCommentClick={onCommentClick}
                                    dynamicLoading={dynamicComments}
                                    dynamicSentinelRootMargin={dynamicCommentsSentinelRootMargin}
                                    loading={commentsLoading}
                                    loadingMore={commentsLoadingMore}
                                    hasMore={commentsHasMore}
                                    error={commentsError}
                                    onLoadMore={onLoadMoreComments}
                                    emptyMessage={t(language, "No comments yet for this achievement.")}
                                    claimedCard={commentsCardClaim && {
                                        ...commentsCardClaim,
                                        onSpent: onSpendCommentsCardClaim
                                    }}
                                    restoredWindow={commentsWindow}
                                />
                            </PanelSection>
                        </>
                    ) : null}
                </>
            )}
        </>
    );

    return (
        <RestoreCurtain
            armed={restoreCurtainArmed}
            settled={restoreCurtainSettled}
            covered={restoreCurtainCovered}
        >
            {page}
        </RestoreCurtain>
    );
}

export default AchievementOverviewPage;
