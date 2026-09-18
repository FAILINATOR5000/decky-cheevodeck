import type { MemoryRecord, NoteColor } from "../types";

export const MISC_GAME_ID = -1;

export const ALL_GAMES_ID = 0;

export const REVEAL_PER_FRAME = 1;
export const REVEAL_DEADLINE_MS = 600;

export const THUMB_CHUNK_SIZE = 12;

export const TAG_SEEDS: ReadonlyArray<{ key: string; tag: string }> = [
    { key: "memory_seed_boss", tag: "Boss" },
    { key: "memory_seed_clutch", tag: "Clutch" },
    { key: "memory_seed_funny", tag: "Funny" },
    { key: "memory_seed_rare", tag: "Rare" },
    { key: "memory_seed_pb", tag: "Personal Best" },
    { key: "memory_seed_ending", tag: "Ending" },
    { key: "memory_seed_achievement", tag: "Achievement" }
];

export function unusedTagSeeds(used: string[]): ReadonlyArray<{ key: string; tag: string }> {
    const taken = new Set(used.map((tag) => tag.trim().toLowerCase()));
    return TAG_SEEDS.filter((seed) => !taken.has(seed.tag.toLowerCase()));
}

export function memoryMatchesTag(memory: MemoryRecord, tag: string): boolean {
    if (!tag) {
        return true;
    }
    return (memory.tag || "") === tag;
}

export function memoryMatchesColor(memory: MemoryRecord, color: string): boolean {
    if (!color) {
        return true;
    }
    return ((memory.color || "default") as NoteColor) === color;
}

export const MEDIA_FILTER_CHOICES: ReadonlyArray<{ value: string; key: string }> = [
    { value: "", key: "All" },
    { value: "picture", key: "Screenshot" },
    { value: "video", key: "Video" }
];

export function mediaFilterKey(media: string): string {
    const found = MEDIA_FILTER_CHOICES.find((choice) => choice.value === media);
    return found && found.value ? found.key : "";
}

export function memoryMatchesMedia(memory: MemoryRecord, media: string): boolean {
    if (!media) {
        return true;
    }
    return media === "video" ? Boolean(memory.video) : !memory.video;
}

export function sortMemories(memories: MemoryRecord[], order: "desc" | "asc"): MemoryRecord[] {
    const sorted = [...memories];
    sorted.sort((left, right) => (
        order === "asc"
            ? left.capturedAt - right.capturedAt
            : right.capturedAt - left.capturedAt
    ));
    return sorted;
}

export function memoryRemovalLanding(list: MemoryRecord[], removedId: string): string | null {
    const index = list.findIndex((memory) => memory.id === removedId);
    if (index < 0) {
        return null;
    }
    return list[index + 1]?.id ?? list[index - 1]?.id ?? null;
}

export function formatClipLength(seconds: number): string {
    const whole = Math.max(Math.round(seconds), 0);
    const minutes = Math.floor((whole % 3600) / 60);
    const rest = String(whole % 60).padStart(2, "0");
    const hours = Math.floor(whole / 3600);
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${rest}`;
    }
    return `${minutes}:${rest}`;
}

export function pageCount(total: number, perPage: number): number {
    if (perPage <= 0) {
        return 1;
    }
    return Math.max(1, Math.ceil(total / perPage));
}
