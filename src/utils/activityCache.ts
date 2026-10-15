import type { ActivityMonth } from "../types";

const CURRENT_MAX_AGE_MS = 5 * 60 * 1000;
const FRIEND_MONTHS_CAP = 24;

const currentMonths = new Map<string, { month: ActivityMonth; at: number }>();
const friendMonths = new Map<string, ActivityMonth>();

function localMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function cachedCurrentActivityMonth(ulid: string): ActivityMonth | null {
    const current = currentMonths.get(ulid);
    if (!current || Date.now() - current.at >= CURRENT_MAX_AGE_MS) {
        return null;
    }
    return current.month.month === localMonth() ? current.month : null;
}

export function cachedActivityMonth(ulid: string, month: string, own: boolean): ActivityMonth | null {
    const current = currentMonths.get(ulid);
    if (current && current.month.month === month) {
        return Date.now() - current.at < CURRENT_MAX_AGE_MS ? current.month : null;
    }
    if (own) {
        return null;
    }
    const key = `${ulid}|${month}`;
    const hit = friendMonths.get(key);
    if (!hit) {
        return null;
    }
    friendMonths.delete(key);
    friendMonths.set(key, hit);
    return hit;
}

export function keepActivityMonth(month: ActivityMonth, own: boolean) {
    if (month.month === month.currentMonth) {
        currentMonths.set(month.ulid, { month, at: Date.now() });
        return;
    }
    if (own) {
        return;
    }
    const key = `${month.ulid}|${month.month}`;
    friendMonths.delete(key);
    friendMonths.set(key, month);
    while (friendMonths.size > FRIEND_MONTHS_CAP) {
        const oldest = friendMonths.keys().next().value;
        if (oldest === undefined) {
            break;
        }
        friendMonths.delete(oldest);
    }
}

export function dropCurrentActivityMonth(ulid: string) {
    currentMonths.delete(ulid);
}

export function clearActivityMonths() {
    currentMonths.clear();
    friendMonths.clear();
}
