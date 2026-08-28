import type { FriendRow } from "../types";

const FRIEND_AVATAR_MAX_AGE_SECONDS = 48 * 60 * 60;

export function isFriendAvatarStale(friend: FriendRow) {
    const avatarUrl = String(friend.avatarUrl || "").trim();
    const avatarDataUri = String(friend.avatarDataUri || "").trim();
    const cachedAt = Number(friend.avatarCachedAt || 0);

    if (!avatarUrl && !avatarDataUri) {
        return false;
    }
    if (!avatarDataUri || cachedAt <= 0) {
        return Boolean(avatarUrl || avatarDataUri);
    }

    const nowSeconds = Math.floor(Date.now() / 1000);

    return nowSeconds - cachedAt >= FRIEND_AVATAR_MAX_AGE_SECONDS;
}

export function sortFriendRowsForDisplay(rows: FriendRow[]) {
    return [...rows].sort((a, b) => {
        const selfCompare = Number(Boolean(b.isSelf)) - Number(Boolean(a.isSelf));

        if (selfCompare !== 0) {
            return selfCompare;
        }

        return String(a.username || "").localeCompare(String(b.username || ""), undefined, { sensitivity: "base" });
    });
}

export function userRefFor(friend: FriendRow): string {
    return (friend.ulid || friend.username || "").trim();
}

export function findFriendRowIndex(
    rows: FriendRow[],
    { username, ulid }: { username?: string | null; ulid?: string | null }
): number {
    const wantedUlid = String(ulid || "").trim().toLowerCase();
    if (wantedUlid) {
        const byUlid = rows.findIndex((row) => String(row.ulid || "").trim().toLowerCase() === wantedUlid);
        if (byUlid >= 0) {
            return byUlid;
        }
    }

    const wantedName = String(username || "").trim().toLowerCase();
    return rows.findIndex((row) => String(row.username || "").trim().toLowerCase() === wantedName);
}

export function findFriendRow(
    rows: FriendRow[],
    match: { username?: string | null; ulid?: string | null }
): FriendRow | undefined {
    const index = findFriendRowIndex(rows, match);
    return index >= 0 ? rows[index] : undefined;
}
