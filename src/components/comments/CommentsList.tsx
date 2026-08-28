import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { PanelSectionRow } from "@decky/ui";
import { logCommentsDebug } from "../../api";
import type { AotwComment, CommentSurfaceKey, GameComment, UiSize } from "../../types";
import type { LanguageCode } from "../../locales";
import { localizeRuntimeText, t } from "../../locales";
import { commentIdentity } from "../../utils/commentIdentity";
import { currentJumpToTopToken } from "../../utils/jumpToTop";
import { useCommentsWindow, type RestoredCommentsWindow } from "../../hooks/useCommentsWindow";
import { CommentCard } from "./CommentCard";
import { ErrorText } from "../ui/ErrorText";
import { FocusClaim } from "../ui/FocusClaim";
import { InlineSpinner } from "../ui/InlineSpinner";
import { achievementUiMetrics, bodyTextStyle } from "../../utils/style";

export type CommentsListProps = {
    comments: GameComment[];
    language: LanguageCode;
    uiSize: UiSize;
    showIcons: boolean;
    focusKeyPrefix: string;
    surfaceKey: CommentSurfaceKey;
    onCommentClick: (comment: AotwComment | GameComment) => void | Promise<void>;
    dynamicLoading: boolean;
    dynamicSentinelRootMargin: number;
    loading: boolean;
    loadingMore: boolean;
    hasMore: boolean;
    error: string | null;
    onLoadMore: () => void | Promise<void>;
    emptyMessage: string;
    claimedCard?: {
        slotIndex: number;
        token: number;
        armed: boolean;
        onSpent: () => void;
    };
    restoredWindow?: RestoredCommentsWindow | null;
};

export function CommentsList(props: CommentsListProps) {
    const {
        comments,
        language,
        uiSize,
        showIcons,
        focusKeyPrefix,
        surfaceKey,
        onCommentClick,
        dynamicLoading,
        dynamicSentinelRootMargin,
        loading,
        loadingMore,
        hasMore,
        error,
        onLoadMore,
        emptyMessage,
        claimedCard,
        restoredWindow
    } = props;

    const {
        mountedComments,
        windowStart,
        spacerPx,
        spacerRef,
        setUpMarker,
        setDownMarker,
        setPageMarker,
        showUpMarker,
        showDownMarker,
        showPageMarker,
        onCardFocus
    } = useCommentsWindow({
        comments,
        dynamicLoading,
        sentinelRootMargin: dynamicSentinelRootMargin,
        surfaceKey,
        focusKeyPrefix,
        loading,
        loadingMore,
        hasMore,
        onLoadMore,
        restoredWindow: restoredWindow ?? null,
        claimedSlotIndex: claimedCard ? claimedCard.slotIndex : null
    });

    const clickRef = useRef(onCommentClick);
    clickRef.current = onCommentClick;
    const handleCommentClick = useCallback(function handleCommentClick(comment: AotwComment | GameComment) {
        void clickRef.current(comment);
    }, []);

    const cardMetrics = useMemo(() => achievementUiMetrics(uiSize), [uiSize]);

    const listHeightRef = useRef(0);
    useLayoutEffect(function rememberListHeight() {
        const container = spacerRef.current?.parentElement;
        if (!container) {
            return;
        }
        const cards = container.querySelectorAll(`[data-focus-key^="${focusKeyPrefix}:"]`);
        const first = cards[0];
        const last = cards[cards.length - 1];
        if (!first || !last) {
            return;
        }
        listHeightRef.current = Math.round(
            last.getBoundingClientRect().bottom - first.getBoundingClientRect().top
        );
    });

    useEffect(function pullRestoredCardIntoView() {
        if (!restoredWindow || !claimedCard) {
            return;
        }
        const wanted = `${focusKeyPrefix}:${claimedCard.slotIndex}`;
        const jumpTokenAtArm = currentJumpToTopToken();
        const timer = window.setTimeout(() => {
            if (currentJumpToTopToken() !== jumpTokenAtArm) {
                return;
            }
            const container = spacerRef.current?.parentElement;
            const doc = spacerRef.current?.ownerDocument;
            if (!container || !doc) {
                return;
            }
            const target = container.querySelector(`[data-focus-key="${wanted}"]`);
            if (!target) {
                return;
            }
            const box = target.getBoundingClientRect();
            const viewportHeight = doc.documentElement.clientHeight;
            if (box.top >= 0 && box.bottom <= viewportHeight) {
                return;
            }
            logCommentsDebug("restore-scroll", surfaceKey, `${wanted} was at y=${Math.round(box.top)}`);
            target.scrollIntoView({ block: "center" });
        }, 200);
        return () => {
            window.clearTimeout(timer);
        };
    }, [restoredWindow, claimedCard?.token, claimedCard?.slotIndex, focusKeyPrefix, surfaceKey]);

    if (loading && comments.length === 0) {
        return (
            <>
                <PanelSectionRow>
                    <InlineSpinner label={t(language, "Loading comments...")} />
                </PanelSectionRow>
                {listHeightRef.current > 0 && (
                    <div style={{ width: "100%", height: `${listHeightRef.current}px` }} />
                )}
            </>
        );
    }

    if (error && comments.length === 0) {
        return (
            <PanelSectionRow>
                <ErrorText>{localizeRuntimeText(language, error)}</ErrorText>
            </PanelSectionRow>
        );
    }

    if (comments.length === 0) {
        return (
            <PanelSectionRow>
                <div style={bodyTextStyle()}>{emptyMessage}</div>
            </PanelSectionRow>
        );
    }

    return (
        <>
            {error && (
                <PanelSectionRow>
                    <ErrorText>{localizeRuntimeText(language, error)}</ErrorText>
                </PanelSectionRow>
            )}
            {
}
            {
}
            <div ref={spacerRef} data-comment-spacer="" style={{ width: "100%", height: `${spacerPx}px` }} />
            {showUpMarker && (
                <div ref={setUpMarker} style={{ width: "100%", height: "1px" }} />
            )}
            {mountedComments.map((comment, offset) => {
                const index = windowStart + offset;
                const cardKey = commentIdentity(comment);
                const card = (
                    <CommentCard
                        key={cardKey}
                        comment={comment}
                        index={index}
                        onGamepadFocusIndex={onCardFocus}
                        language={language}
                        metrics={cardMetrics}
                        showIcons={showIcons}
                        focusKey={`${focusKeyPrefix}:${index}`}
                        onClick={handleCommentClick}
                    />
                );

                if (claimedCard && claimedCard.slotIndex === index) {
                    return (
                        <FocusClaim
                            key={cardKey}
                            token={claimedCard.token}
                            armed={claimedCard.armed}
                            onSpent={claimedCard.onSpent}
                        >
                            {card}
                        </FocusClaim>
                    );
                }

                return card;
            })}
            {
}
            {showDownMarker && (
                <div ref={setDownMarker} style={{ width: "100%", height: "1px" }} />
            )}
            {loadingMore && (
                <PanelSectionRow>
                    <InlineSpinner label={t(language, "Loading more comments...")} />
                </PanelSectionRow>
            )}
            {
}
            {showPageMarker && (
                <div ref={setPageMarker} style={{ width: "100%", height: "1px" }} />
            )}
        </>
    );
}
