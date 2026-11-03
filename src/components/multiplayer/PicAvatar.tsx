import type { ReactNode } from "react";

import { t, type LanguageCode } from "../../locales";
import type { MultiplayerFriend } from "../../types";
import { formatRelativeTime } from "../../utils/format";
import { achievementGreen } from "../../utils/style";
import { FadeImage } from "../ui/FadeImage";

export function PicAvatar(props: { uri: string | undefined; name: string; size: number }) {
    const { uri, name, size } = props;
    return (
        <div
            style={{
                width: `${size}px`,
                height: `${size}px`,
                borderRadius: "6px",
                overflow: "hidden",
                flexShrink: 0,
                background: "rgba(255,255,255,0.10)",
                border: "1px solid rgba(255,255,255,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: `${Math.round(size * 0.45)}px`,
                fontWeight: 800
            }}
        >
            {uri ? (
                <FadeImage src={uri} decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            ) : (
                (name.trim().charAt(0) || "?").toUpperCase()
            )}
        </div>
    );
}

export function friendGame(friend: MultiplayerFriend): string {
    return friend.online && friend.room ? friend.game : "";
}

export function friendStatus(language: LanguageCode, friend: MultiplayerFriend): string {
    if (friend.online && friend.room) {
        return t(language, friend.room.playing ? "In-Game in {{room}}" : "In {{room}}", { room: friend.room.name });
    }
    if (friend.online && friend.game) {
        return t(language, "Playing {{game}}", { game: friend.game });
    }
    if (friend.online) {
        return t(language, "Online");
    }
    if (friend.seen > 0) {
        return t(language, "Last seen {{when}}", {
            when: formatRelativeTime(new Date(friend.seen * 1000).toISOString(), language)
        });
    }
    return t(language, "Offline");
}

export function Pill(props: { children: ReactNode }) {
    return (
        <span
            style={{
                fontSize: "0.75em",
                fontWeight: 800,
                color: "#000",
                background: achievementGreen,
                borderRadius: "999px",
                padding: "1px 7px",
                whiteSpace: "nowrap",
                lineHeight: 1.4
            }}
        >
            {props.children}
        </span>
    );
}

export function NewPill(props: { language: LanguageCode; count: number }) {
    return <Pill>{t(props.language, "{{count}} new", { count: props.count })}</Pill>;
}

export function friendName(friend: { name: string; nickname?: string }): string {
    return friend.nickname || friend.name;
}
