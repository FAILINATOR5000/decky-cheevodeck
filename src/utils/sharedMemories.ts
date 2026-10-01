import { consoleDisplayName } from "./consoles";
import { raUserUrl } from "./navigation";

const GUILD_ID = "1546735570821058590";
const FORUM_ID = "1553625149130149948";

export const SHARED_MEMORIES_PATH = `/channels/${GUILD_ID}/${FORUM_ID}`;
export const SHARED_MEMORIES_CHANNEL_URL = `https://discord.com${SHARED_MEMORIES_PATH}`;

export const SHARED_MEMORIES_INVITE_URL = "";

const DISCORD_TITLE_MAX = 100;
export const DISCORD_MESSAGE_MAX = 2000;

export const MAX_SHARE_MEMORY_TAGS = 3;

export function sharePostTitle(gameTitle: string, consoleName: string): string {
    const system = ` (${consoleDisplayName(consoleName)})`;
    const game = [...gameTitle.trim()];
    const room = DISCORD_TITLE_MAX - system.length;
    if (game.length <= room) {
        return game.join("") + system;
    }
    return game.slice(0, room - 1).join("").trimEnd() + "…" + system;
}

export const SHARE_CREDIT_TEXT = "Shared from CheevoDeck by";

export function shareCreditLine(username: string): string {
    return `-# ${SHARE_CREDIT_TEXT} [${username}](<${raUserUrl(username)}>)`;
}

export function shareMessage(caption: string, username: string, credit: boolean): string {
    if (!credit || !username) {
        return caption;
    }
    return caption ? `${caption}\n${shareCreditLine(username)}` : shareCreditLine(username);
}
