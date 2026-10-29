const DATA_TRANSFER_ERROR_KEYS: Record<string, string> = {
    busy: "Something is already running",
    no_account: "Sign in to RetroAchievements first",
    no_game: "No current game. Load a game on both devices first.",
    different_game: "That device is on a different game",
    newer_schema: "Not Compatible",
    ulid_mismatch: "That data belongs to another RetroAchievements account",
    peer_gone: "That device isn't answering",
    peer_busy: "That device is busy. Try again in a moment.",
    peer_nothing: "That device has nothing to send",
    version_mismatch: "Versions don't match",
    transfer_interrupted: "The transfer was interrupted",
    payload_mismatch: "What arrived didn't match what was sent",
    too_late: "Too late to cancel, it's already saving",
    more_here: "This device has more XP than {{name}}.",
    write_failed: "Saving it here failed",
    not_game_mode: "Data Transfer only works in Game Mode",
    not_visible: "Data Transfer stopped looking. Leave this page and come back.",
    cap_reached: "Data Transfer stopped looking. Leave this page and come back.",
    unavailable: "This device couldn't open the network for Data Transfer"
};

export function dataTransferErrorKey(code: string): string {
    return DATA_TRANSFER_ERROR_KEYS[code] ?? "Something went wrong";
}
