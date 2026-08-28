import React, { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { DialogButton, Focusable, PanelSection, PanelSectionRow } from "@decky/ui";
import { BackButton } from "../components/ui/BackButton";
import { ButtonHints } from "../components/ui/ButtonHints";
import { FocusableItem } from "../components/ui/FocusableItem";
import { FocusClaim } from "../components/ui/FocusClaim";
import { RestoreCurtain } from "../components/ui/RestoreCurtain";
import { ErrorText } from "../components/ui/ErrorText";
import { FadeImage } from "../components/ui/FadeImage";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { NewsCard } from "../components/social/NewsCard";
import { AotwHeader } from "../components/social/AotwHeader";
import { AotwUnlockRow } from "../components/social/AotwUnlockRow";
import { CommentsList } from "../components/comments/CommentsList";
import { CommentCard } from "../components/comments/CommentCard";
import { GameContextBanner } from "../components/social/GameContextBanner";
import { AchievementContextBanner } from "../components/social/AchievementContextBanner";
import { CommentActionStrip } from "../components/comments/CommentActionStrip";
import { LabeledRow } from "../components/ui/LabeledRow";
import { NewSetCard } from "../components/social/NewSetCard";
import { SubTabButton } from "../components/ui/SubTabButton";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { activityCardActionLabel } from "../utils/options";
import type {
    AchievementOfTheWeekResponse,
    ActivityCardAction,
    AotwComment,
    AotwSubView,
    AotwUnlock,
    ButtonSpacing,
    CommunitySubTab,
    ControllerGlyphStyle,
    FriendRow,
    FriendsPayload,
    GameComment,
    NewsEntry,
    NewSetEntry,
    NewSetsAndRevisionsResponse,
    NewSetsFilter,
    NewsEventsSubView,
    SavedComment,
    SavedCommentGame,
    SavedCommentsFilter,
    SavedCommentSource,
    SavedCommentsSort,
    SocialActivityEvent,
    SocialView,
    Subscription,
    UiSize,
    ViewKey
} from "../types";
import type { LanguageCode } from "../locales";
import type { RestoredCommentsWindow } from "../hooks/useCommentsWindow";

import {
    cacheAchievementIcons,
    getAchievementIcons,
    getCachedAchievementIcons,
    getSocialActivity,
    getSubscriptions,
    prefetchGameIcons,
    prefetchUserAvatars,
    removeSubscription
} from "../api";
import { filterAndSortSavedComments } from "../utils/savedComments";
import { useFocusClaim, type FocusClaimController } from "../hooks/useFocusClaim";
import { useGameIcon } from "../hooks/useGameIcon";
import { useThreadSubscription } from "../hooks/useThreadSubscription";
import { useWindowedList } from "../hooks/useWindowedList";
import { UserAvatar } from "../components/ui/UserAvatar";
import { FriendListRow, type FriendRowListProps } from "../components/social/FriendListRow";
import { ActivityFeedRow, type ActivityRowListProps } from "../components/social/ActivityFeedRow";
import { localizeRuntimeText, t } from "../locales";
import { achievementUiMetrics, type AchievementUiMetrics, smallTextStyle, bodyTextStyle, FADE_IN_KEYFRAMES } from "../utils/style";
import { bannerSize, textSize } from "../utils/scale";
import { beginGuardedRun } from "../utils/runGuard";

type TabIconProps = { size?: number };

type SocialTab = {
    view: SocialView;
    Icon: ComponentType<TabIconProps>;
    labelKey: string;
    focusKey: string;
};

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function FriendsIcon({ size = 18 }: TabIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 640 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M144 0a80 80 0 1 1 0 160A80 80 0 1 1 144 0zM512 0a80 80 0 1 1 0 160A80 80 0 1 1 512 0zM0 298.7C0 239.8 47.8 192 106.7 192h42.7c15.9 0 31 3.5 44.6 9.7c-1.3 7.2-1.9 14.7-1.9 22.3c0 38.2 16.8 72.5 43.3 96c-.2 0-.4 0-.7 0H21.3C9.6 320 0 310.4 0 298.7zM405.3 320c-.2 0-.4 0-.7 0c26.6-23.5 43.3-57.8 43.3-96c0-7.6-.7-15-1.9-22.3c13.6-6.3 28.7-9.7 44.6-9.7h42.7C592.2 192 640 239.8 640 298.7c0 11.8-9.6 21.3-21.3 21.3H405.3zM224 224a96 96 0 1 1 192 0 96 96 0 1 1 -192 0zM128 485.3C128 411.7 187.7 352 261.3 352H378.7C452.3 352 512 411.7 512 485.3c0 14.7-11.9 26.7-26.7 26.7H154.7c-14.7 0-26.7-11.9-26.7-26.7z" />
        </svg>
    );
}

function StarIcon({ size = 18 }: TabIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 576 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M316.9 18C311.6 7 300.4 0 288.1 0s-23.4 7-28.8 18L195 150.3 51.4 171.5c-12 1.8-22 10.2-25.7 21.7s-.7 24.2 7.9 32.7L137.8 329 113.2 474.7c-2 12 3 24.2 12.9 31.3s23 8 33.8 2.3l128.3-68.5 128.3 68.5c10.8 5.7 23.9 4.9 33.8-2.3s14.9-19.3 12.9-31.3L438.5 329 542.7 225.9c8.6-8.5 11.7-21.2 7.9-32.7s-13.7-19.9-25.7-21.7L381.2 150.3 316.9 18z" />
        </svg>
    );
}

function ClockIcon({ size = 18 }: TabIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M256 0a256 256 0 1 1 0 512A256 256 0 1 1 256 0zM232 120V256c0 8 4 15.5 10.7 20l96 64c11 7.4 25.9 4.4 33.3-6.7s4.4-25.9-6.7-33.3L280 243.2V120c0-13.3-10.7-24-24-24s-24 10.7-24 24z" />
        </svg>
    );
}

function SubscribedDiscussionsIcon({ size = 18 }: TabIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
            fillRule="evenodd"
            clipRule="evenodd"
        >
            <path d="M104 80H408A56 56 0 0 1 464 136V296A56 56 0 0 1 408 352H192L128 416V352H104A56 56 0 0 1 48 296V136A56 56 0 0 1 104 80ZM152 216A24 24 0 1 0 200 216A24 24 0 1 0 152 216ZM232 216A24 24 0 1 0 280 216A24 24 0 1 0 232 216ZM312 216A24 24 0 1 0 360 216A24 24 0 1 0 312 216Z" />
        </svg>
    );
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

function NewspaperIcon({ size = 18 }: TabIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M96 96c0-35.3 28.7-64 64-64H448c35.3 0 64 28.7 64 64V416c0 35.3-28.7 64-64 64H80c-44.2 0-80-35.8-80-80V128c0-17.7 14.3-32 32-32s32 14.3 32 32V400c0 8.8 7.2 16 16 16s16-7.2 16-16V96zm64 24v80c0 13.3 10.7 24 24 24H296c13.3 0 24-10.7 24-24V120c0-13.3-10.7-24-24-24H184c-13.3 0-24 10.7-24 24zM384 120v0c0 13.3 10.7 24 24 24h40c13.3 0 24-10.7 24-24v0c0-13.3-10.7-24-24-24H408c-13.3 0-24 10.7-24 24zm0 80v0c0 13.3 10.7 24 24 24h40c13.3 0 24-10.7 24-24v0c0-13.3-10.7-24-24-24H408c-13.3 0-24 10.7-24 24zM160 280v0c0 13.3 10.7 24 24 24H448c13.3 0 24-10.7 24-24v0c0-13.3-10.7-24-24-24H184c-13.3 0-24 10.7-24 24zm0 80v0c0 13.3 10.7 24 24 24H448c13.3 0 24-10.7 24-24v0c0-13.3-10.7-24-24-24H184c-13.3 0-24 10.7-24 24z" />
        </svg>
    );
}

const SOCIAL_TABS: SocialTab[] = [
    { view: "friends", Icon: FriendsIcon, labelKey: "Friends", focusKey: "social:tab:friends" },
    { view: "favorites", Icon: StarIcon, labelKey: "Favorites", focusKey: "social:tab:favorites" },
    { view: "activity", Icon: ClockIcon, labelKey: "Activity", focusKey: "social:tab:activity" },
    { view: "subscribedDiscussions", Icon: SubscribedDiscussionsIcon, labelKey: "Community", focusKey: "social:tab:subscribeddiscussions" },
    { view: "newsEvents", Icon: NewspaperIcon, labelKey: "News & Events", focusKey: "social:tab:newsevents" }
];

const NEWS_EVENTS_SUB_TABS: { value: NewsEventsSubView; labelKey: string; focusKey: string }[] = [
    { value: "news", labelKey: "News", focusKey: "newsevents:subtab:news" },
    { value: "aotw", labelKey: "Achievement of the Week", focusKey: "newsevents:subtab:aotw" },
    { value: "newSets", labelKey: "New Sets & Revisions", focusKey: "newsevents:subtab:newsets" }
];

const COMMUNITY_SUB_TABS: { value: CommunitySubTab; labelKey: string; focusKey: string }[] = [
    { value: "subscribed", labelKey: "Subscribed", focusKey: "community:subtab:subscribed" },
    { value: "savedComments", labelKey: "Saved Comments", focusKey: "community:subtab:savedcomments" }
];

const SAVED_COMMENTS_INITIAL_ROWS = 30;
const SAVED_COMMENTS_ROW_STEP = 50;

const AOTW_SUB_TABS: { value: AotwSubView; labelKey: string; focusKey: string }[] = [
    { value: "unlocks", labelKey: "Unlocks", focusKey: "aotw:subtab:unlocks" },
    { value: "comments", labelKey: "Comments", focusKey: "aotw:subtab:comments" }
];

const NEW_SETS_FILTER_TABS: { value: NewSetsFilter; labelKey: string; focusKey: string }[] = [
    { value: "new", labelKey: "New Sets", focusKey: "newsets:filter:new" },
    { value: "revision", labelKey: "Revisions", focusKey: "newsets:filter:revision" }
];

