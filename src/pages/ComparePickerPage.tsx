import React, { useEffect, useMemo, useRef } from "react";
import { Focusable, PanelSection, PanelSectionRow } from "@decky/ui";
import { BackButton } from "../components/ui/BackButton";
import { ErrorText } from "../components/ui/ErrorText";
import { FocusableItem } from "../components/ui/FocusableItem";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { UserAvatar } from "../components/ui/UserAvatar";
import { prefetchUserAvatars } from "../api";
import { useWindowedList } from "../hooks/useWindowedList";
import { localizeRuntimeText, t, type LanguageCode } from "../locales";
import type { ButtonSpacing, FriendRow, ViewKey } from "../types";
import { isFriendAvatarStale, sortFriendRowsForDisplay } from "../utils/friends";
import { logError } from "../utils/errors";
import { titleSize } from "../utils/scale";
import { regularButtonSpacingStyle, smallTextStyle, bodyTextStyle } from "../utils/style";

type ComparePickerPageState = {
    view: ViewKey;
    focusScopeResetToken: number;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    friendsRows: FriendRow[];
    favoriteFriends: string[];
    friendsLoaded: boolean;
    friendsRefreshing: boolean;
    friendsError: string | null;
    selectedFriendUsername: string | null;
    dynamicFriendPicker: boolean;
    dynamicInitialRows: number;
    dynamicRowStep: number;
    dynamicPrefetchDistance: number;
    dynamicSentinelRootMargin: number;
};

type ComparePickerPageActions = {
    onBack: () => void | Promise<void>;
    onPickFriend: (friend: FriendRow) => void | Promise<void>;
    onHome: () => void | Promise<void>;
};

type ComparePickerPageProps = {
    state: ComparePickerPageState;
    actions: ComparePickerPageActions;
};

type FriendPickerRowListProps = {
    onPick: (friend: FriendRow) => void;
    onRowFocus: (index: number) => void;
};

type FriendPickerRowProps = {
    friend: FriendRow;
    selected: boolean;
    index: number;
    list: FriendPickerRowListProps;
};

const FriendPickerRow = React.memo(function FriendPickerRow(props: FriendPickerRowProps) {
    const { friend, selected, list } = props;

    function handleClick() {
        list.onPick(friend);
    }

    function handleFocus() {
        list.onRowFocus(props.index);
    }

    return (
        <FocusableItem
            outerStyle={{ width: "100%", minWidth: 0 }}
            focusKey={`comparepicker:friend:${friend.username}`}
            onClick={handleClick}
            onFocus={handleFocus}
        >
            <div
                style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "4px 0",
                    minWidth: 0
                }}
            >
                <UserAvatar
                    username={friend.username}
                    size={44}
                    fontSize={16}
                    wrapperStyle={{
                        borderRadius: "10px",
                        background: "rgba(255,255,255,0.08)",
                        border: "none"
                    }}
                    letterStyle={{ fontWeight: 800, fontSize: "16px" }}
                />
                <div
                    style={{
                        flex: 1,
                        minWidth: 0,
                        fontWeight: selected ? 800 : 700,
                        wordBreak: "break-word"
                    }}
                >
                    {friend.username}
                </div>
                {selected && (
                    <div
                        style={{
                            ...smallTextStyle(),
                            flexShrink: 0,
                            opacity: 0.85,
                            fontWeight: 700,
                            paddingRight: "4px"
                        }}
                    >
                        ✓
                    </div>
                )}
            </div>
        </FocusableItem>
    );
});

