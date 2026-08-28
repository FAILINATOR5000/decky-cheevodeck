import React, { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DialogButton, Focusable, PanelSection, PanelSectionRow } from "@decky/ui";
import { CompareAchievementRow, compareBorderFor, type CompareRowListProps } from "../components/achievements/CompareAchievementRow";
import { POINTS_LABEL_STYLES } from "../components/achievements/PointsLabel";
import { CompareHeader } from "../components/achievements/CompareHeader";
import { BackButton } from "../components/ui/BackButton";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { ErrorText } from "../components/ui/ErrorText";
import { FocusableItem } from "../components/ui/FocusableItem";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { getGamePayload } from "../api";
import { earned } from "../utils/achievements";
import { achievementUiMetrics, bodyTextStyle } from "../utils/style";
import { localizeRuntimeText, t, type LanguageCode } from "../locales";
import type {
    AchievementRow,
    AchievementStyle,
    ButtonSpacing,
    FriendGamePayload,
    FriendRow,
    NowPlayingCompareFilter,
    Payload,
    UiSize,
    ViewKey
} from "../types";

const FILTER_OPTIONS: { value: NowPlayingCompareFilter; labelKey: string }[] = [
    { value: "all", labelKey: "All" },
    { value: "onlyYou", labelKey: "Gains" },
    { value: "onlyThem", labelKey: "Losses" },
    { value: "shared", labelKey: "Shared" }
];

type FriendCompareGamePageState = {
    view: ViewKey;
    focusScopeResetToken: number;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    selectedFriend: FriendRow | null;
    friendGamePayload: FriendGamePayload | null;
    friendGameLoading: boolean;
    showIcons: boolean;
    achievementStyle: AchievementStyle;
    uiSize: UiSize;
    blockPadding: number;
    dynamicCompare: boolean;
    dynamicInitialRows: number;
    dynamicRowStep: number;
    dynamicSentinelRootMargin: number;
    dynamicPrefetchDistance?: number;
    showRetroPoints: boolean;
};

type FriendCompareGamePageActions = {
    onBack: () => void | Promise<void>;
    onAchievementClick?: (achievement: AchievementRow) => void | Promise<void>;
    onHome: () => void | Promise<void>;
};

type FriendCompareGamePageProps = {
    state: FriendCompareGamePageState;
    actions: FriendCompareGamePageActions;
};

function FilterChip(props: {
    label: string;
    active: boolean;
    onClick: () => void;
    focusKey: string;
    wrapperStyle?: CSSProperties;
}) {
    return (
        <div data-focus-key={props.focusKey} style={{ display: "flex", ...props.wrapperStyle }}>
            <DialogButton
                onClick={props.onClick}
                style={{
                    width: "100%",
                    minWidth: 0,
                    padding: "4px 14px",
                    fontSize: "13px",
                    fontWeight: props.active ? 800 : 600,
                    opacity: props.active ? 1 : 0.7,
                    outline: props.active ? "1px solid rgba(255,255,255,0.65)" : undefined,
                    textAlign: "center"
                }}
            >
                {props.label}
            </DialogButton>
        </div>
    );
}

