import { useEffect, useRef, useState, type CSSProperties } from "react";
import { DialogButton, Focusable, PanelSection, PanelSectionRow } from "@decky/ui";
import { AchievementList } from "../components/achievements/AchievementList";
import { AwardStatusBadge } from "../components/achievements/AwardStatusBadge";
import { BackButton } from "../components/ui/BackButton";
import { ErrorText } from "../components/ui/ErrorText";
import { FadeImage } from "../components/ui/FadeImage";
import { FocusableItem } from "../components/ui/FocusableItem";
import { CommentsList } from "../components/comments/CommentsList";
import { CommentActionStrip } from "../components/comments/CommentActionStrip";
import { FocusClaim } from "../components/ui/FocusClaim";
import { RestoreCurtain } from "../components/ui/RestoreCurtain";
import { HashesList } from "../components/games/HashesList";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { LabeledRow } from "../components/ui/LabeledRow";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { ViewingFriendBanner } from "../components/social/ViewingFriendBanner";
import { SubTabIconButton, subTabIcon, type SubTabIconKind } from "../components/ui/SubTabIconButton";
import type {
    AchievementRow,
    AchievementStyle,
    AotwComment,
    ButtonSpacing,
    GameComment,
    GameOverviewSubView,
    MainAchievementFilter,
    Payload,
    UiSize
} from "../types";
import type { AchievementSort } from "../types";
import type { LanguageCode } from "../locales";
import { localizeRuntimeText, t } from "../locales";
import type { CommentsSort } from "../hooks/useGameOverviewController";
import type { RestoredCommentsWindow } from "../hooks/useCommentsWindow";
import { useThreadSubscription } from "../hooks/useThreadSubscription";
import { getCachedGameImageDataUri, getGameImageCached, type GameHashRow } from "../api";
import {
    achievementSortLabel,
    mainAchievementFilterLabel,
    nextAchievementSort,
    nextMainAchievementFilter,
    payloadAchievementSummaryLabel
} from "../utils/achievements";
import { bodyTextStyle } from "../utils/style";
import { headerSize } from "../utils/scale";
import { consoleInlineName, consoleSearchName } from "../utils/consoles";
import { openExternalUrl, youtubeSearchUrl } from "../utils/navigation";
import { formatReleaseDate } from "../utils/format";
import { logError } from "../utils/errors";
import { BUTTON_BUMPER_LEFT, BUTTON_BUMPER_RIGHT } from "../utils/gamepadButtons";
import { playOkSound } from "../utils/navSound";

const SUB_TABS: { value: GameOverviewSubView; focusKey: string; icon: SubTabIconKind }[] = [
    { value: "achievements", focusKey: "gameoverview:subtab:achievements", icon: "trophy" },
    { value: "comments", focusKey: "gameoverview:subtab:comments", icon: "comment" },
    { value: "hashes", focusKey: "gameoverview:subtab:hashes", icon: "hash" }
];

type LabeledOptionRowProps = {
    label: string;
    value: string;
    focusKey: string;
    onClick: () => void;
    outerStyle?: CSSProperties;
};

function LabeledOptionRow(props: LabeledOptionRowProps) {
    return (
        <PanelSectionRow>
            <FocusableItem
                outerStyle={props.outerStyle}
                focusKey={props.focusKey}
                onClick={props.onClick}
            >
                <div
                    style={{
                        width: "100%",
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "8px"
                    }}
                >
                    <span style={{ fontWeight: 700, textAlign: "left" }}>{props.label}</span>
                    <span
                        style={{
                            ...bodyTextStyle(),
                            minWidth: 0,
                            whiteSpace: "normal",
                            overflowWrap: "break-word",
                            textAlign: "right"
                        }}
                    >
                        {props.value}
                    </span>
                </div>
            </FocusableItem>
        </PanelSectionRow>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function SearchIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M505 442.7L405.3 343c-4.5-4.5-10.6-7-17-7H372c27.6-35.3 44-79.7 44-128C416 93.1 322.9 0 208 0S0 93.1 0 208s93.1 208 208 208c48.3 0 92.7-16.4 128-44v16.3c0 6.4 2.5 12.5 7 17l99.7 99.7c9.4 9.4 24.6 9.4 33.9 0l28.3-28.3c9.4-9.4 9.4-24.6.1-34zM208 336c-70.7 0-128-57.2-128-128 0-70.7 57.2-128 128-128 70.7 0 128 57.2 128 128 0 70.7-57.2 128-128 128z" />
        </svg>
    );
}

function LeaderboardIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 24 24"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M3 10h5v11H3zM9.5 6h5v15h-5zM16 13h5v8h-5z" />
        </svg>
    );
}

function ChevronLeftIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            xmlns="http://www.w3.org/2000/svg"
            focusable="false"
        >
            <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 5l-7 7 7 7"
            />
        </svg>
    );
}

function ChevronRightIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            xmlns="http://www.w3.org/2000/svg"
            focusable="false"
        >
            <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5l7 7-7 7"
            />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function VideoIcon({ size = 64 }: { size?: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 576 512"
            width={size}
            height={size}
            fill="currentColor"
            focusable="false"
        >
            <path d="M0 128C0 92.7 28.7 64 64 64H320c35.3 0 64 28.7 64 64V384c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V128zM559.1 99.8c10.4 5.6 16.9 16.4 16.9 28.2V384c0 11.8-6.5 22.6-16.9 28.2s-23 5-32.9-1.6l-96-64L416 337.1V320 192 174.9l14.2-9.5 96-64c9.8-6.5 22.4-7.2 32.9-1.6z" />
        </svg>
    );
}

const NAV_ENTER_PREFERRED_CHILD = 4;

function InfoRow(props: { label: string; value: string }) {
    if (!props.value) {
        return null;
    }
    return (
        <div
            style={{
                width: "100%",
                display: "flex",
                justifyContent: "space-between",
                gap: "10px",
                alignItems: "baseline"
            }}
        >
            <span style={{ fontWeight: 700, flexShrink: 0 }}>{props.label}</span>
            <span style={{ ...bodyTextStyle(), textAlign: "right" }}>
                {props.value}
            </span>
        </div>
    );
}

type GameOverviewPageProps = {
    view: string;
    language: LanguageCode;
    uiSize: UiSize;
    blockPadding: number;
    buttonSpacing: ButtonSpacing;
    showIcons: boolean;
    showRetroPoints: boolean;
    achievementStyle: AchievementStyle;

    viewedUsername: string | null;

    gameId: number | null;
    subView: GameOverviewSubView;
    onChangeSubView: (next: GameOverviewSubView) => void;
    onBack: () => void;

    loadedPayload: Payload | null;
    payloadLoading: boolean;
    payloadError: string | null;
    needsSettings: boolean;
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
    hashes: GameHashRow[];
    hashesLoading: boolean;
    hashesError: string | null;
    hashesDownloadingMd5: string | null;

    onChangeCommentsSort: (next: CommentsSort) => void;
    onLoadMoreComments: () => void | Promise<void>;
    onDownloadHashPatch: (row: GameHashRow) => void;
    onCommentClick: (comment: AotwComment | GameComment) => void | Promise<void>;
    onAchievementClick: (achievement: AchievementRow) => void | Promise<void>;
    onPostComment: () => void | Promise<void>;
    onGameClick: () => void | Promise<void>;

    onOpenGameSearch: () => void;

    onOpenLeaderboards: () => void | Promise<void>;

    dynamicComments: boolean;
    dynamicCommentsSentinelRootMargin: number;

    onHome: () => void | Promise<void>;
};

