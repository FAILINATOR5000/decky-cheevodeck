export type TagSeed = { key: string; tag: string };

export const MEMORY_TAG_SEEDS: ReadonlyArray<TagSeed> = [
    { key: "memory_seed_boss", tag: "Boss" },
    { key: "memory_seed_clutch", tag: "Clutch" },
    { key: "memory_seed_funny", tag: "Funny" },
    { key: "memory_seed_rare", tag: "Rare" },
    { key: "memory_seed_pb", tag: "Personal Best" },
    { key: "memory_seed_ending", tag: "Ending" },
    { key: "memory_seed_achievement", tag: "Achievement" }
];

export const GAME_NOTE_TAG_SEEDS: ReadonlyArray<TagSeed> = [
    { key: "game_note_seed_goals", tag: "Goals" },
    { key: "game_note_seed_todo", tag: "Todo" },
    { key: "game_note_seed_build", tag: "Build" },
    { key: "game_note_seed_reminder", tag: "Reminder" },
    { key: "game_note_seed_story", tag: "Story" },
    { key: "game_note_seed_sidequest", tag: "Sidequests" }
];

export const TRACKED_TAG_SEEDS: ReadonlyArray<TagSeed> = [
    { key: "tag_seed_goals", tag: "Goals" },
    { key: "tag_seed_story", tag: "Story" },
    { key: "tag_seed_sidequest", tag: "Sidequests" },
    { key: "tag_seed_boss", tag: "Boss" },
    { key: "tag_seed_missable", tag: "Missable" },
    { key: "tag_seed_grind", tag: "Grind" }
];

export const DOLPHIN_TAG_SEEDS: ReadonlyArray<TagSeed> = [
    { key: "dolphin_tag_seed_common", tag: "Common" },
    { key: "dolphin_tag_seed_custom", tag: "Custom" },
    { key: "dolphin_tag_seed_singleplayer", tag: "Single Player" },
    { key: "dolphin_tag_seed_multiplayer", tag: "Multiplayer" }
];

export function unusedTagSeeds(
    seeds: ReadonlyArray<TagSeed>,
    used: string[]
): ReadonlyArray<TagSeed> {
    const taken = new Set(used.map((tag) => tag.trim().toLowerCase()));
    return seeds.filter((seed) => !taken.has(seed.tag.toLowerCase()));
}

const TAG_INPUT_STRIP = /[[\]\n\r\t]/g;

export function cleanTagInput(raw: string, maxLen: number): string {
    return raw.replace(TAG_INPUT_STRIP, "").slice(0, maxLen);
}

export function orderedTagsByRecency(
    rows: ReadonlyArray<{ tag: string | null | undefined; at: number }>
): string[] {
    const newest = new Map<string, { tag: string; at: number; index: number }>();
    rows.forEach((row, index) => {
        const tag = (row.tag ?? "").trim();
        if (!tag) {
            return;
        }
        const lower = tag.toLowerCase();
        const held = newest.get(lower);
        if (!held || row.at > held.at || (row.at === held.at && index < held.index)) {
            newest.set(lower, { tag, at: row.at, index });
        }
    });
    return [...newest.values()]
        .sort((left, right) => (right.at - left.at) || (left.index - right.index))
        .map((row) => row.tag);
}
