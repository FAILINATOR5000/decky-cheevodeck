import { PanelSection, PanelSectionRow } from "@decky/ui";
import React, { useEffect, useMemo, useRef } from "react";
import { prefetchUserAvatars } from "../api";
import { BackButton } from "../components/ui/BackButton";
import { ErrorText } from "../components/ui/ErrorText";
import { FocusableItem } from "../components/ui/FocusableItem";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { LabeledRow } from "../components/ui/LabeledRow";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { UserAvatar } from "../components/ui/UserAvatar";
import { useWindowedList } from "../hooks/useWindowedList";
import type {
    ButtonSpacing,
    FriendRow,
    LeaderboardAudience,
    LeaderboardEntriesPayload,
    LeaderboardEntryRow,
    LeaderboardRow,
    LeaderboardUserEntryPayload,
    UiSize,
    ViewKey
} from "../types";

import { leaderboardAudienceLabel, nextLeaderboardAudience } from "../utils/achievements";
import { logError } from "../utils/errors";
import { openExternalUrl, raLeaderboardCommentsUrl } from "../utils/navigation";
import { achievementUiMetrics, type AchievementUiMetrics, rankGutterWidth, regularButtonSpacingStyle, smallTextStyle, bodyTextStyle } from "../utils/style";
import {
    DEFAULT_LANGUAGE,
    localizeRuntimeText,
    t,
    type LanguageCode
} from "../locales";

const MAX_LEADERBOARD_RESULTS = 500;

const SELF_ROW_KEYFRAMES = `
@keyframes da-leaderboard-self-glow {
    0%, 100% {
        border-left-color: rgba(245, 200, 50, 0.55);
        box-shadow: 0 0 0 0 rgba(245, 200, 50, 0);
    }
    50% {
        border-left-color: rgba(255, 215, 100, 1);
        box-shadow: 0 0 8px 1px rgba(245, 200, 50, 0.45);
    }
}
@media (prefers-reduced-motion: reduce) {
    .da-leaderboard-self {
        animation: none !important;
        border-left-color: rgba(255, 215, 100, 1) !important;
    }
}
`;

type LeaderboardDetailPageProps = {
    state: {
        view: ViewKey;
        language: LanguageCode;
        selectedLeaderboard: LeaderboardRow | null;
        buttonSpacing: ButtonSpacing;
        leaderboardEntriesPayload: LeaderboardEntriesPayload | null;
        leaderboardEntriesLoading: boolean;
        leaderboardEntriesError: string | null;
        leaderboardUserEntryPayload: LeaderboardUserEntryPayload | null;
        leaderboardUserEntryLoading: boolean;
        leaderboardUserEntryError: string | null;
        leaderboardAudience: LeaderboardAudience;
        dynamicLeaderboardResults: boolean;
        dynamicInitialRows: number;
        dynamicRowStep: number;
        dynamicPrefetchDistance: number;
        dynamicSentinelRootMargin: number;
        showIcons: boolean;
        uiSize: UiSize;
        friendsByUsername: Map<string, FriendRow>;
        selfUsername: string;
    };
    actions: {
        onBack: () => void | Promise<void>;
        onAudienceChange: (next: LeaderboardAudience) => void | Promise<void>;
        onOpenUserProfile: (username: string) => void | Promise<void>;
        onHome: () => void | Promise<void>;
    };
};

function leaderboardComparisonStats(rank?: number | null, total?: number | null) {
    const safeRank = Math.max(0, Number(rank ?? 0));
    const safeTotal = Math.max(0, Number(total ?? 0));
    if (!safeRank || !safeTotal) {
        return null;
    }
    const topPercent = ((safeRank / safeTotal) * 100).toFixed(1).replace(/\.0$/, "");
    const aheadPercent = (((safeTotal - safeRank) / safeTotal) * 100).toFixed(1).replace(/\.0$/, "");
    return { topPercent, aheadPercent };
}

function leaderboardTimeLabel(value?: string | null, language: LanguageCode = DEFAULT_LANGUAGE) {
    if (!value) {
        return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }
    const localeTag = language === "en" ? undefined : language;
    return parsed.toLocaleDateString(localeTag);
}

type LeaderboardEntryListProps = {
    language: LanguageCode;
    showIcons: boolean;
    metrics: AchievementUiMetrics;
    selfUsername: string;
    rankWidth: number;
    onFocusIndex: (index: number) => void;
    onOpenProfile: (username: string) => void;
};

