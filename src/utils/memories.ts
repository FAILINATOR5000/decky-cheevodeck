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

export function pageCount(total: number, perPage: number): number {
    if (perPage <= 0) {
        return 1;
    }
    return Math.max(1, Math.ceil(total / perPage));
}