type NewsEventsProps = {
    subView: NewsEventsSubView;
    onChangeSubView: (subView: NewsEventsSubView) => void;
    newsPayload: NewsEntry[] | null;
    newsLoading: boolean;
    newsError: string | null;
    onOpenNewsLink: (url: string) => void | Promise<void>;
    aotwResponse: AchievementOfTheWeekResponse | null;
    aotwSubView: AotwSubView;
    aotwLoading: boolean;
    aotwError: string | null;
    onChangeAotwSubView: (subView: AotwSubView) => void;
    onOpenUserProfile: (username: string, ulid?: string | null) => void | Promise<void>;
    onOpenAotwComment: (comment: AotwComment, achievementId: number | null) => void | Promise<void>;
    aotwComments: GameComment[];
    aotwCommentsLoading: boolean;
    aotwCommentsLoadingMore: boolean;
    aotwCommentsError: string | null;
    aotwCommentsHasMore: boolean;
    aotwCommentsSort: "newest" | "oldest";
    aotwCommentsLoaded: boolean;
    aotwCommentsCardClaim?: {
        slotIndex: number;
        token: number;
        armed: boolean;
    };
    onSpendAotwCommentsCardClaim: () => void;
    aotwCommentsPostClaim?: {
        token: number;
        armed: boolean;
    };
    onSpendAotwCommentsPostClaim: () => void;
    aotwRestorePending: boolean;
    aotwHoldCommentsBody: boolean;
    aotwCommentsWindow: RestoredCommentsWindow | null;
    onChangeAotwCommentsSort: (sort: "newest" | "oldest") => void;
    onLoadMoreAotwComments: () => void | Promise<void>;
    onPostAotwComment: () => void | Promise<void>;
    onOpenGameOverview?: (gameId: number) => void | Promise<void>;
    newSetsResponse: NewSetsAndRevisionsResponse | null;
    newSetsFilter: NewSetsFilter;
    newSetsLoading: boolean;
    newSetsError: string | null;
    onChangeNewSetsFilter: (filter: NewSetsFilter) => void;
    onOpenNewSetGame: (gameId: number) => void | Promise<void>;
};

type SavedCommentsPanelProps = {
    subTab: CommunitySubTab;
    onChangeSubTab: (tab: CommunitySubTab) => void;
    comments: SavedComment[];
    loaded: boolean;
    error: string | null;
    onOpen: (comment: SavedComment) => void | Promise<void>;
    onTrash: (comment: SavedComment) => void | Promise<void>;
    sort: SavedCommentsSort;
    filter: SavedCommentsFilter;
    games: SavedCommentGame[];
    onCycleSort: () => void;
    onOpenFilterPicker: () => void;
};

type SocialHubPageProps = {
    view: ViewKey;
    language: LanguageCode;
    panelOverlayVisible: boolean;
    focusScopeResetToken: number;
    socialEntryToken: number;
    socialEntryView: SocialView;
    friendsPayload: FriendsPayload | null;
    friendsError: string | null;
    friendsLoaded: boolean;
    friendAutoRefresh: boolean;
    friendsRows: FriendRow[];
    buttonSpacing: ButtonSpacing;
    uiSize: UiSize;
    showIcons: boolean;
    liveRefreshingFriendUsernames: Set<string>;
    dynamicFriendLoading: boolean;
    dynamicActivityFeed: boolean;
    dynamicInitialRows: number;
    dynamicRowStep: number;
    dynamicPrefetchDistance: number;
    dynamicSentinelRootMargin: number;
    dynamicComments: boolean;
    dynamicCommentsInitialRows: number;
    dynamicCommentsRowStep: number;
    dynamicCommentsSentinelRootMargin: number;
    favoriteFriends: string[];
    newsEvents: NewsEventsProps;
    savedComments: SavedCommentsPanelProps;
    onBack: () => void | Promise<void>;
    onHome: () => void | Promise<void>;
    onFriendClick: (friend: FriendRow) => void | Promise<void>;
    onActivityCardClick: (event: SocialActivityEvent) => void | Promise<void>;
    onActivityCardSecondary: (event: SocialActivityEvent) => void;
    onActivityCardTertiary: (event: SocialActivityEvent) => void;
    socialHubCardAction: ActivityCardAction;
    onCycleSocialHubCardAction: () => void | Promise<void>;
    mouseKeyboardMode: boolean;
    controllerGlyphStyle: ControllerGlyphStyle;
    onOpenSubscription?: (subscription: Subscription) => void | Promise<void>;
    onFriendFocus: (friend: FriendRow) => void;
    onFriendHover: (friend: FriendRow) => void;
    onFriendUnhover: (friend: FriendRow) => void;
    onFriendFavoriteToggle: (friend: FriendRow, favorite: boolean) => void | Promise<void>;
    onFriendResolveAvatar: (friend: FriendRow) => void | Promise<void>;
    onSocialViewChange: (view: SocialView) => void;
    onSocialTabClick: () => void;
};

