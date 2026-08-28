import { getAchievementComments } from "../api";
import type { Payload } from "../types";
import { useGamePayload } from "./useGamePayload";
import { useGameCommentsController } from "./useGameCommentsController";

export type CommentsSort = "newest" | "oldest";

export type UseAchievementOverviewControllerOptions = {
    isActive: boolean;
    achievementId: number | null;
    gameId: number | null;
    viewedUsername: string | null;
    viewedUserRef?: string | null;
    seedPayload?: Payload | null;
    seedIsProvisional?: boolean;
    dynamicComments: boolean;
    dynamicCommentsInitialRows: number;
    dynamicCommentsRowStep: number;
    legacyCommentsLoading: boolean;
};

export function useAchievementOverviewController(options: UseAchievementOverviewControllerOptions) {
    const {
        isActive,
        achievementId,
        gameId,
        viewedUsername,
        viewedUserRef,
        seedPayload,
    seedIsProvisional,
        dynamicComments,
        dynamicCommentsInitialRows,
        dynamicCommentsRowStep,
        legacyCommentsLoading
    } = options;

    const {
        payload: loadedPayload,
        loading: payloadLoading,
        error: payloadError,
        needsSettings: payloadNeedsSettings
    } = useGamePayload({
        isActive,
        viewedUsername,
        viewedUserRef,
        gameId,
        seedPayload,
        seedIsProvisional
    });

    const commentsController = useGameCommentsController({
        isActive,
        id: achievementId,
        ipc: getAchievementComments,
        dynamicComments,
        dynamicCommentsInitialRows,
        dynamicCommentsRowStep,
        surfaceKey: "comments:ao",
        legacyLoading: legacyCommentsLoading,
        loadErrorMessage: "Couldn't load this achievement's comments.",
        loadMoreErrorMessage: "Couldn't load more comments."
    });
    const {
        state: {
            comments,
            commentsLoading,
            commentsLoadingMore,
            commentsError,
            commentsTotal,
            commentsHasMore,
            commentsSort,
            commentsLoaded,
            commentsCardClaim,
            commentsPostClaim,
            commentsWindow,
            commentsNeedsSettings
        },
        actions: {
            setCommentsSort,
            loadFirstCommentsPage,
            loadMoreComments,
            captureComments,
            spendCommentsCardClaim,
            spendCommentsPostClaim
        }
    } = commentsController;

    const needsSettings = payloadNeedsSettings || commentsNeedsSettings;

    return {
        state: {
            loadedPayload,
            payloadLoading,
            payloadError,
            comments,
            commentsLoading,
            commentsLoadingMore,
            commentsError,
            commentsTotal,
            commentsHasMore,
            commentsSort,
            commentsLoaded,
            commentsCardClaim,
            commentsPostClaim,
            commentsWindow,
            needsSettings
        },
        actions: {
            setCommentsSort,
            loadFirstCommentsPage,
            loadMoreComments,
            captureComments,
            spendCommentsCardClaim,
            spendCommentsPostClaim
        }
    };
}
