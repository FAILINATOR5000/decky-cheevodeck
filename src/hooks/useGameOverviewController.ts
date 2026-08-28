import { getGameComments } from "../api";
import type { LanguageCode } from "../locales";
import type {
    GameOverviewSubView,
    Payload
} from "../types";
import { useGamePayload } from "./useGamePayload";
import { useGameCommentsController } from "./useGameCommentsController";
import { useGameHashesController } from "./useGameHashesController";

export type CommentsSort = "newest" | "oldest";

export type UseGameOverviewControllerOptions = {
    isActive: boolean;
    subView: GameOverviewSubView;
    gameId: number | null;
    viewedUsername: string | null;
    viewedUserRef?: string | null;
    seedPayload?: Payload | null;
    seedIsProvisional?: boolean;
    dynamicComments: boolean;
    language: LanguageCode;
    dynamicCommentsInitialRows: number;
    dynamicCommentsRowStep: number;
    legacyCommentsLoading: boolean;
};

export function useGameOverviewController(options: UseGameOverviewControllerOptions) {
    const {
        isActive,
        subView,
        gameId,
        language,
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
        isActive: isActive && subView === "comments",
        id: gameId,
        ipc: getGameComments,
        dynamicComments,
        dynamicCommentsInitialRows,
        dynamicCommentsRowStep,
        surfaceKey: "comments:overview",
        legacyLoading: legacyCommentsLoading,
        loadErrorMessage: "Couldn't load this game's comments.",
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

    const {
        results: hashes,
        loading: hashesLoading,
        error: hashesError,
        needsSettings: hashesNeedsSettings,
        downloadingMd5: hashesDownloadingMd5,
        downloadPatch: downloadHashPatch
    } = useGameHashesController({
        isActive: isActive && subView === "hashes",
        gameId,
        language
    });

    const needsSettings = payloadNeedsSettings || commentsNeedsSettings || hashesNeedsSettings;

    return {
        state: {
            loadedPayload,
            payloadLoading,
            payloadError,
            needsSettings,
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
            hashes,
            hashesLoading,
            hashesError,
            hashesDownloadingMd5
        },
        actions: {
            downloadHashPatch,
            setCommentsSort,
            loadFirstCommentsPage,
            loadMoreComments,
            captureComments,
            spendCommentsCardClaim,
            spendCommentsPostClaim
        }
    };
}
