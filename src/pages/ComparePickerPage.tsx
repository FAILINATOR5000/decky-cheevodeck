import React, { useEffect, useMemo, useRef } from "react";
import { Focusable, PanelSectionRow } from "@decky/ui";
import { PanelSection } from "../components/ui/PanelSection";
import { BackButton } from "../components/ui/BackButton";
import { ErrorText } from "../components/ui/ErrorText";
import { FocusableItem } from "../components/ui/FocusableItem";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { UserAvatar } from "../components/ui/UserAvatar";
import { prefetchUserAvatars } from "../api";
import { useSlidingWindow } from "../hooks/useSlidingWindow";
import { SlidingWindowRows } from "../components/ui/SlidingWindowRows";
import { localizeRuntimeText, t, type LanguageCode } from "../locales";
import type { ButtonSpacing, FriendRow, ViewKey } from "../types";
import { isFriendAvatarStale, sortFriendRowsForDisplay } from "../utils/friends";
import { logError } from "../utils/errors";
import { titleSize } from "../utils/scale";
import { bodyTextStyle, headerCase, regularButtonSpacingStyle, smallTextStyle } from "../utils/style";

type ComparePickerPageState = {
    view: ViewKey;
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

type PickerHeading = { heading: "favorites" | "friends" };
type PickerRowEntry = { friend: FriendRow; starred: boolean };
type PickerEntry = PickerHeading | PickerRowEntry;

function isPickerHeading(entry: PickerEntry): entry is PickerHeading {
    return "heading" in entry;
}

function pickerEntryKey(entry: PickerEntry): string {
    if (isPickerHeading(entry)) {
        return `heading:${entry.heading}`;
    }
    return `${entry.starred ? "star" : "friend"}:${entry.friend.ulid || entry.friend.username}`;
}

function pickerEntryFocusKey(entry: PickerEntry): string {
    return isPickerHeading(entry) ? `comparepicker:heading:${entry.heading}` : `comparepicker:friend:${entry.friend.username}`;
}

type FriendPickerRowListProps = {
    onPick: (friend: FriendRow) => void;
    onRowFocus: (index: number) => void;
};

type FriendPickerRowProps = {
    friend: FriendRow;
    onGamepadDirection?: (evt: { detail?: { button?: number } }) => boolean | void;
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
            onGamepadFocus={handleFocus}
            onGamepadDirection={props.onGamepadDirection}
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

    const entries = useMemo(() => {
        const out: PickerEntry[] = [];
        if (starredRows.length > 0) {
            out.push({ heading: "favorites" });
            out.push(...starredRows.map((friend) => ({ friend, starred: true })));
        }
        if (otherRows.length > 0) {
            out.push({ heading: "friends" });
            out.push(...otherRows.map((friend) => ({ friend, starred: false })));
        }
        return out;
    }, [starredRows, otherRows]);

    const rowOrderKey = useMemo(() => {
        const starredKey = starredRows.map((row) => row.ulid || row.username).join("|");
        const otherKey = otherRows.map((row) => row.ulid || row.username).join("|");
        return `${starredKey}::${otherKey}`;
    }, [starredRows, otherRows]);

    const pickerWindow = useSlidingWindow({
        items: entries,
        itemKey: pickerEntryKey,
        focusKeyFor: pickerEntryFocusKey,
        windowId: "comparepicker:friends",
        heightScope: ["comparepicker:friends", language, titleSize(12)].join("|"),
        dynamicLoading: dynamicFriendPicker,
        initialRows: Math.max(1, state.dynamicInitialRows ?? 30),
        rowStep: Math.max(1, state.dynamicRowStep ?? 30),
        prefetchDistance: Math.max(1, state.dynamicPrefetchDistance ?? 12),
        sentinelRootMarginPx: Math.max(0, state.dynamicSentinelRootMargin ?? 600),
        resetKey: rowOrderKey,
        debugLabel: "comparepicker:friends"
    });
    const maybeLoadMoreFromFocus = pickerWindow.onItemFocus;
    const visibleFriends = useMemo(() => {
        const friends: FriendRow[] = [];
        for (const entry of pickerWindow.mountedItems) {
            if (!isPickerHeading(entry)) {
                friends.push(entry.friend);
            }
        }
        return friends;
    }, [pickerWindow.mountedItems]);

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
        const visible = visibleFriends;
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
    }, [state.view, visibleFriends]);

    if (state.view !== "comparePicker") {
        return null;
    }

    let guardSlot = pickerWindow.start;
    if (pickerWindow.mountedItems.length > 0 && isPickerHeading(pickerWindow.mountedItems[0])) {
        guardSlot += 1;
    }

    return (
        <React.Fragment key="comparepicker:view">
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
                        <SlidingWindowRows list={pickerWindow}>
                            {pickerWindow.mountedItems.map((entry, index) => {
                                const slot = pickerWindow.start + index;
                                if (isPickerHeading(entry)) {
                                    return (
                                        <div
                                            key={pickerEntryKey(entry)}
                                            style={{
                                                ...smallTextStyle(),
                                                fontSize: `${titleSize(12)}px`,
                                                fontWeight: 800,
                                                textTransform: headerCase(),
                                                letterSpacing: "0.02em",
                                                opacity: 0.92,
                                                padding: entry.heading === "favorites" ? "6px 0 6px 0" : "8px 0 6px 0"
                                            }}
                                        >
                                            {t(language, entry.heading === "favorites" ? "Favorites" : "Friends")}
                                        </div>
                                    );
                                }
                                return (
                                    <div key={pickerEntryKey(entry)} style={{ paddingBottom: "4px" }}>
                                        <FriendPickerRow
                                            friend={entry.friend}
                                            selected={entry.friend.username.trim().toLowerCase() === selectedKey}
                                            index={slot}
                                            list={rowList}
                                            onGamepadDirection={slot === guardSlot ? pickerWindow.guardTopRow(pickerWindow.start) : undefined}
                                        />
                                    </div>
                                );
                            })}
                        </SlidingWindowRows>
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
