import type { ViewKey } from "./types";

type BackAction = () => void | Promise<void>;

export interface RouteBackActions {
    goToAchievements: BackAction;
    backFromTracked: BackAction;
    backFromFriendProfile: BackAction;
    backFromAllGames: BackAction;
    backFromFriendCompare: BackAction;
    backToLeaderboardsSource: BackAction;
    backToLeaderboardsList: BackAction;
    backFromUnlockHistory: BackAction;
    backFromBadges: BackAction;
    backFromAbout: BackAction;
    backFromOptions: BackAction;
    backFromComparePicker: BackAction;
    backFromGameNotes: BackAction;
    backFromGameOverview: BackAction;
    backFromAchievementOverview: BackAction;
    backFromWantToPlay: BackAction;
    backFromFollowedRanking: BackAction;
    backFromTrackedSets: BackAction;
    closeTrackedSetToSelector: BackAction;
    backFromUtils: BackAction;
    backFromUtilityTool: BackAction;
}

export interface RouteRow {
    focusKey: string;
    mount: "always" | "whenActive";
    back?: (nav: RouteBackActions) => void | Promise<void>;
}

export const ROUTES: Record<ViewKey, RouteRow> = {
    achievements: { focusKey: "action:friends", mount: "always" },
    tracked: { focusKey: "tracked:back", mount: "always", back: (nav) => nav.backFromTracked() },
    social: { focusKey: "social:back", mount: "always", back: (nav) => nav.goToAchievements() },
    friendGame: { focusKey: "friendgame:back", mount: "always", back: (nav) => nav.backFromFriendProfile() },
    friendAllGames: { focusKey: "friendallgames:back", mount: "always", back: (nav) => nav.backFromAllGames() },
    friendCompare: { focusKey: "friendcompare:back", mount: "always", back: (nav) => nav.backFromFriendCompare() },
    leaderboards: { focusKey: "leaderboards:back", mount: "always", back: (nav) => nav.backToLeaderboardsSource() },
    leaderboardDetail: { focusKey: "leaderboarddetail:back", mount: "always", back: (nav) => nav.backToLeaderboardsList() },
    unlockHistory: { focusKey: "unlockhistory:back", mount: "always", back: (nav) => nav.backFromUnlockHistory() },
    badges: { focusKey: "badges:back", mount: "always", back: (nav) => nav.backFromBadges() },
    about: { focusKey: "about:back", mount: "always", back: (nav) => nav.backFromAbout() },
    options: { focusKey: "options:back", mount: "whenActive", back: (nav) => nav.backFromOptions() },
    comparePicker: { focusKey: "comparepicker:back", mount: "always", back: (nav) => nav.backFromComparePicker() },
    gameNotes: { focusKey: "gn:back", mount: "always", back: (nav) => nav.backFromGameNotes() },
    gameOverview: { focusKey: "gameoverview:back", mount: "whenActive", back: (nav) => nav.backFromGameOverview() },
    achievementOverview: { focusKey: "ao:back", mount: "whenActive", back: (nav) => nav.backFromAchievementOverview() },
    wantToPlay: { focusKey: "wanttoplay:back", mount: "always", back: (nav) => nav.backFromWantToPlay() },
    followedRanking: { focusKey: "followedranking:back", mount: "always", back: (nav) => nav.backFromFollowedRanking() },
    trackedSets: { focusKey: "trackedsets:back", mount: "always", back: (nav) => nav.backFromTrackedSets() },
    trackedSetOpen: { focusKey: "trackedsetopen:back", mount: "always", back: (nav) => nav.closeTrackedSetToSelector() },
    utils: { focusKey: "utils:back", mount: "always", back: (nav) => nav.backFromUtils() },
    dolphinMapper: { focusKey: "dolphinMapper:back", mount: "always", back: (nav) => nav.backFromUtilityTool() },
    smbShares: { focusKey: "smbShares:back", mount: "always", back: (nav) => nav.backFromUtilityTool() },
    cheevoCheck: { focusKey: "cheevocheck:back", mount: "always", back: (nav) => nav.backFromUtilityTool() },
    fileWatcher: { focusKey: "fileWatcher:back", mount: "always", back: (nav) => nav.backFromUtilityTool() },
    guides: { focusKey: "guides:back", mount: "always" }
};

export const ALL_VIEW_KEYS = Object.keys(ROUTES) as ViewKey[];