function SocialHubPage(props: SocialHubPageProps) {
    const activityLoadMoreMarkerRef = useRef<HTMLDivElement | null>(null);
    const newSetsLoadMoreMarkerRef = useRef<HTMLDivElement | null>(null);
    const dynamicFriendLoading = props.dynamicFriendLoading ?? true;
    const dynamicActivityFeed = props.dynamicActivityFeed ?? true;
    const dynamicInitialRows = Math.max(1, props.dynamicInitialRows ?? 30);
    const dynamicRowStep = Math.max(1, props.dynamicRowStep ?? 30);
    const dynamicPrefetchDistance = Math.max(1, props.dynamicPrefetchDistance ?? 12);
    const dynamicSentinelRootMargin = `${Math.max(0, props.dynamicSentinelRootMargin ?? 600)}px 0px`;
    const dynamicNewSets = props.dynamicComments ?? true;
    const dynamicNewSetsInitialRows = Math.max(1, props.dynamicCommentsInitialRows ?? 10);
    const dynamicNewSetsRowStep = Math.max(1, props.dynamicCommentsRowStep ?? 10);
    const dynamicNewSetsSentinelRootMargin = Math.max(0, props.dynamicCommentsSentinelRootMargin ?? 400);

    const aotwPayload = props.newsEvents.aotwResponse?.payload ?? null;
    const aotwSubscription = useThreadSubscription({
        language: props.language,
        kind: "achievement",
        id: aotwPayload?.achievement?.id ?? null,
        buildEntry: () => {
            const achievementId = aotwPayload?.achievement?.id ?? null;
            if (!aotwPayload || achievementId == null) {
                return null;
            }
            return {
                kind: "achievement",
                id: achievementId,
                gameId: aotwPayload.game?.id ?? achievementId,
                title: aotwPayload.achievement.title ?? "",
                gameTitle: aotwPayload.game?.title ?? "",
                console: aotwPayload.console?.title ?? "",
                iconUrl: aotwPayload.achievement.badgeUrl ?? "",
                badgeName: aotwPayload.achievement.badgeName ?? "",
                seedComments: props.newsEvents.aotwComments,
                seedSort: props.newsEvents.aotwCommentsSort,
                seedLoaded: props.newsEvents.aotwCommentsLoaded
            };
        }
    });
    const [socialView, setSocialView] = useState<SocialView>(props.socialEntryView);
    const [focusedSocialView, setFocusedSocialView] = useState<SocialView | null>(null);
    const [hoveredSocialView, setHoveredSocialView] = useState<SocialView | null>(null);

    const [backClaimToken, setBackClaimToken] = useState(0);
    const favoriteRowClaim = useFocusClaim();
    const subscriptionRowClaim = useFocusClaim();
    const savedCommentRowClaim = useFocusClaim();
    const [activityEvents, setActivityEvents] = useState<SocialActivityEvent[]>([]);
    const [activityLoaded, setActivityLoaded] = useState(false);
    const [activityError, setActivityError] = useState<string | null>(null);
    const [activityRequestToken, setActivityRequestToken] = useState(0);
    const [activityMountedCount, setActivityMountedCount] = useState(() => {
        if (!dynamicActivityFeed) {
            return 0;
        }
        return dynamicInitialRows;
    });
    const [newSetsMountedCount, setNewSetsMountedCount] = useState(() => {
        if (!dynamicNewSets) {
            return 0;
        }
        return dynamicNewSetsInitialRows;
    });
    const activityEventsRef = useRef<SocialActivityEvent[]>([]);
    const activityLoadRunIdRef = useRef(0);

    const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
    const [subscriptionsLoaded, setSubscriptionsLoaded] = useState(false);
    const [subscriptionsError, setSubscriptionsError] = useState<string | null>(null);
    const [achievementBadges, setAchievementBadges] = useState<Record<string, string>>({});
    const [armedSubKey, setArmedSubKey] = useState<string | null>(null);
    const subscriptionsLoadRunIdRef = useRef(0);

    const favoriteFriendKeys = useMemo(() => {
        return new Set(props.favoriteFriends.map((ulid) => String(ulid || "").trim()).filter(Boolean));
    }, [props.favoriteFriends]);

    const socialFriendsRows = useMemo(() => {
        if (socialView !== "favorites") {
            return props.friendsRows;
        }

        return props.friendsRows.filter((friend) => {
            if (friend.isSelf) {
                return false;
            }

            return favoriteFriendKeys.has(String(friend.ulid || "").trim());
        });
    }, [favoriteFriendKeys, props.friendsRows, socialView]);

    const previewSocialView = hoveredSocialView ?? focusedSocialView;

    const selectedSocialTab = useMemo(() => {
        return SOCIAL_TABS.find((tab) => tab.view === socialView) ?? SOCIAL_TABS[0];
    }, [socialView]);

    const previewSocialTab = useMemo(() => {
        if (!previewSocialView) {
            return null;
        }

        return SOCIAL_TABS.find((tab) => tab.view === previewSocialView) ?? null;
    }, [previewSocialView]);

    const socialLabel = t(props.language, previewSocialTab?.labelKey ?? selectedSocialTab.labelKey);

    useEffect(() => {
        activityEventsRef.current = activityEvents;
    }, [activityEvents]);

    useEffect(() => {
        const nextView = props.socialEntryView;

        setSocialView(nextView);
        setFocusedSocialView(null);

        if (props.view !== "social") {
            return;
        }
        props.onSocialViewChange(nextView);
    }, [props.socialEntryToken]);

    const {
        mountedItems: visibleFriendsRows,
        markerRef: loadMoreMarkerRef,
        onItemFocus: maybeLoadMoreFromFocus
    } = useWindowedList({
        items: socialFriendsRows,
        dynamicLoading: dynamicFriendLoading,
        initialRows: dynamicInitialRows,
        rowStep: dynamicRowStep,
        prefetchDistance: dynamicPrefetchDistance,
        sentinelRootMargin: dynamicSentinelRootMargin,
        resetKey: socialView
    });

    const friendClickRef = useRef(props.onFriendClick);
    friendClickRef.current = props.onFriendClick;
    const friendFocusRef = useRef(props.onFriendFocus);
    friendFocusRef.current = props.onFriendFocus;
    const friendHoverRef = useRef(props.onFriendHover);
    friendHoverRef.current = props.onFriendHover;
    const friendUnhoverRef = useRef(props.onFriendUnhover);
    friendUnhoverRef.current = props.onFriendUnhover;
    const friendFavoriteRef = useRef(props.onFriendFavoriteToggle);
    friendFavoriteRef.current = props.onFriendFavoriteToggle;
    const friendRowFocusRef = useRef(maybeLoadMoreFromFocus);
    friendRowFocusRef.current = maybeLoadMoreFromFocus;

    function claimFocusAfterUnstar(friend: FriendRow, next: boolean) {
        if (next || socialView !== "favorites") {
            return;
        }

        const rows = socialFriendsRows;
        if (rows.length <= 1) {
            setBackClaimToken((token) => token + 1);
            return;
        }
        const removedIndex = rows.indexOf(friend);
        favoriteRowClaim.claimSlot(Math.min(Math.max(removedIndex, 0), rows.length - 2));
    }

    const unstarClaimRef = useRef(claimFocusAfterUnstar);
    unstarClaimRef.current = claimFocusAfterUnstar;

    const friendResolveAvatarRef = useRef(props.onFriendResolveAvatar);
    friendResolveAvatarRef.current = props.onFriendResolveAvatar;

    const gamepadCardActions = !props.mouseKeyboardMode;

    const friendRowList = useMemo<FriendRowListProps>(() => ({
        language: props.language,
        onFriendClick: (friend) => {
            void friendClickRef.current(friend);
        },
        onFriendFocus: (friend) => {
            friendFocusRef.current(friend);
        },
        onFriendHover: (friend) => {
            friendHoverRef.current(friend);
        },
        onFriendUnhover: (friend) => {
            friendUnhoverRef.current(friend);
        },
        onFriendFavoriteToggle: (friend, next) => {
            unstarClaimRef.current(friend, next);
            void friendFavoriteRef.current(friend, next);
        },
        onRowFocus: (index) => {
            friendRowFocusRef.current(index);
        },
        onFriendResolveAvatar: gamepadCardActions
            ? (friend: FriendRow) => {
                void friendResolveAvatarRef.current(friend);
            }
            : undefined
    }), [props.language, gamepadCardActions]);

    const avatarWarmInFlightRef = useRef(false);
    const desiredAvatarNamesRef = useRef<string[] | null>(null);

    const kickAvatarWarm = useCallback(async () => {
        if (avatarWarmInFlightRef.current) {
            return;
        }
        avatarWarmInFlightRef.current = true;
        try {
            while (desiredAvatarNamesRef.current) {
                const target = desiredAvatarNamesRef.current;
                desiredAvatarNamesRef.current = null;
                await prefetchUserAvatars(target);
            }
        } finally {
            avatarWarmInFlightRef.current = false;
        }
    }, []);

    useEffect(() => {
        if (props.view !== "social") {
            return;
        }
        if (socialView !== "friends" && socialView !== "favorites") {
            return;
        }
        if (visibleFriendsRows.length === 0) {
            return;
        }

        desiredAvatarNamesRef.current = visibleFriendsRows.map((friend) => friend.username);
        void kickAvatarWarm();
    }, [props.view, socialView, visibleFriendsRows, kickAvatarWarm]);


    const visibleActivityEvents = useMemo(() => {
        if (!dynamicActivityFeed) {
            return activityEvents;
        }

        return activityEvents.slice(0, activityMountedCount);
    }, [dynamicActivityFeed, activityEvents, activityMountedCount]);

    const rowMetrics = useMemo(() => {
        return achievementUiMetrics(props.uiSize);
    }, [props.uiSize]);

    const activityClickRef = useRef(props.onActivityCardClick);
    activityClickRef.current = props.onActivityCardClick;
    const activitySecondaryRef = useRef(props.onActivityCardSecondary);
    activitySecondaryRef.current = props.onActivityCardSecondary;
    const activityTertiaryRef = useRef(props.onActivityCardTertiary);
    activityTertiaryRef.current = props.onActivityCardTertiary;

    const activityRowList = useMemo<ActivityRowListProps>(() => ({
        language: props.language,
        showIcons: props.showIcons,
        metrics: rowMetrics,
        onActivityCardClick: (event) => {
            void activityClickRef.current(event);
        },
        onCardSecondary: gamepadCardActions
            ? (event: SocialActivityEvent) => {
                activitySecondaryRef.current(event);
            }
            : undefined,
        onCardTertiary: gamepadCardActions
            ? (event: SocialActivityEvent) => {
                activityTertiaryRef.current(event);
            }
            : undefined
    }), [props.language, props.showIcons, rowMetrics, gamepadCardActions]);

    const loadMoreActivity = useCallback(() => {
        if (!dynamicActivityFeed) {
            return;
        }

        setActivityMountedCount((current) => {
            if (current >= activityEvents.length) {
                return current;
            }

            return Math.min(current + dynamicRowStep, activityEvents.length);
        });
    }, [dynamicActivityFeed, dynamicRowStep, activityEvents.length]);

    useEffect(() => {
        if (!dynamicActivityFeed) {
            setActivityMountedCount(activityEvents.length);
            return;
        }

        setActivityMountedCount(Math.min(dynamicInitialRows, activityEvents.length));
    }, [dynamicActivityFeed, dynamicInitialRows, activityEvents.length]);

    useEffect(() => {
        if (!dynamicActivityFeed) {
            return;
        }
        if (socialView !== "activity") {
            return;
        }
        if (activityMountedCount >= activityEvents.length) {
            return;
        }

        const marker = activityLoadMoreMarkerRef.current;
        if (!marker) {
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    loadMoreActivity();
                }
            },
            { root: null, rootMargin: dynamicSentinelRootMargin, threshold: 0 }
        );

        observer.observe(marker);

        return () => {
            observer.disconnect();
        };
    }, [dynamicActivityFeed, dynamicSentinelRootMargin, activityEvents.length, activityMountedCount, loadMoreActivity, socialView]);

    const newSetsRowCount = props.newsEvents.newSetsResponse?.payload?.length ?? 0;

    const loadMoreNewSets = useCallback(() => {
        if (!dynamicNewSets) {
            return;
        }

        setNewSetsMountedCount((current) => {
            if (current >= newSetsRowCount) {
                return current;
            }
            return Math.min(current + dynamicNewSetsRowStep, newSetsRowCount);
        });
    }, [dynamicNewSets, dynamicNewSetsRowStep, newSetsRowCount]);

    useEffect(() => {
        if (!dynamicNewSets) {
            setNewSetsMountedCount(newSetsRowCount);
            return;
        }
        setNewSetsMountedCount(Math.min(dynamicNewSetsInitialRows, newSetsRowCount));
    }, [
        dynamicNewSets,
        dynamicNewSetsInitialRows,
        newSetsRowCount,
        props.newsEvents.newSetsFilter,
        props.newsEvents.newSetsResponse
    ]);

    useEffect(() => {
        if (!dynamicNewSets) {
            return;
        }
        if (socialView !== "newsEvents") {
            return;
        }
        if (props.newsEvents.subView !== "newSets") {
            return;
        }
        if (newSetsMountedCount >= newSetsRowCount) {
            return;
        }

        const marker = newSetsLoadMoreMarkerRef.current;
        if (!marker) {
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    loadMoreNewSets();
                }
            },
            {
                root: null,
                rootMargin: `${dynamicNewSetsSentinelRootMargin}px 0px`,
                threshold: 0
            }
        );

        observer.observe(marker);

        return () => {
            observer.disconnect();
        };
    }, [
        dynamicNewSets,
        dynamicNewSetsSentinelRootMargin,
        newSetsRowCount,
        newSetsMountedCount,
        loadMoreNewSets,
        socialView,
        props.newsEvents.subView
    ]);

    useEffect(() => {
        if (socialView !== "activity") {
            return;
        }

        const { isCurrentRun, cleanup } = beginGuardedRun(activityLoadRunIdRef);

        async function loadActivity() {
            setActivityError(null);

            try {
                const cached = await getSocialActivity();
                if (!isCurrentRun()) {
                    return;
                }
                if (cached.needsSettings) {
                    setActivityError(cached.error || null);
                    setActivityLoaded(true);
                    return;
                }
                const cachedEvents = cached.events || [];
                activityEventsRef.current = cachedEvents;
                setActivityEvents(cachedEvents);
                setActivityLoaded(true);
                if (cached.error) {
                    setActivityError(cached.error);
                }
            } catch (error: any) {
                if (isCurrentRun()) {
                    setActivityError(String(error?.message || error || "Couldn't load activity right now."));
                    setActivityLoaded(true);
                }
            }
        }

        void loadActivity();

        return cleanup;
    }, [activityRequestToken, props.socialEntryToken, props.language, socialView]);


    useEffect(() => {
        if (socialView !== "subscribedDiscussions" || subscriptionsLoaded) {
            return;
        }

        const { isCurrentRun, cleanup } = beginGuardedRun(subscriptionsLoadRunIdRef);

        async function loadSubscriptions() {
            try {
                const response = await getSubscriptions();
                if (!isCurrentRun()) {
                    return;
                }
                setSubscriptions(response?.subscriptions ?? []);
                setSubscriptionsLoaded(true);
            } catch {
                if (isCurrentRun()) {
                    setSubscriptions([]);
                    setSubscriptionsLoaded(true);
                }
            }
        }

        void loadSubscriptions();

        return cleanup;
    }, [socialView, subscriptionsLoaded]);

    useEffect(() => {
        if (!props.showIcons || subscriptions.length === 0) {
            return;
        }
        const entries = subscriptions
            .filter((sub) => sub.kind === "game")
            .map((sub) => ({ gameId: sub.gameId, imageIcon: sub.iconUrl }));
        if (entries.length === 0) {
            return;
        }
        void prefetchGameIcons(entries);
    }, [subscriptions, props.showIcons]);

    useEffect(() => {
        if (!props.showIcons || subscriptions.length === 0) {
            return;
        }

        const achievementSubs = subscriptions.filter(
            (sub) => sub.kind === "achievement" && sub.badgeName
        );
        if (achievementSubs.length === 0) {
            return;
        }

        const byGame = new Map<number, Subscription[]>();
        for (const sub of achievementSubs) {
            const group = byGame.get(sub.gameId) ?? [];
            group.push(sub);
            byGame.set(sub.gameId, group);
        }

        const seeded: Record<string, string> = {};
        for (const [gameId, subs] of byGame.entries()) {
            const cached = getCachedAchievementIcons(gameId, subs.map((sub) => sub.badgeName));
            for (const sub of subs) {
                const dataUri = cached[sub.badgeName];
                if (dataUri) {
                    seeded[sub.key] = dataUri;
                }
            }
        }
        if (Object.keys(seeded).length > 0) {
            setAchievementBadges((current) => ({ ...seeded, ...current }));
        }

        let cancelled = false;

        void (async () => {
            for (const [gameId, subs] of byGame.entries()) {
                const missing = subs.filter((sub) => !seeded[sub.key]);
                if (missing.length === 0) {
                    continue;
                }
                try {
                    const result = await getAchievementIcons(gameId, missing.map((sub) => sub.badgeName));
                    if (cancelled) {
                        return;
                    }
                    const icons = result?.icons ?? {};
                    cacheAchievementIcons(gameId, icons);
                    const resolved: Record<string, string> = {};
                    for (const sub of missing) {
                        const dataUri = icons[sub.badgeName];
                        if (dataUri) {
                            resolved[sub.key] = dataUri;
                        }
                    }
                    if (Object.keys(resolved).length > 0) {
                        setAchievementBadges((current) => ({ ...current, ...resolved }));
                    }
                } catch {
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [subscriptions, props.showIcons]);

    const handleSubscriptionOpen = useCallback((subscription: Subscription) => {
        if (props.onOpenSubscription) {
            void props.onOpenSubscription(subscription);
        }
    }, [props.onOpenSubscription]);

    const handleSubscriptionTrashBlur = (subscription: Subscription) => {
        setArmedSubKey((armed) => (armed === subscription.key ? null : armed));
    };

    const handleSubscriptionTrashPress = (subscription: Subscription) => {
        setSubscriptionsError(null);
        if (armedSubKey !== subscription.key) {
            setArmedSubKey(subscription.key);
            return;
        }
        setArmedSubKey(null);
        void (async () => {
            try {
                const removedIndex = subscriptions.findIndex((sub) => sub.key === subscription.key);
                const result = await removeSubscription(subscription.kind, subscription.id);
                if (result?.ok || result?.error === "not_found") {
                    setSubscriptions((current) => current.filter((sub) => sub.key !== subscription.key));
                    if (subscriptions.length <= 1) {
                        setBackClaimToken((token) => token + 1);
                        return;
                    }
                    subscriptionRowClaim.claimSlot(
                        Math.min(Math.max(removedIndex, 0), subscriptions.length - 2)
                    );
                    return;
                }
                setSubscriptionsError(t(props.language, "Couldn't unsubscribe. Try again."));
            } catch {
                setSubscriptionsError(t(props.language, "Couldn't unsubscribe. Try again."));
            }
        })();
    };

    const [armedSavedId, setArmedSavedId] = useState<string | null>(null);

    const savedSubTabActive = socialView === "subscribedDiscussions" && props.savedComments.subTab === "savedComments";
    const allSavedComments = props.savedComments.comments;
    const facetedSavedComments = useMemo(
        () => filterAndSortSavedComments(
            allSavedComments,
            props.savedComments.sort,
            props.savedComments.filter
        ),
        [allSavedComments, props.savedComments.sort, props.savedComments.filter]
    );
    const { mountedItems: visibleSavedComments, markerRef: savedListMarkerRef } = useWindowedList({
        items: facetedSavedComments,
        dynamicLoading: true,
        initialRows: SAVED_COMMENTS_INITIAL_ROWS,
        rowStep: SAVED_COMMENTS_ROW_STEP,
        prefetchDistance: 12,
        sentinelRootMargin: "300px",
        resetKey: `${props.savedComments.subTab}:${props.savedComments.filter}:${props.savedComments.sort}`
    });

    useEffect(() => {
        if (!savedSubTabActive || !props.showIcons) {
            return;
        }
        const names = visibleSavedComments.map((entry) => entry.user).filter((name) => !!name);
        if (names.length > 0) {
            void prefetchUserAvatars(names);
        }
    }, [savedSubTabActive, props.showIcons, visibleSavedComments]);

    const handleSavedCommentTrashBlur = (comment: SavedComment) => {
        setArmedSavedId((armed) => (armed === comment.id ? null : armed));
    };

    const handleSavedCommentTrashPress = (comment: SavedComment) => {
        if (armedSavedId !== comment.id) {
            setArmedSavedId(comment.id);
            return;
        }
        setArmedSavedId(null);
        void (async () => {
            const removedIndex = facetedSavedComments.findIndex((entry) => entry.id === comment.id);
            await props.savedComments.onTrash(comment);
            if (facetedSavedComments.length <= 1) {
                setBackClaimToken((token) => token + 1);
                return;
            }
            savedCommentRowClaim.claimSlot(
                Math.min(Math.max(removedIndex, 0), facetedSavedComments.length - 2)
            );
        })();
    };

    const savedOpenRef = useRef(props.savedComments.onOpen);
    savedOpenRef.current = props.savedComments.onOpen;
    const savedTrashPressRef = useRef(handleSavedCommentTrashPress);
    savedTrashPressRef.current = handleSavedCommentTrashPress;
    const savedTrashBlurRef = useRef(handleSavedCommentTrashBlur);
    savedTrashBlurRef.current = handleSavedCommentTrashBlur;

    const savedCommentList = useMemo<SavedCommentListProps>(() => ({
        language: props.language,
        metrics: rowMetrics,
        showIcons: props.showIcons,
        onOpen: (comment) => {
            void savedOpenRef.current(comment);
        },
        onTrashPress: (comment) => {
            savedTrashPressRef.current(comment);
        },
        onTrashBlur: (comment) => {
            savedTrashBlurRef.current(comment);
        }
    }), [props.language, rowMetrics, props.showIcons]);



    function handleSocialTabClick(nextView: SocialView) {
        setSocialView(nextView);
        setFocusedSocialView(null);
        if (nextView === "activity") {
            setActivityRequestToken((current) => current + 1);
        }
        props.onSocialTabClick();
        props.onSocialViewChange(nextView);
    }

    function handleSocialTabFocus(nextView: SocialView) {
        setFocusedSocialView(nextView);
    }

    function handleSocialTabBlur(nextView: SocialView) {
        setFocusedSocialView((current) => {
            if (current !== nextView) {
                return current;
            }

            return null;
        });
    }

    function handleSocialTabHover(nextView: SocialView) {
        setHoveredSocialView(nextView);
    }

    function handleSocialTabUnhover(nextView: SocialView) {
        setHoveredSocialView((current) => current === nextView ? null : current);
    }

    function handleAotwSortCycle() {
        if (!props.newsEvents.aotwCommentsLoaded) {
            return;
        }
        props.newsEvents.onChangeAotwCommentsSort(
            props.newsEvents.aotwCommentsSort === "newest" ? "oldest" : "newest"
        );
    }

    function socialTitle() {
        if (socialView === "friends") {
            return props.friendsPayload?.count
                ? t(props.language, "Friends ({{count}})", { count: props.friendsPayload.count })
                : t(props.language, "Friends");
        }

        if (socialView === "favorites") {
            return t(props.language, "Favorites ({{count}})", { count: socialFriendsRows.length });
        }

        return t(props.language, selectedSocialTab.labelKey);
    }

    if (props.view !== "social") {
        return null;
    }

    const aotwCardClaim = props.newsEvents.aotwCommentsCardClaim
        ?? props.newsEvents.aotwCommentsPostClaim;
    const restoreCurtainArmed = props.newsEvents.aotwRestorePending;
    const restoreCurtainSettled = !props.newsEvents.aotwHoldCommentsBody
        && (aotwCardClaim?.token ?? 0) > 0
        && !aotwCardClaim?.armed;

    const page = (
        <React.Fragment key={`social:view:${props.focusScopeResetToken}`}>
            <style>{FADE_IN_KEYFRAMES}</style>
            <PanelSection>
                <div>
                <PageNavStrip
                    title={t(props.language, "Social Hub")}
                    buttonSpacing={props.buttonSpacing}
                    onHome={props.onHome}
                />
                <BackButton
                    key={`back:${backClaimToken}`}
                    label={t(props.language, "← Back to Main")}
                    focusKey="social:back"
                    navAutoFocus={!props.newsEvents.aotwRestorePending}
                    buttonSpacing={props.buttonSpacing}
                    onClick={props.onBack}
                />
                <PanelSectionRow>
                    <div
                        style={{
                            width: "100%",
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                            padding: "14px 0 0 0"
                        }}
                    >
                        <Focusable
                            flow-children="row"
                            style={{
                                display: "flex",
                                gap: "8px",
                                width: "100%",
                                justifyContent: "space-between"
                            }}
                        >
                            {SOCIAL_TABS.map((tab) => {
                                const active = socialView === tab.view;
                                const previewed = previewSocialView === tab.view;
                                const Icon = tab.Icon;

                                return (
                                    <div
                                        key={tab.focusKey}
                                        data-focus-key={tab.focusKey}
                                        onMouseEnter={() => handleSocialTabHover(tab.view)}
                                        onMouseLeave={() => handleSocialTabUnhover(tab.view)}
                                        style={{ display: "flex" }}
                                    >
                                        <DialogButton
                                            onClick={() => handleSocialTabClick(tab.view)}
                                            onGamepadFocus={() => handleSocialTabFocus(tab.view)}
                                            onGamepadBlur={() => handleSocialTabBlur(tab.view)}
                                            style={{
                                                minWidth: 0,
                                                width: "42px",
                                                height: "38px",
                                                padding: "4px 2px",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                fontWeight: active ? 800 : 600,
                                                opacity: active || previewed ? 1 : 0.72,
                                                outline: active ? "1px solid rgba(255,255,255,0.65)" : undefined,
                                                boxShadow: previewed
                                                    ? "0 0 0 2px rgba(255,255,255,0.55), 0 2px 8px rgba(0,0,0,0.35)"
                                                    : undefined
                                            }}
                                        >
                                            <Icon size={18} />
                                        </DialogButton>
                                    </div>
                                );
                            })}
                        </Focusable>
                        <div
                            style={{
                                ...bodyTextStyle(),
                                width: "100%",
                                textAlign: "center",
                                fontWeight: 700,
                                opacity: 0.95
                            }}
                        >
                            {socialLabel}
                        </div>

                        <div
                            style={{
                                width: "100%",
                                padding: "0",
                                boxSizing: "border-box",
                                marginTop: "2px"
                            }}
                        >
                        {props.friendsError && socialView !== "newsEvents" && (
                            <ErrorText>{localizeRuntimeText(props.language, props.friendsError)}</ErrorText>
                        )}
                <div
                    style={{
                        fontSize: "18px",
                        fontWeight: 800,
                        letterSpacing: "0.02em",
                        lineHeight: 1.15,
                        textTransform: "uppercase",
                        margin: "6px 0 5px 0"
                    }}
                >
                    {socialTitle()}
                </div>
                <div
                    style={{
                        width: "100%",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px"
                    }}
                >
                {socialView === "activity" ? (
                    <>
                        {activityError && (
                            <PanelSectionRow>
                                <ErrorText>{localizeRuntimeText(props.language, activityError)}</ErrorText>
                            </PanelSectionRow>
                        )}
                        {!activityLoaded && activityEvents.length === 0 ? (
                            <PanelSectionRow>
                                <InlineSpinner label={t(props.language, "Loading")} />
                            </PanelSectionRow>
                        ) : activityEvents.length === 0 ? (
                            <PanelSectionRow>
                                <div
                                    style={{
                                        width: "100%",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "6px",
                                        alignItems: "center",
                                        textAlign: "center"
                                    }}
                                >
                                    <div style={{ fontSize: `${textSize(16)}px`, fontWeight: 700 }}>
                                        {t(props.language, "Nothing here yet.")}
                                    </div>
                                </div>
                            </PanelSectionRow>
                        ) : (
                            <>
                                {props.mouseKeyboardMode ? (
                                    <LabeledRow
                                        label={t(props.language, "Click")}
                                        value={activityCardActionLabel(props.socialHubCardAction, props.language)}
                                        onClick={props.onCycleSocialHubCardAction}
                                        focusKey="social:activity:action"
                                    />
                                ) : (
                                    <PanelSectionRow>
                                        <ButtonHints
                                            style={props.controllerGlyphStyle}
                                            hints={[
                                                { button: "a", label: t(props.language, "Achievement") },
                                                { button: "x", label: t(props.language, "Game") },
                                                { button: "y", label: t(props.language, "Profile") }
                                            ]}
                                        />
                                    </PanelSectionRow>
                                )}
                                {visibleActivityEvents.map((event) => (
                                    <ActivityFeedRow
                                        key={event.id}
                                        event={event}
                                        list={activityRowList}
                                    />
                                ))}
                                {dynamicActivityFeed && activityMountedCount < activityEvents.length && (
                                    <div
                                        ref={activityLoadMoreMarkerRef}
                                        style={{ width: "100%", height: "1px", opacity: 0 }}
                                    />
                                )}
                            </>
                        )}
                    </>
                ) : socialView === "subscribedDiscussions" ? (
                    <>
                        <Focusable
                            flow-children="row"
                            style={{
                                width: "100%",
                                display: "flex",
                                gap: "6px",
                                margin: "6px 0 4px 0"
                            }}
                        >
                            {COMMUNITY_SUB_TABS.map((tab) => (
                                <SubTabButton
                                    key={tab.value}
                                    label={t(props.language, tab.labelKey)}
                                    active={props.savedComments.subTab === tab.value}
                                    onClick={() => props.savedComments.onChangeSubTab(tab.value)}
                                    focusKey={tab.focusKey}
                                />
                            ))}
                        </Focusable>
                        {props.savedComments.subTab === "subscribed" ? (
                            <>
                        {subscriptionsError && (
                            <PanelSectionRow>
                                <ErrorText>{localizeRuntimeText(props.language, subscriptionsError)}</ErrorText>
                            </PanelSectionRow>
                        )}
                        {!subscriptionsLoaded && subscriptions.length === 0 ? (
                            <PanelSectionRow>
                                <InlineSpinner label={t(props.language, "Loading")} />
                            </PanelSectionRow>
                        ) : subscriptions.length === 0 ? (
                            <PanelSectionRow>
                                <div
                                    style={{
                                        width: "100%",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "6px",
                                        alignItems: "center",
                                        textAlign: "center"
                                    }}
                                >
                                    <div style={{ fontSize: `${textSize(16)}px`, fontWeight: 700 }}>
                                        {t(props.language, "Nothing here yet.")}
                                    </div>
                                </div>
                            </PanelSectionRow>
                        ) : (
                            <div
                                style={{ width: "100%", display: "flex", flexDirection: "column", gap: "4px" }}
                            >
                                {subscriptions.map((subscription, index) => (
                                    <ClaimedRow
                                        key={`subdiscussion:slot:${index}`}
                                        claim={subscriptionRowClaim}
                                        slotIndex={index}
                                    >
                                        <SubscriptionCard
                                            subscription={subscription}
                                            language={props.language}
                                            showIcons={props.showIcons}
                                            metrics={rowMetrics}
                                            badgeDataUri={achievementBadges[subscription.key] ?? null}
                                            armed={armedSubKey === subscription.key}
                                            onOpen={handleSubscriptionOpen}
                                            onTrashPress={handleSubscriptionTrashPress}
                                            onTrashBlur={handleSubscriptionTrashBlur}
                                        />
                                    </ClaimedRow>
                                ))}
                            </div>
                        )}
                            </>
                        ) : (
                            <>
                                {props.savedComments.error && (
                                    <PanelSectionRow>
                                        <ErrorText>{localizeRuntimeText(props.language, props.savedComments.error)}</ErrorText>
                                    </PanelSectionRow>
                                )}
                                {!props.savedComments.loaded && allSavedComments.length === 0 ? (
                                    <PanelSectionRow>
                                        <InlineSpinner label={t(props.language, "Loading")} />
                                    </PanelSectionRow>
                                ) : allSavedComments.length === 0 ? (
                                    <PanelSectionRow>
                                        <div
                                            style={{
                                                width: "100%",
                                                display: "flex",
                                                flexDirection: "column",
                                                gap: "6px",
                                                alignItems: "center",
                                                textAlign: "center"
                                            }}
                                        >
                                            <div style={{ fontSize: `${textSize(16)}px`, fontWeight: 700 }}>
                                                {t(props.language, "No saved comments yet.")}
                                            </div>
                                        </div>
                                    </PanelSectionRow>
                                ) : (
                                    <>
                                        <SavedCommentsFacetBar
                                            panel={props.savedComments}
                                            language={props.language}
                                            showIcons={props.showIcons}
                                        />
                                        {facetedSavedComments.length === 0 ? (
                                            <PanelSectionRow>
                                                <div
                                                    style={{
                                                        width: "100%",
                                                        display: "flex",
                                                        flexDirection: "column",
                                                        gap: "6px",
                                                        alignItems: "center",
                                                        textAlign: "center"
                                                    }}
                                                >
                                                    <div style={{ fontSize: `${textSize(15)}px`, fontWeight: 700, opacity: 0.85 }}>
                                                        {t(props.language, "No comments match these filters.")}
                                                    </div>
                                                </div>
                                            </PanelSectionRow>
                                        ) : (
                                            <div
                                                style={{ width: "100%", display: "flex", flexDirection: "column", gap: "4px" }}
                                            >
                                                {visibleSavedComments.map((comment, index) => (
                                                    <ClaimedRow
                                                        key={`savedcomment:slot:${index}`}
                                                        claim={savedCommentRowClaim}
                                                        slotIndex={index}
                                                    >
                                                        <SavedCommentCard
                                                            comment={comment}
                                                            armed={armedSavedId === comment.id}
                                                            list={savedCommentList}
                                                        />
                                                    </ClaimedRow>
                                                ))}
                                                {visibleSavedComments.length < facetedSavedComments.length && (
                                                    <div ref={savedListMarkerRef} style={{ height: "1px" }} />
                                                )}
                                            </div>
                                        )}
                                    </>
                                )}
                            </>
                        )}
                    </>
                ) : socialView === "newsEvents" ? (
                    <>
                        <Focusable
                            flow-children="row"
                            style={{
                                width: "100%",
                                display: "flex",
                                gap: "6px",
                                margin: "6px 0 4px 0"
                            }}
                        >
                            {NEWS_EVENTS_SUB_TABS.map((tab) => (
                                <SubTabButton
                                    key={tab.value}
                                    label={t(props.language, tab.labelKey)}
                                    active={props.newsEvents.subView === tab.value}
                                    onClick={() => props.newsEvents.onChangeSubView(tab.value)}
                                    focusKey={tab.focusKey}
                                />
                            ))}
                        </Focusable>
                        {props.newsEvents.subView === "news" ? (
                            <>
                                <FocusableItem
                                    focusKey="news:magazine-link"
                                    onClick={() => props.newsEvents.onOpenNewsLink("https://news.retroachievements.org/")}
                                >
                                    <div
                                        style={{
                                            width: "100%",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            padding: "8px 0",
                                            fontSize: "15px",
                                            fontWeight: 700,
                                            textAlign: "center"
                                        }}
                                    >
                                        {t(props.language, "RetroAchievements Magazine")}
                                    </div>
                                </FocusableItem>
                                {props.newsEvents.newsError && props.newsEvents.newsPayload && (
                                    <PanelSectionRow>
                                        <ErrorText>
                                            {localizeRuntimeText(props.language, props.newsEvents.newsError)}
                                        </ErrorText>
                                    </PanelSectionRow>
                                )}
                                {props.newsEvents.newsError && !props.newsEvents.newsPayload ? (
                                    <PanelSectionRow>
                                        <ErrorText>{t(props.language, "Couldn't load news.")}</ErrorText>
                                    </PanelSectionRow>
                                ) : props.newsEvents.newsLoading && !props.newsEvents.newsPayload ? (
                                    <PanelSectionRow>
                                        <InlineSpinner label={t(props.language, "Loading...")} />
                                    </PanelSectionRow>
                                ) : props.newsEvents.newsPayload && props.newsEvents.newsPayload.length === 0 ? (
                                    <PanelSectionRow>
                                        <div
                                            style={{
                                                width: "100%",
                                                display: "flex",
                                                flexDirection: "column",
                                                gap: "6px",
                                                alignItems: "center",
                                                textAlign: "center"
                                            }}
                                        >
                                            <div style={{ fontSize: `${textSize(16)}px`, fontWeight: 700 }}>
                                                {t(props.language, "No news available right now.")}
                                            </div>
                                        </div>
                                    </PanelSectionRow>
                                ) : (
                                    <>
                                        {props.newsEvents.newsPayload?.map((entry, index) => (
                                            <NewsCard
                                                key={entry.id ?? `${entry.link}:${index}`}
                                                entry={entry}
                                                language={props.language}
                                                metrics={rowMetrics}
                                                focusKey={`news:${entry.id ?? index}`}
                                                onOpen={props.newsEvents.onOpenNewsLink}
                                            />
                                        ))}
                                    </>
                                )}
                            </>
                        ) : props.newsEvents.subView === "aotw" ? (
                            <>
                                {props.newsEvents.aotwError && props.newsEvents.aotwResponse && (
                                    <PanelSectionRow>
                                        <ErrorText>
                                            {localizeRuntimeText(props.language, props.newsEvents.aotwError)}
                                        </ErrorText>
                                    </PanelSectionRow>
                                )}
                                {props.newsEvents.aotwError && !props.newsEvents.aotwResponse ? (
                                    <PanelSectionRow>
                                        <ErrorText>
                                            {t(props.language, "Couldn't load the Achievement of the Week.")}
                                        </ErrorText>
                                    </PanelSectionRow>
                                ) : props.newsEvents.aotwLoading && !props.newsEvents.aotwResponse ? (
                                    <PanelSectionRow>
                                        <InlineSpinner label={t(props.language, "Loading...")} />
                                    </PanelSectionRow>
                                ) : props.newsEvents.aotwResponse ? (
                                    <>
                                        {props.newsEvents.aotwResponse.payload && (
                                            <AotwHeader
                                                payload={props.newsEvents.aotwResponse.payload}
                                                currentUserHasUnlocked={
                                                    props.newsEvents.aotwResponse.currentUserHasUnlocked
                                                }
                                                language={props.language}
                                                uiSize={props.uiSize}
                                                showIcons={props.showIcons}
                                                onClickGameTitle={(() => {
                                                    const gameId = props.newsEvents.aotwResponse.payload?.game?.id ?? null;
                                                    const handler = props.newsEvents.onOpenGameOverview;
                                                    if (gameId == null || !handler) {
                                                        return undefined;
                                                    }
                                                    return () => handler(gameId);
                                                })()}
                                            />
                                        )}
                                        <Focusable
                                            flow-children="row"
                                            style={{
                                                width: "100%",
                                                display: "flex",
                                                gap: "6px",
                                                margin: "6px 0 4px 0"
                                            }}
                                        >
                                            {AOTW_SUB_TABS.map((tab) => (
                                                <SubTabButton
                                                    key={tab.value}
                                                    label={t(props.language, tab.labelKey)}
                                                    active={props.newsEvents.aotwSubView === tab.value}
                                                    onClick={() => props.newsEvents.onChangeAotwSubView(tab.value)}
                                                    focusKey={tab.focusKey}
                                                />
                                            ))}
                                        </Focusable>
                                        {props.newsEvents.aotwSubView === "unlocks" ? (
                                            (props.newsEvents.aotwResponse.payload?.unlocks?.length ?? 0) === 0 ? (
                                                <PanelSectionRow>
                                                    <div
                                                        style={{
                                                            width: "100%",
                                                            display: "flex",
                                                            flexDirection: "column",
                                                            gap: "6px",
                                                            alignItems: "center",
                                                            textAlign: "center"
                                                        }}
                                                    >
                                                        <div style={{ fontSize: `${textSize(16)}px`, fontWeight: 700 }}>
                                                            {t(props.language, "No unlocks yet.")}
                                                        </div>
                                                    </div>
                                                </PanelSectionRow>
                                            ) : (
                                                <>
                                                    {props.newsEvents.aotwResponse.payload?.unlocks.map((unlock, index) => (
                                                        <AotwUnlockRow
                                                            key={`${unlock.user}:${unlock.dateAwarded}:${index}`}
                                                            unlock={unlock}
                                                            language={props.language}
                                                            metrics={rowMetrics}
                                                            showIcons={props.showIcons}
                                                            focusKey={`aotw:unlock:${index}`}
                                                            onClick={(u: AotwUnlock) =>
                                                                props.newsEvents.onOpenUserProfile(u.user, u.ulid)
                                                            }
                                                        />
                                                    ))}
                                                </>
                                            )
                                        ) : (
                                            props.newsEvents.aotwHoldCommentsBody
                                                && !props.newsEvents.aotwCommentsLoaded ? (
                                                <PanelSectionRow>
                                                    <InlineSpinner label={t(props.language, "Loading comments...")} />
                                                </PanelSectionRow>
                                            ) : (props.newsEvents.aotwCommentsLoaded
                                                && props.newsEvents.aotwComments.length === 0
                                                && !props.newsEvents.aotwCommentsLoading
                                                && !props.newsEvents.aotwCommentsError) ? (
                                                <>
                                                    <PanelSectionRow>
                                                        <div style={bodyTextStyle()}>
                                                            {t(props.language, "No comments yet.")}
                                                        </div>
                                                    </PanelSectionRow>
                                                    {aotwSubscription.subscribeError ? (
                                                        <PanelSectionRow>
                                                            <ErrorText>{localizeRuntimeText(props.language, aotwSubscription.subscribeError)}</ErrorText>
                                                        </PanelSectionRow>
                                                    ) : null}
                                                    <FocusClaim
                                                        token={props.newsEvents.aotwCommentsPostClaim?.token ?? 0}
                                                        armed={props.newsEvents.aotwCommentsPostClaim?.armed ?? false}
                                                        onSpent={props.newsEvents.onSpendAotwCommentsPostClaim}
                                                    >
                                                        <CommentActionStrip
                                                            language={props.language}
                                                            isSubscribed={aotwSubscription.isSubscribed}
                                                            onPost={props.newsEvents.onPostAotwComment}
                                                            onToggleSubscribe={aotwSubscription.onToggleSubscribe}
                                                            postFocusKey="aotw:comments:post"
                                                            subscribeFocusKey="aotw:comments:subscribe"
                                                        />
                                                    </FocusClaim>
                                                </>
                                            ) : (
                                                <>
                                                    {aotwSubscription.subscribeError ? (
                                                        <PanelSectionRow>
                                                            <ErrorText>{localizeRuntimeText(props.language, aotwSubscription.subscribeError)}</ErrorText>
                                                        </PanelSectionRow>
                                                    ) : null}
                                                    {
}
                                                    <FocusClaim
                                                        token={props.newsEvents.aotwCommentsPostClaim?.token ?? 0}
                                                        armed={props.newsEvents.aotwCommentsPostClaim?.armed ?? false}
                                                        onSpent={props.newsEvents.onSpendAotwCommentsPostClaim}
                                                    >
                                                        <CommentActionStrip
                                                            language={props.language}
                                                            isSubscribed={aotwSubscription.isSubscribed}
                                                            onPost={props.newsEvents.onPostAotwComment}
                                                            onToggleSubscribe={aotwSubscription.onToggleSubscribe}
                                                            postFocusKey="aotw:comments:post"
                                                            subscribeFocusKey="aotw:comments:subscribe"
                                                        />
                                                    </FocusClaim>
                                                    <LabeledRow
                                                        focusKey="aotw:comments:sort"
                                                        onClick={handleAotwSortCycle}
                                                        label={t(props.language, "Sort")}
                                                        value={props.newsEvents.aotwCommentsSort === "newest"
                                                            ? t(props.language, "Newest")
                                                            : t(props.language, "Oldest")}
                                                    />
                                                    <CommentsList
                                                        comments={props.newsEvents.aotwComments}
                                                        language={props.language}
                                                        uiSize={props.uiSize}
                                                        showIcons={props.showIcons}
                                                        focusKeyPrefix="aotw:comment"
                                                        surfaceKey="comments:aotw"
                                                        onCommentClick={(c) =>
                                                            props.newsEvents.onOpenAotwComment(
                                                                c,
                                                                props.newsEvents.aotwResponse?.payload?.achievement?.id ?? null
                                                            )
                                                        }
                                                        dynamicLoading={props.dynamicComments}
                                                        dynamicSentinelRootMargin={props.dynamicCommentsSentinelRootMargin}
                                                        loading={props.newsEvents.aotwCommentsLoading}
                                                        loadingMore={props.newsEvents.aotwCommentsLoadingMore}
                                                        hasMore={props.newsEvents.aotwCommentsHasMore}
                                                        error={props.newsEvents.aotwCommentsError}
                                                        onLoadMore={props.newsEvents.onLoadMoreAotwComments}
                                                        emptyMessage={t(props.language, "No comments yet.")}
                                                        claimedCard={props.newsEvents.aotwCommentsCardClaim && {
                                                            ...props.newsEvents.aotwCommentsCardClaim,
                                                            onSpent: props.newsEvents.onSpendAotwCommentsCardClaim
                                                        }}
                                                        restoredWindow={props.newsEvents.aotwCommentsWindow}
                                                    />
                                                </>
                                            )
                                        )}
                                    </>
                                ) : null}
                            </>
                        ) : (
                            <>
                                <Focusable
                                    flow-children="row"
                                    style={{
                                        width: "100%",
                                        display: "flex",
                                        gap: "6px",
                                        margin: "6px 0 4px 0"
                                    }}
                                >
                                    {NEW_SETS_FILTER_TABS.map((tab) => (
                                        <SubTabButton
                                            key={tab.value}
                                            label={t(props.language, tab.labelKey)}
                                            active={props.newsEvents.newSetsFilter === tab.value}
                                            onClick={() => props.newsEvents.onChangeNewSetsFilter(tab.value)}
                                            focusKey={tab.focusKey}
                                        />
                                    ))}
                                </Focusable>
                                {props.newsEvents.newSetsError && props.newsEvents.newSetsResponse && (
                                    <PanelSectionRow>
                                        <ErrorText>
                                            {localizeRuntimeText(props.language, props.newsEvents.newSetsError)}
                                        </ErrorText>
                                    </PanelSectionRow>
                                )}
                                {props.newsEvents.newSetsError && !props.newsEvents.newSetsResponse ? (
                                    <PanelSectionRow>
                                        <ErrorText>
                                            {t(props.language, "Couldn't load new sets.")}
                                        </ErrorText>
                                    </PanelSectionRow>
                                ) : props.newsEvents.newSetsLoading && !props.newsEvents.newSetsResponse ? (
                                    <PanelSectionRow>
                                        <InlineSpinner label={t(props.language, "Loading...")} />
                                    </PanelSectionRow>
                                ) : (() => {
                                    const allRows = props.newsEvents.newSetsResponse?.payload ?? [];
                                    if (allRows.length === 0) {
                                        const emptyKey = props.newsEvents.newSetsFilter === "revision"
                                            ? "No revisions right now."
                                            : "No new sets right now.";
                                        return (
                                            <PanelSectionRow>
                                                <div
                                                    style={{
                                                        width: "100%",
                                                        display: "flex",
                                                        flexDirection: "column",
                                                        gap: "6px",
                                                        alignItems: "center",
                                                        textAlign: "center"
                                                    }}
                                                >
                                                    <div style={{ fontSize: `${textSize(16)}px`, fontWeight: 700 }}>
                                                        {t(props.language, emptyKey)}
                                                    </div>
                                                </div>
                                            </PanelSectionRow>
                                        );
                                    }
                                    const visibleRows: NewSetEntry[] = dynamicNewSets
                                        ? allRows.slice(0, newSetsMountedCount)
                                        : allRows;
                                    return (
                                        <>
                                            {visibleRows.map((entry, index) => (
                                                <NewSetCard
                                                    key={`${entry.id ?? "noid"}:${entry.gameId ?? "nogame"}:${index}`}
                                                    entry={entry}
                                                    language={props.language}
                                                    metrics={rowMetrics}
                                                    showIcons={props.showIcons}
                                                    focusKey={`newsets:${entry.id ?? index}`}
                                                    onOpen={(gameId) => props.newsEvents.onOpenNewSetGame(gameId)}
                                                />
                                            ))}
                                            {
}
                                            {dynamicNewSets && newSetsMountedCount < allRows.length && (
                                                <div
                                                    ref={newSetsLoadMoreMarkerRef}
                                                    style={{ width: "100%", height: "1px" }}
                                                />
                                            )}
                                        </>
                                    );
                                })()}
                            </>
                        )}
                    </>
                ) : !props.friendsLoaded ? (
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>{t(props.language, "Loading friends cache...")}</div>
                    </PanelSectionRow>
                ) : props.friendsRows.length === 0 ? (
                    <PanelSectionRow>
                        <div
                            style={{
                                width: "100%",
                                display: "flex",
                                flexDirection: "column",
                                gap: "6px",
                                alignItems: "center"
                            }}
                        >
                            <div style={{ fontSize: `${textSize(16)}px`, fontWeight: 700 }}>
                                {t(props.language, "No followed users found.")}
                            </div>
                            <div style={bodyTextStyle()}>
                                {t(props.language, "Open this page again after following users on RetroAchievements.")}
                            </div>
                        </div>
                    </PanelSectionRow>
                ) : socialView === "favorites" && socialFriendsRows.length === 0 ? (
                    <PanelSectionRow>
                        <div
                            style={{
                                width: "100%",
                                display: "flex",
                                flexDirection: "column",
                                gap: "6px",
                                alignItems: "center",
                                textAlign: "center"
                            }}
                        >
                            <div style={{ fontSize: `${textSize(16)}px`, fontWeight: 700 }}>
                                {t(props.language, "No favorite friends yet.")}
                            </div>
                            <div style={bodyTextStyle()}>
                                {t(props.language, "Use the star button on a friend to add them here.")}
                            </div>
                        </div>
                    </PanelSectionRow>
                ) : (
                    <>
                        <PanelSectionRow>
                            <div style={{ width: "100%", display: "flex", flexDirection: "column" }}>
                                {gamepadCardActions && (
                                    <ButtonHints
                                        style={props.controllerGlyphStyle}
                                        hints={[
                                            { button: "a", label: t(props.language, "Select") },
                                            {
                                                button: "x",
                                                label: socialView === "favorites"
                                                    ? t(props.language, "Unfavorite")
                                                    : t(props.language, "Favorite")
                                            },
                                            { button: "y", label: t(props.language, "Resolve") }
                                        ]}
                                    />
                                )}
                                <div style={{ ...bodyTextStyle(), opacity: 0.9, margin: "0 0 4px 0" }}>
                                    {t(props.language, props.friendAutoRefresh
                                        ? "Pause on a friend to refresh live info."
                                        : "View your friend's profile to refresh their info.")}
                                </div>
                            </div>
                        </PanelSectionRow>
                        {visibleFriendsRows.map((friend, index) => (
                            <ClaimedRow
                                key={`${socialView}:slot:${index}`}
                                claim={favoriteRowClaim}
                                slotIndex={index}
                            >
                                <FriendListRow
                                    friend={friend}
                                    index={index}
                                    favorite={favoriteFriendKeys.has(String(friend.ulid || "").trim())}
                                    liveRefreshing={props.liveRefreshingFriendUsernames.has(friend.username)}
                                    list={friendRowList}
                                />
                            </ClaimedRow>
                        ))}
                        {dynamicFriendLoading && visibleFriendsRows.length < socialFriendsRows.length && (
                            <div
                                ref={loadMoreMarkerRef}
                                style={{ width: "100%", height: "1px", opacity: 0 }}
                            />
                        )}
                    </>
                )}
                </div>
                        </div>
                    </div>
                </PanelSectionRow>
                </div>
            </PanelSection>
        </React.Fragment>
    );

    return (
        <RestoreCurtain
            armed={restoreCurtainArmed}
            settled={restoreCurtainSettled}
            covered={props.panelOverlayVisible}
        >
            {page}
        </RestoreCurtain>
    );
}

function ClaimedRow(props: { claim: FocusClaimController; slotIndex: number; children: ReactNode }) {
    const { claim, spend } = props.claim;
    const mine = claim && claim.slotIndex === props.slotIndex ? claim : null;

    return (
        <FocusClaim
            token={mine ? mine.token : 0}
            armed={mine !== null && mine.armed}
            onSpent={spend}
        >
            {props.children}
        </FocusClaim>
    );
}

type SubscriptionCardProps = {
    subscription: Subscription;
    language: LanguageCode;
    showIcons: boolean;
    metrics: ReturnType<typeof achievementUiMetrics>;
    badgeDataUri: string | null;
    armed: boolean;
    onOpen: (subscription: Subscription) => void;
    onTrashPress: (subscription: Subscription) => void;
    onTrashBlur: (subscription: Subscription) => void;
};

function savedSortLabel(sort: SavedCommentsSort, language: LanguageCode): string {
    if (sort === "oldest") {
        return t(language, "Oldest Added");
    }
    if (sort === "opened") {
        return t(language, "Recently Viewed");
    }
    return t(language, "Recently Added");
}

function SavedCommentsFilterValue(props: {
    games: SavedCommentGame[];
    filter: SavedCommentsFilter;
    showIcons: boolean;
    language: LanguageCode;
}) {
    const { games, filter, showIcons, language } = props;
    const selectedGame = typeof filter === "number" ? (games.find((game) => game.gameId === filter) ?? null) : null;
    const { iconDataUri } = useGameIcon(
        selectedGame && showIcons ? selectedGame.gameId : null,
        selectedGame?.imageIcon || null,
        "SavedCommentsFilterValue useGameIcon"
    );
    if (filter === "all") {
        return <>{t(language, "All")}</>;
    }
    if (filter === "achievement") {
        return <>{t(language, "Achievement")}</>;
    }
    if (filter === "wall") {
        return <>{t(language, "Wall Posts")}</>;
    }
    if (!selectedGame) {
        return <>{t(language, "All")}</>;
    }
    return (
        <span style={{ display: "inline-flex", alignItems: "flex-start", gap: "8px", minWidth: 0 }}>
            {showIcons && iconDataUri && (
                <span style={{ width: "22px", height: "22px", borderRadius: "5px", overflow: "hidden", flexShrink: 0, display: "inline-flex" }}>
                    <FadeImage
                        src={iconDataUri}
                        fadeOnLoad={false}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                </span>
            )}
            <span style={{ minWidth: 0, whiteSpace: "normal", overflowWrap: "break-word", wordBreak: "break-word", textAlign: "left" }}>
                {selectedGame.title}
            </span>
        </span>
    );
}

function SavedCommentsFacetBar(props: {
    panel: SavedCommentsPanelProps;
    language: LanguageCode;
    showIcons: boolean;
}) {
    const { panel, language, showIcons } = props;
    return (
        <>
            <LabeledRow
                focusKey="savedcomment:facet:filter"
                label={t(language, "Filter")}
                value={(
                    <SavedCommentsFilterValue
                        games={panel.games}
                        filter={panel.filter}
                        showIcons={showIcons}
                        language={language}
                    />
                )}
                onClick={panel.onOpenFilterPicker}
            />
            <LabeledRow
                focusKey="savedcomment:facet:sort"
                label={t(language, "Sort")}
                value={savedSortLabel(panel.sort, language)}
                onClick={panel.onCycleSort}
            />
        </>
    );
}

function SavedCommentContextBanner(props: {
    source: SavedCommentSource;
    showIcons: boolean;
    language: LanguageCode;
}) {
    const { source, showIcons, language } = props;

    if (source.kind === "game") {
        return (
            <GameContextBanner
                gameId={source.gameId}
                title={source.gameTitle}
                imageIcon={source.gameImageIcon}
                showIcons={showIcons}
            />
        );
    }

    if (source.kind === "achievement") {
        return (
            <AchievementContextBanner
                gameId={source.gameId}
                achievementTitle={source.achievementTitle}
                badgeName={source.achievementBadgeName}
                gameTitle={source.gameTitle}
                showIcons={showIcons}
            />
        );
    }

    const wallUser = String(source.wallUser || "").trim();
    if (!wallUser) {
        return null;
    }
    return (
        <PanelSectionRow>
            <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "10px 0 4px" }}>
                {showIcons && (
                    <UserAvatar username={wallUser} size={bannerSize(24)} fontSize={bannerSize(12)} />
                )}
                <span
                    style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: `${bannerSize(13)}px`,
                        opacity: 0.9,
                        overflowWrap: "break-word",
                        wordBreak: "break-word",
                        textAlign: "left"
                    }}
                >
                    {t(language, "{{user}}'s wall", { user: wallUser })}
                </span>
            </div>
        </PanelSectionRow>
    );
}

