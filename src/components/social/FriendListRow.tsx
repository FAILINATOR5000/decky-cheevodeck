import React, { useState } from "react";
import { DialogButton, Focusable } from "@decky/ui";
import { FocusableItem } from "../ui/FocusableItem";
import { UserAvatar } from "../ui/UserAvatar";
import { t, type LanguageCode } from "../../locales";
import type { FriendRow } from "../../types";
import { formatInteger } from "../../utils/format";
import { BUTTON_OPTIONS, BUTTON_SECONDARY } from "../../utils/gamepadButtons";
import { playOkSound, playToggleSound } from "../../utils/navSound";
import { bodyTextStyle } from "../../utils/style";

export type FriendRowListProps = {
    language: LanguageCode;
    onFriendClick: (friend: FriendRow) => void;
    onFriendFocus: (friend: FriendRow) => void;
    onFriendHover: (friend: FriendRow) => void;
    onFriendUnhover: (friend: FriendRow) => void;
    onFriendFavoriteToggle: (friend: FriendRow, next: boolean) => void;
    onRowFocus: (index: number) => void;
    onFriendResolveAvatar?: (friend: FriendRow) => void;
};

type FriendListRowProps = {
    friend: FriendRow;
    index: number;
    favorite: boolean;
    liveRefreshing: boolean;
    list: FriendRowListProps;
};