type LeaderboardEntryRowViewProps = {
    entry: LeaderboardEntryRow;
    index: number;
    list: LeaderboardEntryListProps;
};

const LeaderboardEntryRowView = React.memo(function LeaderboardEntryRowView(props: LeaderboardEntryRowViewProps) {
    const { entry, list } = props;
    const { language, showIcons, metrics, selfUsername, rankWidth } = list;
    const username = String(entry.user || "").trim();
    const isSelf = username.length > 0 && username.toLowerCase() === selfUsername.trim().toLowerCase();
    const scoreText = entry.formattedScore || (entry.score != null ? String(entry.score) : "") || "-";
    const dateText = leaderboardTimeLabel(entry.dateSubmitted, language);

    function handleFocus() {
        list.onFocusIndex(props.index);
    }

    function handleClick() {
        list.onOpenProfile(username);
    }

    return (
        <FocusableItem
            focusKey={`leaderboarddetail:entry:${entry.rank}:${username}`}
            onFocus={handleFocus}
            onClick={handleClick}
            outerStyle={{ width: "100%", minWidth: 0 }}
        >
            <div
                className={isSelf ? "da-leaderboard-self" : undefined}
                style={{
                    width: "100%",
                    display: "flex",
                    gap: `${Math.max(8, metrics.iconGap - 2)}px`,
                    alignItems: "center",
                    padding: `${Math.max(3, Math.round(metrics.rowPaddingY * 0.42))}px 0`,
                    paddingLeft: isSelf ? "8px" : undefined,
                    borderLeft: isSelf ? "3px solid rgba(255, 215, 100, 1)" : undefined,
                    animation: isSelf ? "da-leaderboard-self-glow 2.4s ease-in-out infinite" : undefined,
                    minWidth: 0
                }}
            >
                <div
                    style={{
                        width: `${rankWidth}px`,
                        flexShrink: 0,
                        textAlign: "right",
                        fontWeight: 800,
                        fontSize: `${metrics.titleFontSize}px`,
                        lineHeight: metrics.titleLineHeight,
                        opacity: 0.92
                    }}
                >
                    #{entry.rank}
                </div>
                {showIcons && (
                    <UserAvatar
                        username={username}
                        size={metrics.iconSize}
                        fontSize={Math.max(16, metrics.iconSize * 0.42)}
                    />
                )}
                <div
                    style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: `${Math.max(2, metrics.contentGap - 1)}px`,
                        textAlign: "left"
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
                        {username}
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
                        {dateText ? `${scoreText} · ${dateText}` : scoreText}
                    </div>
                </div>
            </div>
        </FocusableItem>
    );
});