function GameOverviewPage(props: GameOverviewPageProps) {
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
        gameId,
        subView,
        onChangeSubView,
        onBack,
        loadedPayload,
        payloadLoading,
        payloadError,
        needsSettings,
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
        hashes,
        hashesLoading,
        hashesError,
        hashesDownloadingMd5,
        onChangeCommentsSort,
        onLoadMoreComments,
        onDownloadHashPatch,
        onCommentClick,
        onAchievementClick,
        onPostComment,
        onGameClick,
        onOpenGameSearch,
        onOpenLeaderboards,
        dynamicComments,
        dynamicCommentsSentinelRootMargin,
        onHome,
    } = props;

    const { isSubscribed, subscribeError, onToggleSubscribe } = useThreadSubscription({
        language,
        kind: "game",
        id: gameId,
        buildEntry: () => {
            if (gameId == null || !loadedPayload) {
                return null;
            }
            const gameTitle = loadedPayload.title ?? "";
            return {
                kind: "game",
                id: gameId,
                gameId,
                title: gameTitle,
                gameTitle,
                console: loadedPayload.consoleName ?? "",
                iconUrl: loadedPayload.imageIcon ?? "",
                badgeName: "",
                seedComments: comments,
                seedSort: commentsSort,
                seedLoaded: commentsLoaded
            };
        }
    });

    function viewOptionsRowSpacing(value: ButtonSpacing): CSSProperties {
        if (value === "verysmall") {
            return { marginTop: "0px", marginBottom: "0px" };
        }
        if (value === "small") {
            return { marginTop: "2px", marginBottom: "2px" };
        }
        if (value === "medium") {
            return { marginTop: "4px", marginBottom: "4px" };
        }
        if (value === "large") {
            return { marginTop: "8px", marginBottom: "8px" };
        }
        return { marginTop: "12px", marginBottom: "12px" };
    }

    const buttonOuterStyle = viewOptionsRowSpacing(buttonSpacing);

    const firstRowOuterStyle: CSSProperties = {
        ...buttonOuterStyle,
        marginTop: "8px"
    };

    const commentsEmpty = commentsLoaded && comments.length === 0 && !commentsLoading && !commentsError;

    const [localSort, setLocalSort] = useState<AchievementSort>("absolute");
    const [localFilter, setLocalFilter] = useState<MainAchievementFilter>("all");

    const [boxArtDataUri, setBoxArtDataUri] = useState<string | null>(() =>
        getCachedGameImageDataUri(gameId, "boxart")
    );

    const [imageIndex, setImageIndex] = useState<number>(1);

    const [ingameDataUri, setIngameDataUri] = useState<string | null>(() =>
        getCachedGameImageDataUri(gameId, "ingame")
    );
    const [iconDataUri, setIconDataUri] = useState<string | null>(() =>
        getCachedGameImageDataUri(gameId, "icon")
    );
    const coldSlidesRef = useRef({
        ingame: ingameDataUri === null,
        boxart: boxArtDataUri === null,
        icon: iconDataUri === null
    });

    const artPayload = loadedPayload?.gameId === gameId ? loadedPayload : null;

    useEffect(() => {
        if (!showIcons || gameId == null) {
            setBoxArtDataUri(null);
            return;
        }

        const cachedBoxArt = getCachedGameImageDataUri(gameId, "boxart");
        coldSlidesRef.current.boxart = cachedBoxArt === null;
        setBoxArtDataUri(cachedBoxArt);

        let cancelled = false;
        void (async () => {
            try {
                const boxArtResult = await getGameImageCached(gameId, "boxart", artPayload?.imageBoxArt ?? null);
                if (cancelled) {
                    return;
                }
                if (boxArtResult?.dataUri) {
                    setBoxArtDataUri(boxArtResult.dataUri);
                }
            }
            catch (e) {
                logError("GameOverviewPage getGameImageCached boxart", e);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [gameId, showIcons, artPayload?.imageBoxArt]);

    useEffect(() => {
        if (!showIcons || gameId == null) {
            setIngameDataUri(null);
            setIconDataUri(null);
            return;
        }

        const cachedIngame = getCachedGameImageDataUri(gameId, "ingame");
        const cachedIcon = getCachedGameImageDataUri(gameId, "icon");
        coldSlidesRef.current.ingame = cachedIngame === null;
        coldSlidesRef.current.icon = cachedIcon === null;
        setIngameDataUri(cachedIngame);
        setIconDataUri(cachedIcon);

        let cancelled = false;
        void (async () => {
            try {
                const ingameResult = await getGameImageCached(gameId, "ingame", artPayload?.imageIngame ?? null);
                if (cancelled) {
                    return;
                }
                if (ingameResult?.dataUri) {
                    setIngameDataUri(ingameResult.dataUri);
                }
            }
            catch (e) {
                logError("GameOverviewPage getGameImageCached ingame", e);
            }
        })();

        void (async () => {
            try {
                const iconResult = await getGameImageCached(gameId, "icon", artPayload?.imageIcon ?? null);
                if (cancelled) {
                    return;
                }
                if (iconResult?.dataUri) {
                    setIconDataUri(iconResult.dataUri);
                }
            }
            catch (e) {
                logError("GameOverviewPage getGameImageCached icon", e);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [gameId, showIcons, artPayload?.imageIngame, artPayload?.imageIcon]);

    useEffect(() => {
        if (boxArtDataUri) {
            coldSlidesRef.current.boxart = false;
        }
        if (ingameDataUri) {
            coldSlidesRef.current.ingame = false;
        }
        if (iconDataUri) {
            coldSlidesRef.current.icon = false;
        }
    }, [boxArtDataUri, ingameDataUri, iconDataUri]);

    useEffect(() => {
        setImageIndex(1);
    }, [gameId]);

    if (view !== "gameOverview") {
        return null;
    }

    function handleSortCycle() {
        setLocalSort(nextAchievementSort(localSort));
    }

    function handleFilterCycle() {
        setLocalFilter(nextMainAchievementFilter(localFilter));
    }

    function handleCommentsSortCycle() {
        if (!commentsLoaded) {
            return;
        }
        onChangeCommentsSort(commentsSort === "newest" ? "oldest" : "newest");
    }

    const slides = [
        { kind: "ingame", uri: ingameDataUri },
        { kind: "boxart", uri: boxArtDataUri },
        { kind: "icon", uri: iconDataUri },
        { kind: "video", uri: null }
    ] as const;
    const currentSlideUri = slides[imageIndex]?.uri ?? null;
    const currentSlideKind = slides[imageIndex]?.kind ?? null;

    function stepHeaderImage(delta: number) {
        setImageIndex((i) => (i + delta + slides.length) % slides.length);
    }

    function handleHeaderButtonDown(evt: { detail?: { button?: number } }) {
        const button = evt?.detail?.button;
        if (button === BUTTON_BUMPER_LEFT) {
            playOkSound();
            stepHeaderImage(-1);
        }
        else if (button === BUTTON_BUMPER_RIGHT) {
            playOkSound();
            stepHeaderImage(1);
        }
    }

    function openVideoSearch() {
        const title = (loadedPayload?.title ?? "").trim();
        if (!title) {
            return;
        }
        const system = loadedPayload?.consoleName ? consoleSearchName(loadedPayload.consoleName) : "";
        void openExternalUrl(youtubeSearchUrl(system ? `${title} ${system}` : title));
    }

    const alreadyCovered = panelOverlayVisible || (payloadLoading && !loadedPayload);
    const restoreCurtainArmed = restorePending
        && subView === "comments"
        && !alreadyCovered;
    const restoreCurtainClaim = commentsCardClaim ?? commentsPostClaim;
    const restoreCurtainSettled = !holdCommentsBody
        && (restoreCurtainClaim?.token ?? 0) > 0
        && !restoreCurtainClaim?.armed;

    if (holdCommentsBody && subView === "comments" && !commentsLoaded) {
        const restoreShell = (
            <PanelSection>
                <PageNavStrip
                    title={t(language, "Game Info")}
                    buttonSpacing={buttonSpacing}
                    onHome={onHome}
                />
                <BackButton
                    label={t(language, "← Back")}
                    focusKey="gameoverview:back"
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
                covered={panelOverlayVisible}
            >
                {restoreShell}
            </RestoreCurtain>
        );
    }

    if (needsSettings) {
        return (
            <PanelSection>
                <PageNavStrip
                    title={t(language, "Game Info")}
                    buttonSpacing={buttonSpacing}
                    onHome={onHome}
                />
                <BackButton
                    label={t(language, "← Back")}
                    focusKey="gameoverview:back"
                    navAutoFocus
                    buttonSpacing={buttonSpacing}
                    onClick={onBack}
                />
                <ViewingFriendBanner
                    username={viewedUsername}
                    kind="game"
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

    const releasedLabel = loadedPayload
        ? formatReleaseDate(loadedPayload.released, loadedPayload.releasedAtGranularity)
        : "";
    const hasGameInfo = !!(
        loadedPayload &&
        (loadedPayload.developer || loadedPayload.publisher || loadedPayload.genre || releasedLabel)
    );

    const headerStripPageable = showIcons && !!(loadedPayload?.imageBoxArt || boxArtDataUri);

    const page = (
        <Focusable
            onButtonDown={headerStripPageable ? handleHeaderButtonDown : undefined}
        >
            <PanelSection>
                <PageNavStrip
                    title={t(language, "Game Info")}
                    buttonSpacing={buttonSpacing}
                    onHome={onHome}
                />
                <BackButton
                    label={t(language, "← Back")}
                    focusKey="gameoverview:back"
                    navAutoFocus={!restorePending}
                    buttonSpacing={buttonSpacing}
                    onClick={onBack}
                />

                <ViewingFriendBanner
                    username={viewedUsername}
                    kind="game"
                    language={language}
                />

                {payloadError && (
                    <PanelSectionRow>
                        <ErrorText>{localizeRuntimeText(language, payloadError)}</ErrorText>
                    </PanelSectionRow>
                )}

                {
}
                {(loadedPayload || boxArtDataUri) && (
                    <PanelSectionRow>
                        <div
                            style={{
                                width: "100%",
                                display: "flex",
                                flexDirection: "column",
                                gap: "6px",
                                alignItems: "flex-start",
                                marginTop: "10px"
                            }}
                        >
                            {(loadedPayload?.imageBoxArt || boxArtDataUri) ? (
                                showIcons ? (
                                    <Focusable
                                        flow-children="row"
                                        navEntryPreferPosition={NAV_ENTER_PREFERRED_CHILD}
                                        resetNavOnEntry={true}
                                        style={{
                                            width: "100%",
                                            display: "flex",
                                            flexDirection: "row",
                                            alignItems: "center"
                                        }}
                                    >
                                        <div data-focus-key="gameoverview:header:prev" style={{ display: "flex", flexShrink: 0 }}>
                                            <DialogButton
                                                onClick={() => { stepHeaderImage(-1); }}
                                                style={{
                                                    minWidth: 0,
                                                    width: "24px",
                                                    height: "150px",
                                                    padding: "0",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center"
                                                }}
                                            >
                                                <ChevronLeftIcon />
                                            </DialogButton>
                                        </div>

                                        <div data-focus-key="gameoverview:header" style={{ display: "flex", flex: 1, minWidth: 0 }}>
                                            <DialogButton
                                                preferredFocus={true}
                                                onClick={() => {
                                                    if (currentSlideKind === "video") {
                                                        openVideoSearch();
                                                        return;
                                                    }
                                                    void onGameClick();
                                                }}
                                                style={{
                                                    minWidth: 0,
                                                    width: "100%",
                                                    height: "150px",
                                                    padding: "0",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center"
                                                }}
                                            >
                                                {currentSlideKind === "video" ? (
                                                    <VideoIcon />
                                                ) : currentSlideUri ? (
                                                    <FadeImage
                                                        key={currentSlideKind}
                                                        src={currentSlideUri}
                                                        fadeOnLoad={currentSlideKind != null
                                                            && coldSlidesRef.current[currentSlideKind]}
                                                        style={{
                                                            maxWidth: "100%",
                                                            maxHeight: "100%",
                                                            width: "auto",
                                                            height: "auto",
                                                            objectFit: "contain",
                                                            borderRadius: "8px",
                                                            display: "block"
                                                        }}
                                                    />
                                                ) : (
                                                    <div
                                                        style={{
                                                            width: "100%",
                                                            height: "100%",
                                                            borderRadius: "8px",
                                                            background: "rgba(255,255,255,0.06)",
                                                            display: "block"
                                                        }}
                                                    />
                                                )}
                                            </DialogButton>
                                        </div>

                                        <div data-focus-key="gameoverview:header:next" style={{ display: "flex", flexShrink: 0 }}>
                                            <DialogButton
                                                onClick={() => { stepHeaderImage(1); }}
                                                style={{
                                                    minWidth: 0,
                                                    width: "24px",
                                                    height: "150px",
                                                    padding: "0",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center"
                                                }}
                                            >
                                                <ChevronRightIcon />
                                            </DialogButton>
                                        </div>
                                    </Focusable>
                                ) : (
                                    <FocusableItem
                                        focusKey="gameoverview:header"
                                        onClick={() => { void onGameClick(); }}
                                        outerStyle={{ width: "100%" }}
                                    >
                                        <div
                                            style={{
                                                width: "100%",
                                                display: "flex",
                                                justifyContent: "center",
                                                alignItems: "center"
                                            }}
                                        >
                                            {boxArtDataUri ? (
                                                <FadeImage
                                                    src={boxArtDataUri}
                                                    fadeOnLoad={coldSlidesRef.current.boxart}
                                                    style={{
                                                        maxWidth: "150px",
                                                        maxHeight: "150px",
                                                        width: "auto",
                                                        height: "auto",
                                                        objectFit: "contain",
                                                        borderRadius: "8px",
                                                        display: "block"
                                                    }}
                                                />
                                            ) : (
                                                <div
                                                    style={{
                                                        width: "150px",
                                                        height: "150px",
                                                        borderRadius: "8px",
                                                        background: "rgba(255,255,255,0.06)",
                                                        display: "block"
                                                    }}
                                                />
                                            )}
                                        </div>
                                    </FocusableItem>
                                )
                            ) : null}
                            {loadedPayload && (
                                <>
                                    <div
                                        style={{
                                            fontSize: `${headerSize(18)}px`,
                                            pointerEvents: "all",
                                            fontWeight: 700,
                                            lineHeight: 1.2,
                                            textAlign: "left",
                                            wordBreak: "break-word"
                                        }}
                                    >
                                        {loadedPayload.title ?? t(language, "No game found")}
                                    </div>
                                    <AwardStatusBadge
                                        language={language}
                                        kind={loadedPayload.highestAwardKind}
                                        style={{ marginTop: "4px" }}
                                    />
                                    <div style={{ ...bodyTextStyle(), textAlign: "left" }}>
                                        {loadedPayload.consoleName ? consoleInlineName(loadedPayload.consoleName) : ""}
                                        {loadedPayload.consoleName && loadedPayload.userCompletion ? " • " : ""}
                                        {loadedPayload.userCompletion
                                            ? t(language, "Completion: {{value}}", { value: loadedPayload.userCompletion })
                                            : ""}
                                    </div>
                                    <div style={{ ...bodyTextStyle(), textAlign: "left" }}>
                                        {payloadAchievementSummaryLabel(loadedPayload, language)}
                                    </div>
                                </>
                            )}
                            {hasGameInfo && (
                                <div
                                    style={{
                                        width: "100%",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "4px",
                                        marginTop: "6px"
                                    }}
                                >
                                    <InfoRow
                                        label={t(language, "Developer")}
                                        value={loadedPayload?.developer ?? ""}
                                    />
                                    <InfoRow
                                        label={t(language, "Publisher")}
                                        value={loadedPayload?.publisher ?? ""}
                                    />
                                    <InfoRow
                                        label={t(language, "Genre")}
                                        value={loadedPayload?.genre ?? ""}
                                    />
                                    <InfoRow
                                        label={t(language, "Released")}
                                        value={releasedLabel}
                                    />
                                </div>
                            )}
                        </div>
                    </PanelSectionRow>
                )}

                {payloadLoading && !loadedPayload && (
                    <PanelSectionRow>
                        <InlineSpinner label={t(language, "Loading...")} />
                    </PanelSectionRow>
                )}

                {
}
                <PanelSectionRow>
                    <FocusableItem
                        focusKey="gameoverview:searchmore"
                        bottomSeparator="none"
                        onClick={() => { onOpenGameSearch(); }}
                        outerStyle={{ width: "100%", minWidth: 0, marginTop: "2px" }}
                    >
                        <div
                            style={{
                                width: "100%",
                                boxSizing: "border-box",
                                display: "flex",
                                flexDirection: "row",
                                alignItems: "center",
                                gap: "8px",
                                padding: "7px 10px",
                                borderRadius: "8px",
                                background: "rgba(255,255,255,0.08)",
                                border: "1px solid rgba(255,255,255,0.14)",
                                minWidth: 0
                            }}
                        >
                            <SearchIcon size={16} />
                            <span
                                style={{
                                    ...bodyTextStyle(),
                                    flex: 1,
                                    minWidth: 0,
                                    textAlign: "left",
                                    opacity: 0.75,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis"
                                }}
                            >
                                {t(language, "Search More Games")}
                            </span>
                        </div>
                    </FocusableItem>
                </PanelSectionRow>

                {gameId != null && (
                    <PanelSectionRow>
                        <FocusableItem
                            focusKey="gameoverview:leaderboards"
                            bottomSeparator="none"
                            onClick={() => { onOpenLeaderboards(); }}
                            outerStyle={{ width: "100%", minWidth: 0, marginTop: "0px" }}
                        >
                            <div
                                style={{
                                    width: "100%",
                                    boxSizing: "border-box",
                                    display: "flex",
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: "8px",
                                    padding: "7px 10px",
                                    borderRadius: "8px",
                                    background: "rgba(255,255,255,0.08)",
                                    border: "1px solid rgba(255,255,255,0.14)",
                                    minWidth: 0
                                }}
                            >
                                <LeaderboardIcon size={16} />
                                <span
                                    style={{
                                        ...bodyTextStyle(),
                                        flex: 1,
                                        minWidth: 0,
                                        textAlign: "left",
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis"
                                    }}
                                >
                                    {t(language, "Leaderboards")}
                                </span>
                            </div>
                        </FocusableItem>
                    </PanelSectionRow>
                )}

                {
}
                <Focusable
                    flow-children="row"
                    style={{
                        width: "100%",
                        display: "flex",
                        gap: "6px",
                        margin: "6px 0 14px 0"
                    }}
                >
                    {SUB_TABS.map((tab) => (
                        <SubTabIconButton
                            key={tab.value}
                            icon={subTabIcon(tab.icon)}
                            active={subView === tab.value}
                            onClick={() => onChangeSubView(tab.value)}
                            focusKey={tab.focusKey}
                        />
                    ))}
                </Focusable>
            </PanelSection>

            {subView === "achievements" ? (
                <>
                    <PanelSection title={t(language, "View Options")}>
                        <LabeledOptionRow
                            outerStyle={firstRowOuterStyle}
                            focusKey="gameoverview:achievements:sort"
                            onClick={handleSortCycle}
                            label={t(language, "Sort")}
                            value={achievementSortLabel(localSort, language)}
                        />
                        <LabeledOptionRow
                            outerStyle={buttonOuterStyle}
                            focusKey="gameoverview:achievements:filter"
                            onClick={handleFilterCycle}
                            label={t(language, "Filter")}
                            value={mainAchievementFilterLabel(localFilter, language)}
                        />
                    </PanelSection>
                    {loadedPayload && (
                        <AchievementList
                            key={`gameoverview:achievements:${gameId ?? "none"}`}
                            payload={loadedPayload}
                            language={language}
                            showIcons={showIcons}
                            achievementStyle={achievementStyle}
                            uiSize={uiSize}
                            topPadding={0}
                            blockPadding={blockPadding}
                            showAll={true}
                            mode="overview"
                            trackedIds={[]}
                            mainFilter={localFilter}
                            mainSort={localSort}
                            showRetroPoints={showRetroPoints}
                            onAchievementClick={onAchievementClick}
                        />
                    )}
                </>
            ) : subView === "hashes" ? (
                <PanelSection title={t(language, "Supported Hashes")}>
                    {hashesLoading ? (
                        <PanelSectionRow>
                            <InlineSpinner label={t(language, "Loading...")} />
                        </PanelSectionRow>
                    ) : hashesError ? (
                        <PanelSectionRow>
                            <ErrorText>
                                {t(language, "Couldn't load supported hashes.")}
                            </ErrorText>
                        </PanelSectionRow>
                    ) : hashes.length === 0 ? (
                        <PanelSectionRow>
                            <div style={bodyTextStyle()}>
                                {t(language, "No supported hashes found for this game.")}
                            </div>
                        </PanelSectionRow>
                    ) : (
                        <PanelSectionRow>
                            <HashesList
                                results={hashes}
                                language={language}
                                downloadingMd5={hashesDownloadingMd5}
                                onDownloadPatch={onDownloadHashPatch}
                            />
                        </PanelSectionRow>
                    )}
                </PanelSection>
            ) : commentsEmpty ? (
                <PanelSection>
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>
                            {t(language, "No comments yet for this game.")}
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
                            postFocusKey="gameoverview:comments:post"
                            subscribeFocusKey="gameoverview:comments:subscribe"
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
                                postFocusKey="gameoverview:comments:post"
                                subscribeFocusKey="gameoverview:comments:subscribe"
                            />
                        </FocusClaim>
                    </PanelSection>
                    <PanelSection title={t(language, "View Options")}>
                        <LabeledRow
                            outerStyle={firstRowOuterStyle}
                            focusKey="gameoverview:comments:sort"
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
                            focusKeyPrefix="gameoverview:comment"
                            surfaceKey="comments:overview"
                            onCommentClick={onCommentClick}
                            dynamicLoading={dynamicComments}
                            dynamicSentinelRootMargin={dynamicCommentsSentinelRootMargin}
                            loading={commentsLoading}
                            loadingMore={commentsLoadingMore}
                            hasMore={commentsHasMore}
                            error={commentsError}
                            onLoadMore={onLoadMoreComments}
                            emptyMessage={t(language, "No comments yet for this game.")}
                            claimedCard={commentsCardClaim && {
                                ...commentsCardClaim,
                                onSpent: onSpendCommentsCardClaim
                            }}
                            restoredWindow={commentsWindow}
                        />
                    </PanelSection>
                </>
            )}
        </Focusable>
    );

    return (
        <RestoreCurtain
            armed={restoreCurtainArmed}
            settled={restoreCurtainSettled}
            covered={panelOverlayVisible}
        >
            {page}
        </RestoreCurtain>
    );
}

export default GameOverviewPage;