type SavedCommentListProps = {
    language: LanguageCode;
    metrics: AchievementUiMetrics;
    showIcons: boolean;
    onOpen: (comment: SavedComment) => void;
    onTrashPress: (comment: SavedComment) => void;
    onTrashBlur: (comment: SavedComment) => void;
};

const SavedCommentCard = React.memo(function SavedCommentCard(props: {
    comment: SavedComment;
    armed: boolean;
    list: SavedCommentListProps;
}) {
    const { comment, armed, list } = props;
    const { language, metrics, showIcons } = list;

    const [focused, setFocused] = useState(false);

    return (
        <PanelSectionRow>
            <div style={{ width: "100%", display: "flex", flexDirection: "column" }}>
                <SavedCommentContextBanner
                    source={comment.source}
                    showIcons={showIcons}
                    language={language}
                />
                <Focusable
                    flow-children="row"
                    style={{ position: "relative", display: "flex", alignItems: "stretch", width: "100%" }}
                >
                    <CommentCard
                        comment={comment}
                        language={language}
                        metrics={metrics}
                        showIcons={showIcons}
                        focusKey={`savedcomment:card:${comment.id}`}
                        onClick={() => list.onOpen(comment)}
                        outerStyle={{ width: "100%", minWidth: 0 }}
                        contentPaddingRight={30}
                    />
                    <div
                        data-focus-key={`savedcomment:trash:${comment.id}`}
                        style={{
                            position: "absolute",
                            top: "17px",
                            right: "8px",
                            zIndex: 2,
                            width: "32px",
                            height: "32px",
                            display: "flex"
                        }}
                    >
                        <DialogButton
                            onClick={() => list.onTrashPress(comment)}
                            onGamepadFocus={() => setFocused(true)}
                            onGamepadBlur={() => {
                                setFocused(false);
                                list.onTrashBlur(comment);
                            }}
                            style={{
                                minWidth: 0,
                                width: "32px",
                                height: "32px",
                                padding: 0,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: armed
                                    ? "rgba(255,255,255,0.98)"
                                    : focused
                                        ? "rgba(24,24,24,0.98)"
                                        : "rgba(255,255,255,0.92)",
                                background: armed
                                    ? "rgba(220,38,38,0.92)"
                                    : focused
                                        ? "rgba(255,255,255,0.96)"
                                        : "rgba(24,24,24,0.78)",
                                border: armed
                                    ? "1px solid rgba(255,255,255,0.9)"
                                    : focused
                                        ? "1px solid rgba(255,255,255,1)"
                                        : "1px solid rgba(255,255,255,0.36)",
                                boxShadow: focused
                                    ? "0 0 0 2px rgba(255,255,255,0.78), 0 2px 8px rgba(0,0,0,0.45)"
                                    : armed
                                        ? "0 0 0 2px rgba(220,38,38,0.65), 0 2px 8px rgba(0,0,0,0.45)"
                                        : "0 2px 6px rgba(0,0,0,0.35)",
                                transition: "background 120ms ease, box-shadow 120ms ease, color 120ms ease"
                            }}
                        >
                            <TrashIcon size={15} />
                        </DialogButton>
                    </div>
                </Focusable>
            </div>
        </PanelSectionRow>
    );
});