export const FriendListRow = React.memo(function FriendListRow(props: FriendListRowProps) {
    const { friend, favorite, liveRefreshing, list } = props;
    const { language } = list;

    const favoriteKey = friend.username.trim().toLowerCase();
    const canFavorite = !friend.isSelf;

    const [favoriteFocused, setFavoriteFocused] = useState(false);

    function handleFriendFocus() {
        list.onRowFocus(props.index);
        list.onFriendFocus(friend);
    }

    function handleFriendClick() {
        list.onFriendClick(friend);
    }

    function handleButtonDown(evt: { detail?: { button?: number } }) {
        const button = evt?.detail?.button;

        if (button === BUTTON_SECONDARY && canFavorite) {
            playToggleSound(!favorite);
            list.onFriendFavoriteToggle(friend, !favorite);
            return;
        }

        if (button === BUTTON_OPTIONS && list.onFriendResolveAvatar) {
            playOkSound();
            list.onFriendResolveAvatar(friend);
        }
    }

    function handleFavoriteClick() {
        if (!canFavorite) {
            return;
        }
        list.onFriendFavoriteToggle(friend, !favorite);
    }

    function handleFavoriteFocus() {
        setFavoriteFocused(true);
    }

    function handleFavoriteBlur() {
        setFavoriteFocused(false);
    }

    return (
        <Focusable
            flow-children="row"
            style={{
                position: "relative",
                display: "flex",
                alignItems: "stretch",
                width: "100%"
            }}
        >
            <FocusableItem
                outerStyle={{ width: "100%", minWidth: 0 }}
                focusKey={`friend:${friend.username}`}
                onFocus={handleFriendFocus}
                onMouseEnter={() => list.onFriendHover(friend)}
                onMouseLeave={() => list.onFriendUnhover(friend)}
                onClick={handleFriendClick}
                onButtonDown={handleButtonDown}
            >
                <div
                    style={{
                        width: "100%",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        padding: "4px 0",
                        textAlign: "center"
                    }}
                >
                    <UserAvatar
                        username={friend.username}
                        size={52}
                        fontSize={18}
                        wrapperStyle={{
                            borderRadius: "12px",
                            background: "rgba(255,255,255,0.08)",
                            border: "none"
                        }}
                        letterStyle={{ fontWeight: 700, fontSize: "18px" }}
                    />
                    <div
                        style={{
                            width: "100%",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: "4px",
                            minWidth: 0
                        }}
                    >
                        <div
                            style={{
                                fontWeight: 700,
                                lineHeight: 1.2,
                                width: "100%",
                                wordBreak: "break-word"
                            }}
                        >
                            {friend.username}
                            {friend.isSelf ? t(language, " (You)") : ""}
                        </div>
                        <div style={{ ...bodyTextStyle(), opacity: 0.9 }}>
                            {`${formatInteger(friend.points ?? 0)} pts (${formatInteger(friend.totalTruePoints ?? 0)})`}
                        </div>
                        <div
                            style={{
                                ...bodyTextStyle(),
                                opacity: 0.95,
                                fontWeight: 600,
                                width: "100%",
                                wordBreak: "break-word"
                            }}
                        >
                            {liveRefreshing
                                ? t(language, "Refreshing live info...")
                                : friend.statusText || t(language, "No rich presence")}
                        </div>
                        <div
                            style={{
                                ...bodyTextStyle(),
                                opacity: 0.85,
                                width: "100%",
                                wordBreak: "break-word"
                            }}
                        >
                            {friend.lastGameTitle || t(language, "No current game")}
                        </div>
                    </div>
                </div>
            </FocusableItem>
            {friend.isFollowingMe ? (
                <div
                    style={{
                        position: "absolute",
                        top: "17px",
                        left: "8px",
                        zIndex: 2,
                        width: "22px",
                        height: "22px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "15px",
                        lineHeight: 1,
                        borderRadius: "7px",
                        color: "rgba(255,255,255,0.96)",
                        background: "rgba(24,24,24,0.78)",
                        border: "1px solid rgba(255,255,255,0.36)",
                        boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
                        textShadow: "0 1px 2px rgba(0,0,0,0.7)",
                        opacity: 0.86,
                        pointerEvents: "none"
                    }}
                >
                    ⇄
                </div>
            ) : null}
            {canFavorite ? (
                <div
                    data-focus-key={`friend-favorite:${favoriteKey}`}
                    style={{
                        position: "absolute",
                        top: "17px",
                        right: "8px",
                        zIndex: 2,
                        width: "34px",
                        height: "34px",
                        display: "flex"
                    }}
                >
                    <DialogButton
                        onClick={handleFavoriteClick}
                        onGamepadFocus={handleFavoriteFocus}
                        onGamepadBlur={handleFavoriteBlur}
                        style={{
                            minWidth: 0,
                            width: "34px",
                            height: "34px",
                            padding: 0,
                            fontSize: "18px",
                            fontWeight: 800,
                            lineHeight: 1,
                            color: favorite
                                ? "#fbbf24"
                                : favoriteFocused
                                    ? "rgba(24,24,24,0.98)"
                                    : "rgba(255,255,255,0.96)",
                            background: favoriteFocused
                                ? "rgba(255,255,255,0.96)"
                                : favorite
                                    ? "rgba(52,52,52,0.92)"
                                    : "rgba(24,24,24,0.78)",
                            opacity: favorite || favoriteFocused ? 1 : 0.86,
                            border: favoriteFocused
                                ? "1px solid rgba(255,255,255,1)"
                                : favorite
                                    ? "1px solid rgba(255,255,255,0.9)"
                                    : "1px solid rgba(255,255,255,0.36)",
                            boxShadow: favoriteFocused
                                ? "0 0 0 2px rgba(255,255,255,0.78), 0 0 10px rgba(255,255,255,0.45), 0 2px 8px rgba(0,0,0,0.45)"
                                : favorite
                                    ? "0 0 0 1px rgba(255,255,255,0.22), 0 2px 6px rgba(0,0,0,0.35)"
                                    : "0 2px 6px rgba(0,0,0,0.35)",
                            textShadow: favorite
                                ? "0 1px 2px rgba(0,0,0,0.55)"
                                : favoriteFocused
                                    ? "none"
                                    : "0 1px 2px rgba(0,0,0,0.7)",
                            transition: "background 120ms ease, box-shadow 120ms ease, color 120ms ease"
                        }}
                    >
                        {favorite ? "★" : "☆"}
                    </DialogButton>
                </div>
            ) : null}
        </Focusable>
    );
});
