// Font Awesome Free icons, CC BY 4.0. See ATTRIBUTIONS.md.
import { FaGlobe, FaLock, FaUserFriends } from "react-icons/fa";

import { t, type LanguageCode } from "../../locales";
import type { MultiplayerAccess } from "../../types";

export const ROOM_ACCESS: { code: MultiplayerAccess; labelKey: string; Icon: typeof FaGlobe }[] = [
    { code: "public", labelKey: "Public", Icon: FaGlobe },
    { code: "friends", labelKey: "Friend Only", Icon: FaUserFriends },
    { code: "private", labelKey: "Private", Icon: FaLock }
];

export function roomAccess(room: { private: boolean; friends: boolean }): MultiplayerAccess {
    if (room.friends) {
        return "friends";
    }
    return room.private ? "private" : "public";
}

export function RoomAccessLabel(props: { access: MultiplayerAccess; language: LanguageCode }) {
    const entry = ROOM_ACCESS.find((item) => item.code === props.access) ?? ROOM_ACCESS[0];
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
            <entry.Icon style={{ flexShrink: 0 }} />
            {t(props.language, entry.labelKey)}
        </span>
    );
}