function LeaderboardDetailPage({ state, actions }: LeaderboardDetailPageProps) {
    const dynamicLeaderboardResults = state.dynamicLeaderboardResults ?? true;
    const dynamicInitialRows = Math.max(1, state.dynamicInitialRows ?? 30);
    const dynamicRowStep = Math.max(1, state.dynamicRowStep ?? 30);
    const dynamicPrefetchDistance = Math.max(1, state.dynamicPrefetchDistance ?? 12);
    const dynamicSentinelRootMargin = `${Math.max(0, state.dynamicSentinelRootMargin ?? 600)}px 0px`;
    const userEntry = state.leaderboardUserEntryPayload?.userEntry ?? null;
    const userStats = leaderboardComparisonStats(
        userEntry?.rank,
        state.leaderboardEntriesPayload?.total
    );

    const allEntries = useMemo(
        () => state.leaderboardEntriesPayload?.results ?? [],
        [state.leaderboardEntriesPayload?.results]
    );

    const friendUlids = useMemo(() => {
        const ids = new Set<string>();
        state.friendsByUsername.forEach((friend) => {
            const ulid = String(friend.ulid || "").trim();
            if (ulid) {
                ids.add(ulid);
            }
        });
        return ids;
    }, [state.friendsByUsername]);

    const selfUlid = String(state.leaderboardUserEntryPayload?.userEntry?.ulid || "").trim();
    const selfNameLower = state.selfUsername.trim().toLowerCase();

    const audienceEntries = useMemo(() => {
        if (state.leaderboardAudience !== "friends") {
            return allEntries;
        }
        return allEntries.filter((entry) => {
            const entryUlid = String(entry.ulid || "").trim();
            const name = String(entry.user || "").trim().toLowerCase();
            return entryUlid
                ? (entryUlid === selfUlid || friendUlids.has(entryUlid))
                : (name === selfNameLower || state.friendsByUsername.has(name));
        });
    }, [allEntries, state.leaderboardAudience, friendUlids, selfUlid, selfNameLower, state.friendsByUsername]);

    const audienceEntriesKey = useMemo(
        () => audienceEntries.map((entry) => `${entry.rank}:${entry.user}`).join("|"),
        [audienceEntries]
    );

    const widestRank = useMemo(() => {
        let widest = 1;
        for (const entry of audienceEntries) {
            const value = Math.floor(Number(entry.rank ?? 0));
            if (value > widest) {
                widest = value;
            }
        }
        return widest;
    }, [audienceEntries]);
    const rankWidth = rankGutterWidth(state.uiSize, widestRank);
    const {
        mountedItems: visibleEntries,
        markerRef: loadMoreMarkerRef,
        onItemFocus: maybeLoadMoreFromFocus
    } = useWindowedList({
        items: audienceEntries,
        dynamicLoading: dynamicLeaderboardResults,
        initialRows: dynamicInitialRows,
        rowStep: dynamicRowStep,
        prefetchDistance: dynamicPrefetchDistance,
        sentinelRootMargin: dynamicSentinelRootMargin,
        resetKey: audienceEntriesKey
    });

    const openProfileRef = useRef(actions.onOpenUserProfile);
    openProfileRef.current = actions.onOpenUserProfile;
    const entryFocusRef = useRef(maybeLoadMoreFromFocus);
    entryFocusRef.current = maybeLoadMoreFromFocus;

    const entryRowList = useMemo<LeaderboardEntryListProps>(() => ({
        language: state.language,
        showIcons: state.showIcons,
        metrics: achievementUiMetrics(state.uiSize),
        selfUsername: state.selfUsername,
        rankWidth,
        onFocusIndex: (index) => {
            entryFocusRef.current(index);
        },
        onOpenProfile: (username) => {
            void openProfileRef.current(username);
        }
    }), [state.language, state.showIcons, state.uiSize, state.selfUsername, rankWidth]);

    useEffect(() => {
        if (state.view !== "leaderboardDetail") {
            return;
        }
        if (!state.showIcons) {
            return;
        }
        const usernames = visibleEntries
            .map((entry) => String(entry.user || "").trim())
            .filter((name) => name.length > 0);
        if (usernames.length === 0) {
            return;
        }
        void (async () => {
            try {
                await prefetchUserAvatars(usernames);
            }
            catch (e) {
                logError("LeaderboardDetailPage prefetchUserAvatars", e);
            }
        })();
    }, [state.view, state.showIcons, visibleEntries]);

    function handleFilterClick() {
        void actions.onAudienceChange(nextLeaderboardAudience(state.leaderboardAudience));
    }

    function openLeaderboardComments() {
        const id = state.selectedLeaderboard?.id;
        if (id == null) {
            return;
        }
        void openExternalUrl(raLeaderboardCommentsUrl(id));
    }

    if (state.view !== "leaderboardDetail") {
        return null;
    }

    const hasFetchedEntries = allEntries.length > 0;

    return (
        <>
            <style>{SELF_ROW_KEYFRAMES}</style>
            <PanelSection>
                <PageNavStrip
                    title={t(state.language, "Leaderboard")}
                    buttonSpacing={state.buttonSpacing}
                    onHome={actions.onHome}
                />
                <BackButton
                    label={t(state.language, "← Back to Leaderboards")}
                    focusKey="leaderboarddetail:back"
                    navAutoFocus
                    buttonSpacing={state.buttonSpacing}
                    onClick={actions.onBack}
                />
                {state.selectedLeaderboard && (
                    <PanelSectionRow>
                        <FocusableItem
                            outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                            focusKey="leaderboarddetail:comments"
                            onClick={openLeaderboardComments}
                        >
                            {t(state.language, "Comments")}
                        </FocusableItem>
                    </PanelSectionRow>
                )}
            </PanelSection>
            <PanelSection title={state.selectedLeaderboard?.title || t(state.language, "Leaderboard")}>
                {state.selectedLeaderboard?.description && (
                    <>
                        <PanelSectionRow>
                            <div style={{ ...bodyTextStyle(), fontWeight: 700 }}>{state.selectedLeaderboard.description}</div>
                        </PanelSectionRow>
                        <PanelSectionRow>
                            <div style={{ height: "8px" }} />
                        </PanelSectionRow>
                    </>
                )}
                {state.leaderboardUserEntryLoading ? (
                    <PanelSectionRow>
                        <InlineSpinner label={t(state.language, "Loading your standing...")} />
                    </PanelSectionRow>
                ) : userEntry ? (
                    <>
                        <PanelSectionRow>
                            <div style={bodyTextStyle()}>
                                <strong>{t(state.language, "Your Rank")}:</strong> #{userEntry.rank ?? "-"}
                            </div>
                        </PanelSectionRow>
                        <PanelSectionRow>
                            <div style={bodyTextStyle()}>
                                <strong>{t(state.language, "Your Score")}:</strong>{" "}
                                {userEntry.formattedScore || userEntry.score || "-"}
                            </div>
                        </PanelSectionRow>
                        <PanelSectionRow>
                            <div style={bodyTextStyle()}>
                                <strong>{t(state.language, "Entry Date")}:</strong>{" "}
                                {leaderboardTimeLabel(userEntry.dateUpdated, state.language) || "-"}
                            </div>
                        </PanelSectionRow>
                        {userStats && (
                            <PanelSectionRow>
                                <div style={bodyTextStyle()}>
                                    <strong>{t(state.language, "Standing")}:</strong>{" "}
                                    {t(state.language, "Top {{topPercent}}% • Ahead of {{aheadPercent}}%", {
                                        topPercent: userStats.topPercent,
                                        aheadPercent: userStats.aheadPercent
                                    })}
                                </div>
                            </PanelSectionRow>
                        )}
                    </>
                ) : (
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>
                            {t(
                                state.language,
                                "No submitted score found for your account on this leaderboard yet."
                            )}
                        </div>
                    </PanelSectionRow>
                )}
                {(state.leaderboardUserEntryError || state.leaderboardEntriesError) && (
                    <PanelSectionRow>
                        <ErrorText>
                            {localizeRuntimeText(
                                state.language,
                                state.leaderboardUserEntryError || state.leaderboardEntriesError
                            )}
                        </ErrorText>
                    </PanelSectionRow>
                )}
            </PanelSection>
            <PanelSection title={t(state.language, "View Options")}>
                <PanelSectionRow>
                    <LabeledRow
                        outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                        focusKey="leaderboarddetail:filter"
                        label={t(state.language, "Filter")}
                        value={leaderboardAudienceLabel(state.leaderboardAudience, state.language)}
                        onClick={handleFilterClick}
                    />
                </PanelSectionRow>
            </PanelSection>
            <PanelSection
                title={`${t(state.language, "Top Players")}${state.leaderboardEntriesPayload?.total ? ` (${Math.min(state.leaderboardEntriesPayload.total, MAX_LEADERBOARD_RESULTS)})` : ""
                    }`}
            >
                {!hasFetchedEntries ? (
                    <PanelSectionRow>
                        {state.leaderboardEntriesLoading ? (
                            <InlineSpinner label={t(state.language, "Loading results...")} />
                        ) : (
                            <div style={bodyTextStyle()}>
                                {t(state.language, "No leaderboard entries returned.")}
                            </div>
                        )}
                    </PanelSectionRow>
                ) : audienceEntries.length === 0 ? (
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>
                            {t(state.language, "None of your friends are on this leaderboard yet.")}
                        </div>
                    </PanelSectionRow>
                ) : (
                    <>
                        {visibleEntries.map((entry, index) => (
                            <LeaderboardEntryRowView
                                key={`${state.selectedLeaderboard?.id ?? "lb"}:${entry.rank}:${entry.user}`}
                                entry={entry}
                                index={index}
                                list={entryRowList}
                            />
                        ))}
                        {dynamicLeaderboardResults && visibleEntries.length < audienceEntries.length && (
                            <div
                                ref={loadMoreMarkerRef}
                                style={{ width: "100%", height: "1px", opacity: 0 }}
                            />
                        )}
                    </>
                )}
            </PanelSection>
        </>
    );
}

export default LeaderboardDetailPage;
