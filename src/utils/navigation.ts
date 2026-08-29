import { Navigation } from "@decky/ui";

const RA_BASE = "https://retroachievements.org";

export function raHomeUrl() {
    return RA_BASE;
}

export function raAchievementUrl(id: number) {
    return `${RA_BASE}/achievement/${id}`;
}

export function raAchievementCommentsUrl(id: number) {
    return `${RA_BASE}/achievement/${id}/comments`;
}

export function raGameUrl(id: number) {
    return `${RA_BASE}/game/${id}`;
}

export function raGameCommentsUrl(id: number) {
    return `${RA_BASE}/game/${id}/comments`;
}

export function raUserUrl(username: string) {
    return `${RA_BASE}/user/${encodeURIComponent(username)}`;
}

export function raUserCommentsUrl(username: string) {
    return `${RA_BASE}/user/${encodeURIComponent(username)}/comments`;
}

export function raLeaderboardCommentsUrl(id: number) {
    return `${RA_BASE}/leaderboard/${id}/comments`;
}

export function raLookupSearchUrl(title: string) {
    return `https://www.google.com/search?q=${encodeURIComponent(`${title} Retroachievements.org`)}`;
}

export function youtubeSearchUrl(query: string) {
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

export async function openExternalUrl(url: string) {
    const targetUrl = String(url || "").trim();

    if (!targetUrl) {
        return false;
    }

    try {
        Navigation.CloseSideMenus();
    } catch { }

    try {
        Navigation.NavigateToExternalWeb(targetUrl);
        return true;
    } catch {
        return false;
    }
}