function FriendCompareGamePage(props: FriendCompareGamePageProps) {
    const { state, actions } = props;
    const {
        view,
        focusScopeResetToken,
        language,
        buttonSpacing,
        selectedFriend,
        friendGamePayload,
        friendGameLoading,
        showIcons,
        achievementStyle,
        uiSize,
        blockPadding,
        dynamicCompare,
        dynamicInitialRows,
        dynamicRowStep,
        dynamicSentinelRootMargin,
        dynamicPrefetchDistance,
        showRetroPoints,
    } = state;

    const rootMargin = `${Math.max(0, dynamicSentinelRootMargin)}px 0px`;
    const initialRows = Math.max(1, dynamicInitialRows);
    const rowStep = Math.max(1, dynamicRowStep);
    const prefetchDistance = Math.max(1, dynamicPrefetchDistance ?? 12);

    const friendGameId = friendGamePayload?.selectedGameId ?? null;
    const friendUsername = (selectedFriend?.username || friendGamePayload?.friendUsername || "").trim();

    const [yourPayload, setYourPayload] = useState<Payload | null>(null);
    const [yourLoading, setYourLoading] = useState(false);
    const [yourError, setYourError] = useState<string | null>(null);
    const fetchRunIdRef = useRef(0);

    const loadYourPayload = useCallback(async () => {
        if (!friendGameId) {
            setYourPayload(null);
            setYourError(null);
            setYourLoading(false);
            return;
        }

        const runId = fetchRunIdRef.current + 1;
        fetchRunIdRef.current = runId;
        setYourLoading(true);
        setYourError(null);

        try {
            const result = await getGamePayload(friendGameId);
            if (fetchRunIdRef.current !== runId) {
                return;
            }
            if (result?.needsSettings) {
                setYourError(result.error || "Please enter your RetroAchievements username and Web API key.");
                setYourPayload(null);
                setYourLoading(false);
                return;
            }
            if (result?.error && !result.payload) {
                setYourError(result.error);
                setYourLoading(false);
                return;
            }
            setYourPayload(result?.payload ?? null);
            if (result?.error) {
                setYourError(result.error);
            }
            setYourLoading(false);
        } catch (e: any) {
            if (fetchRunIdRef.current !== runId) {
                return;
            }
            setYourError(String(e?.message || e || "Couldn't load comparison data."));
            setYourLoading(false);
        }
    }, [friendGameId]);

    useEffect(() => {
        if (view !== "friendCompare") {
            return;
        }
        if (!friendGameId) {
            setYourPayload(null);
            setYourError(null);
            setYourLoading(false);
            return;
        }
        void loadYourPayload();
    }, [view, friendGameId, loadYourPayload]);

    const [compareFilter, setCompareFilter] = useState<NowPlayingCompareFilter>("all");

    const compareRows = useMemo(() => {
        if (!yourPayload) {
            return [];
        }
        const friendAchievementsById = new Map<number, AchievementRow>();
        const friendPayload = friendGamePayload?.payload ?? null;
        if (friendPayload) {
            for (const friendAchievement of friendPayload.achievements ?? []) {
                friendAchievementsById.set(friendAchievement.id, friendAchievement);
            }
        }
        const rows = (yourPayload.achievements ?? []).map((mine) => ({
            achievement: mine,
            friendAchievement: friendAchievementsById.get(mine.id) ?? null
        }));
        rows.sort((a, b) => {
            const aOrder = a.achievement.displayOrder;
            const bOrder = b.achievement.displayOrder;
            if (aOrder !== bOrder) {
                return aOrder - bOrder;
            }
            return Number(a.achievement.id ?? 0) - Number(b.achievement.id ?? 0);
        });
        return rows;
    }, [yourPayload, friendGamePayload]);

    const filteredCompareRows = useMemo(() => {
        if (compareFilter === "all") {
            return compareRows;
        }
        if (compareFilter === "shared") {
            return compareRows.filter(({ achievement, friendAchievement }) => {
                return earned(achievement) && Boolean(friendAchievement && earned(friendAchievement));
            });
        }
        if (compareFilter === "onlyYou") {
            return compareRows.filter(({ achievement, friendAchievement }) => {
                return compareBorderFor(achievement, friendAchievement) === "green";
            });
        }
        return compareRows.filter(({ achievement, friendAchievement }) => {
            return compareBorderFor(achievement, friendAchievement) === "red";
        });
    }, [compareFilter, compareRows]);

    const friendHasGameData = Boolean(friendGamePayload?.payload);

    const [mountedCount, setMountedCount] = useState(() => {
        if (!dynamicCompare) {
            return filteredCompareRows.length;
        }
        return Math.min(initialRows, filteredCompareRows.length);
    });
    const loadMoreMarkerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!dynamicCompare) {
            setMountedCount(filteredCompareRows.length);
            return;
        }
        setMountedCount(Math.min(initialRows, filteredCompareRows.length));
    }, [
        dynamicCompare,
        friendUsername,
        friendGameId,
        compareFilter,
        initialRows,
        filteredCompareRows.length
    ]);

    const loadMoreCompareRows = useCallback(() => {
        if (!dynamicCompare) {
            return;
        }
        setMountedCount((current) => {
            if (current >= filteredCompareRows.length) {
                return current;
            }
            return Math.min(current + rowStep, filteredCompareRows.length);
        });
    }, [dynamicCompare, rowStep, filteredCompareRows.length]);

    function handleCompareRowFocus(index: number) {
        if (!dynamicCompare) {
            return;
        }
        if (index < mountedCount - prefetchDistance) {
            return;
        }
        loadMoreCompareRows();
    }

    const compareClickRef = useRef(actions.onAchievementClick);
    compareClickRef.current = actions.onAchievementClick;
    const compareFocusRef = useRef(handleCompareRowFocus);
    compareFocusRef.current = handleCompareRowFocus;

    const compareRowList = useMemo<CompareRowListProps>(() => ({
        language,
        showIcons,
        metrics: achievementUiMetrics(uiSize),
        blockPadding,
        achievementStyle,
        gameId: friendGameId,
        friendUsername,
        friendHasGameData,
        showRetroPoints,
        onAchievementClick: (achievement: AchievementRow) => {
            void compareClickRef.current?.(achievement);
        },
        onRowFocus: (index: number) => {
            compareFocusRef.current(index);
        }
    }), [
        language,
        showIcons,
        uiSize,
        blockPadding,
        achievementStyle,
        friendGameId,
        friendUsername,
        friendHasGameData,
        showRetroPoints
    ]);

    useEffect(() => {
        if (!dynamicCompare) {
            return;
        }
        if (view !== "friendCompare") {
            return;
        }
        if (mountedCount >= filteredCompareRows.length) {
            return;
        }
        const marker = loadMoreMarkerRef.current;
        if (!marker) {
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    loadMoreCompareRows();
                }
            },
            { root: null, rootMargin, threshold: 0 }
        );
        observer.observe(marker);

        return () => {
            observer.disconnect();
        };
    }, [dynamicCompare, view, mountedCount, filteredCompareRows.length, rootMargin, loadMoreCompareRows]);

    const visibleCompareRows = useMemo(() => {
        if (!dynamicCompare) {
            return filteredCompareRows;
        }
        return filteredCompareRows.slice(0, mountedCount);
    }, [dynamicCompare, filteredCompareRows, mountedCount]);

    if (view !== "friendCompare") {
        return null;
    }

    const isLoadingAnything = yourLoading || friendGameLoading;
    const headerTitle = friendUsername
        ? t(language, "Compare with {{name}}", { name: friendUsername })
        : t(language, "Compare");

    return (
        <React.Fragment key={`friendcompare:view:${focusScopeResetToken}`}>
            <PanelSection>
                <PageNavStrip
                    title={headerTitle}
                    buttonSpacing={buttonSpacing}
                    onHome={actions.onHome}
                />
                <BackButton
                    label={t(language, "← Back to Friend Profile")}
                    focusKey="friendcompare:back"
                    navAutoFocus
                    buttonSpacing={buttonSpacing}
                    onClick={actions.onBack}
                />
                <CompareHeader
                    language={language}
                    uiSize={uiSize}
                    friend={selectedFriend}
                    friendUsername={friendUsername}
                    currentPayload={yourPayload}
                    comparePayload={friendGamePayload}
                />
                <PanelSectionRow>
                    <Focusable
                        flow-children="grid"
                        style={{
                            width: "100%",
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "6px",
                            padding: "4px 0 6px 0"
                        }}
                    >
                        {FILTER_OPTIONS.map((option) => (
                            <FilterChip
                                key={option.value}
                                label={t(language, option.labelKey)}
                                active={compareFilter === option.value}
                                onClick={() => setCompareFilter(option.value)}
                                focusKey={`friendcompare:filter:${option.value}`}
                                wrapperStyle={option.value === "all" ? { flexBasis: "100%" } : { flex: "1 1 0", minWidth: 0 }}
                            />
                        ))}
                    </Focusable>
                </PanelSectionRow>
                {yourError && (
                    <PanelSectionRow>
                        <ErrorText>{localizeRuntimeText(language, yourError)}</ErrorText>
                    </PanelSectionRow>
                )}
                {isLoadingAnything && !yourPayload ? (
                    <PanelSectionRow>
                        <InlineSpinner label={t(language, "Loading comparison...")} />
                    </PanelSectionRow>
                ) : yourError && !yourPayload ? (
                    <PanelSectionRow>
                        <FocusableItem
                            focusKey="friendcompare:retry"
                            onClick={loadYourPayload}
                        >
                            <div style={{ textAlign: "center", fontWeight: 700 }}>
                                {t(language, "Retry")}
                            </div>
                        </FocusableItem>
                    </PanelSectionRow>
                ) : !yourPayload ? (
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>{t(language, "No current game loaded.")}</div>
                    </PanelSectionRow>
                ) : filteredCompareRows.length === 0 ? (
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>{t(language, "Nothing here yet.")}</div>
                    </PanelSectionRow>
                ) : (
                    <>
                        <style>{POINTS_LABEL_STYLES}</style>
                        {visibleCompareRows.map(({ achievement, friendAchievement }, index) => (
                            <CompareAchievementRow
                                key={`friendcompare:${achievement.id}`}
                                yourAchievement={achievement}
                                friendAchievement={friendAchievement}
                                index={index}
                                list={compareRowList}
                            />
                        ))}
                        {dynamicCompare && mountedCount < filteredCompareRows.length && (
                            <div
                                ref={loadMoreMarkerRef}
                                style={{ width: "100%", height: "1px", opacity: 0 }}
                            />
                        )}
                    </>
                )}
            </PanelSection>
        </React.Fragment>
    );
}

export default FriendCompareGamePage;
