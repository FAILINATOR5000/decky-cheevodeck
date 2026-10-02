const NOTE_SAVE_ERROR_KEYS: Record<string, string> = {
    newer_schema: "Not Compatible",
    not_tracked: "No Longer Tracked"
};

export function noteSaveErrorKey(code: string | null | undefined, fallback: string): string {
    return (code && NOTE_SAVE_ERROR_KEYS[code]) || fallback;
}