function ComparePickerPage(props: ComparePickerPageProps) {
    const { state, actions } = props;
    const { language, buttonSpacing, friendsRows, favoriteFriends, friendsLoaded, friendsRefreshing, friendsError } = state;

    const dynamicFriendPicker = state.dynamicFriendPicker ?? true;
    const dynamicInitialRows = Math.max(1, state.dynamicInitialRows ?? 30);
    const dynamicRowStep = Math.max(1, state.dynamicRowStep ?? 30);
    const dynamicPrefetchDistance = Math.max(1, state.dynamicPrefetchDistance ?? 12);
    const dynamicSentinelRootMargin = `${Math.max(0, state.dynamicSentinelRootMargin ?? 600)}px 0px`;

    const favoriteKeys = useMemo(() => {
        return new Set(
            favoriteFriends
                .map((ulid) => String(ulid || "").trim())
                .filter(Boolean)
        );
    }, [favoriteFriends]);

    const selectedKey = (state.selectedFriendUsername || "").trim().toLowerCase();

    const { starredRows, otherRows } = useMemo(() => {
        const sorted = sortFriendRowsForDisplay(friendsRows.filter((row) => !row.isSelf));
        const starred: FriendRow[] = [];
        const others: FriendRow[] = [];
        for (const row of sorted) {
            if (favoriteKeys.has(String(row.ulid || "").trim())) {
                starred.push(row);
            } else {
                others.push(row);
            }
        }
        return { starredRows: starred, otherRows: others };
    }, [favoriteKeys, friendsRows]);

    const totalRows = starredRows.length + otherRows.length;
    const allRows = useMemo(() => {
        return [...starredRows, ...otherRows];
    }, [starredRows, otherRows]);

    const rowOrderKey = useMemo(() => {
        const starredKey = starredRows.map((row) => row.ulid || row.username).join("|");
        const otherKey = otherRows.map((row) => row.ulid || row.username).join("|");
        return `${starredKey}::${otherKey}`;
    }, [starredRows, otherRows]);

    const {
        mountedItems: mountedRows,
        markerRef: loadMoreMarkerRef,
        onItemFocus: maybeLoadMoreFromFocus
    } = useWindowedList({
        items: allRows,
        dynamicLoading: dynamicFriendPicker,
        initialRows: dynamicInitialRows,
        rowStep: dynamicRowStep,
        prefetchDistance: dynamicPrefetchDistance,
        sentinelRootMargin: dynamicSentinelRootMargin,
        resetKey: rowOrderKey
    });

    const visibleStarred = useMemo(() => mountedRows.slice(0, starredRows.length), [mountedRows, starredRows]);
    const visibleOthers = useMemo(() => mountedRows.slice(starredRows.length), [mountedRows, starredRows]);

    const pickFriendRef = useRef(actions.onPickFriend);
    pickFriendRef.current = actions.onPickFriend;
    const rowFocusRef = useRef(maybeLoadMoreFromFocus);
    rowFocusRef.current = maybeLoadMoreFromFocus;

    const rowList = useMemo<FriendPickerRowListProps>(() => ({
        onPick: (friend) => {
            void pickFriendRef.current(friend);
        },
        onRowFocus: (index) => {
            rowFocusRef.current(index);
        }
    }), []);

    useEffect(() => {
        if (state.view !== "comparePicker") {
            return;
        }
        const visible = [...visibleStarred, ...visibleOthers];
        if (visible.length === 0) {
            return;
        }
        const usernames = visible
            .filter((row) => !row.avatarDataUri || isFriendAvatarStale(row))
            .map((row) => row.username);
        if (usernames.length === 0) {
            return;
        }
        void (async () => {
            try {
                await prefetchUserAvatars(usernames);
            }
            catch (e) {
                logError("ComparePickerPage prefetchUserAvatars", e);
            }
        })();
    }, [state.view, visibleStarred, visibleOthers]);

    if (state.view !== "comparePicker") {
        return null;
    }

    return (
        <React.Fragment key={`comparepicker:view:${state.focusScopeResetToken}`}>
            <PanelSection>
                <PageNavStrip
                    title={t(language, "Compare to Friend:")}
                    buttonSpacing={buttonSpacing}
                    onHome={actions.onHome}
                />
                <BackButton
                    label={t(language, "← Back to Main")}
                    focusKey="comparepicker:back"
                    navAutoFocus
                    buttonSpacing={buttonSpacing}
                    onClick={actions.onBack}
                />
                {friendsError && (
                    <PanelSectionRow>
                        <ErrorText>{localizeRuntimeText(language, friendsError)}</ErrorText>
                    </PanelSectionRow>
                )}
                {!friendsLoaded && friendsRows.length === 0 ? (
                    <PanelSectionRow>
                        <InlineSpinner label={t(language, "Loading friends cache...")} />
                    </PanelSectionRow>
                ) : friendsRows.filter((row) => !row.isSelf).length === 0 ? (
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
                            <div style={{ fontSize: "16px", fontWeight: 700 }}>
                                {t(language, "No followed users found.")}
                            </div>
                            <div style={bodyTextStyle()}>
                                {t(language, "Open this page again after following users on RetroAchievements.")}
                            </div>
                        </div>
                    </PanelSectionRow>
                ) : (
                    <Focusable
                        flow-children="column"
                        style={{
                            width: "100%",
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                            ...regularButtonSpacingStyle(buttonSpacing)
                        }}
                    >
                        {visibleStarred.length > 0 && (
                            <>
                                <div
                                    style={{
                                        ...smallTextStyle(),
                                        fontSize: `${titleSize(12)}px`,
                                        fontWeight: 800,
                                        textTransform: "uppercase",
                                        letterSpacing: "0.02em",
                                        opacity: 0.92,
                                        margin: "6px 0 2px 0"
                                    }}
                                >
                                    {t(language, "Favorites")}
                                </div>
                                {visibleStarred.map((friend, index) => (
                                    <FriendPickerRow
                                        key={`star:${friend.username}`}
                                        friend={friend}
                                        selected={friend.username.trim().toLowerCase() === selectedKey}
                                        index={index}
                                        list={rowList}
                                    />
                                ))}
                            </>
                        )}
                        {visibleOthers.length > 0 && (
                            <>
                                <div
                                    style={{
                                        ...smallTextStyle(),
                                        fontSize: `${titleSize(12)}px`,
                                        fontWeight: 800,
                                        textTransform: "uppercase",
                                        letterSpacing: "0.02em",
                                        opacity: 0.92,
                                        margin: "8px 0 2px 0"
                                    }}
                                >
                                    {t(language, "Friends")}
                                </div>
                                {visibleOthers.map((friend, index) => (
                                    <FriendPickerRow
                                        key={friend.ulid || friend.username}
                                        friend={friend}
                                        selected={friend.username.trim().toLowerCase() === selectedKey}
                                        index={starredRows.length + index}
                                        list={rowList}
                                    />
                                ))}
                            </>
                        )}
                        {dynamicFriendPicker && mountedRows.length < totalRows && (
                            <div
                                ref={loadMoreMarkerRef}
                                style={{ width: "100%", height: "1px", opacity: 0 }}
                            />
                        )}
                        {friendsRefreshing && (
                            <PanelSectionRow>
                                <div style={bodyTextStyle()}>
                                    {t(language, "Checking friends for updates...")}
                                </div>
                            </PanelSectionRow>
                        )}
                    </Focusable>
                )}
            </PanelSection>
        </React.Fragment>
    );
}

export default ComparePickerPage;