function SubscriptionCard(props: SubscriptionCardProps) {
    const { subscription, language, showIcons, metrics, badgeDataUri, armed, onOpen, onTrashPress, onTrashBlur } = props;
    const isGame = subscription.kind === "game";

    const [focused, setFocused] = useState(false);

    const { iconDataUri: gameIconDataUri, cold: gameIconCold } = useGameIcon(isGame ? subscription.gameId : null, subscription.iconUrl || null, "getGameIconCached (subscription card)");

    const iconDataUri = isGame ? gameIconDataUri : badgeDataUri;
    const fallbackLetter = (subscription.title.trim().charAt(0) || "?").toUpperCase();
    const cardTitle = t(language, "{{title}} Comments", { title: subscription.title });
    const bodyContext = isGame ? subscription.console : subscription.gameTitle;
    const bodyText = t(language, "{{context}} · Press A to view comments", {
        context: bodyContext || subscription.title
    });

    function handleCardClick() {
        onOpen(subscription);
    }

    function handleTrashClick() {
        onTrashPress(subscription);
    }

    return (
        <PanelSectionRow>
            <Focusable
                flow-children="row"
                style={{ position: "relative", display: "flex", alignItems: "stretch", width: "100%" }}
            >
                <FocusableItem
                    focusKey={`subdiscussion:card:${subscription.key}`}
                    onClick={handleCardClick}
                    outerStyle={{ width: "100%", minWidth: 0 }}
                >
                    <div
                        style={{
                            width: "100%",
                            display: "flex",
                            gap: `${Math.max(8, metrics.iconGap - 2)}px`,
                            alignItems: "flex-start",
                            padding: `${Math.max(3, Math.round(metrics.rowPaddingY * 0.42))}px 0`,
                            minWidth: 0
                        }}
                    >
                        {showIcons && (
                            <div
                                style={{
                                    width: `${metrics.iconSize}px`,
                                    height: `${metrics.iconSize}px`,
                                    borderRadius: "7px",
                                    overflow: "hidden",
                                    flexShrink: 0,
                                    background: "rgba(255,255,255,0.10)",
                                    border: "1px solid rgba(255,255,255,0.12)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: `${Math.max(16, metrics.iconSize * 0.42)}px`,
                                    fontWeight: 800
                                }}
                            >
                                {iconDataUri ? (
                                    <FadeImage
                                        src={iconDataUri}
                                        fadeOnLoad={isGame && gameIconCold}
                                        decoding="async"
                                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                    />
                                ) : (
                                    fallbackLetter
                                )}
                            </div>
                        )}
                        <div
                            style={{
                                flex: 1,
                                minWidth: 0,
                                display: "flex",
                                flexDirection: "column",
                                gap: `${Math.max(2, metrics.contentGap - 1)}px`,
                                textAlign: "left",
                                paddingRight: "30px"
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
                                {cardTitle}
                            </div>
                            <div
                                style={{
                                    ...smallTextStyle(),
                                    fontSize: `${metrics.bodyFontSize}px`,
                                    lineHeight: metrics.bodyLineHeight,
                                    opacity: 1,
                                    minWidth: 0,
                                    wordBreak: "break-word"
                                }}
                            >
                                {bodyText}
                            </div>
                        </div>
                    </div>
                </FocusableItem>

                <div
                    data-focus-key={`subdiscussion:trash:${subscription.key}`}
                    style={{
                        position: "absolute",
                        top: "17px",
                        right: "8px",
                        zIndex: 2,
                        width: "32px",
                        height: "32px",
                        display: "flex"
                    }}
                >
                    <DialogButton
                        onClick={handleTrashClick}
                        onGamepadFocus={() => setFocused(true)}
                        onGamepadBlur={() => {
                            setFocused(false);
                            onTrashBlur(subscription);
                        }}
                        style={{
                            minWidth: 0,
                            width: "32px",
                            height: "32px",
                            padding: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: armed
                                ? "rgba(255,255,255,0.98)"
                                : focused
                                    ? "rgba(24,24,24,0.98)"
                                    : "rgba(255,255,255,0.92)",
                            background: armed
                                ? "rgba(220,38,38,0.92)"
                                : focused
                                    ? "rgba(255,255,255,0.96)"
                                    : "rgba(24,24,24,0.78)",
                            border: armed
                                ? "1px solid rgba(255,255,255,0.9)"
                                : focused
                                    ? "1px solid rgba(255,255,255,1)"
                                    : "1px solid rgba(255,255,255,0.36)",
                            boxShadow: focused
                                ? "0 0 0 2px rgba(255,255,255,0.78), 0 2px 8px rgba(0,0,0,0.45)"
                                : armed
                                    ? "0 0 0 2px rgba(220,38,38,0.65), 0 2px 8px rgba(0,0,0,0.45)"
                                    : "0 2px 6px rgba(0,0,0,0.35)",
                            transition: "background 120ms ease, box-shadow 120ms ease, color 120ms ease"
                        }}
                    >
                        <TrashIcon size={15} />
                    </DialogButton>
                </div>
            </Focusable>
        </PanelSectionRow>
    );
}

export default SocialHubPage;
