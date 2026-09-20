const TRANSFER_ERROR_KEYS: Record<string, string> = {
    busy: "Something is already running",
    bad_target: "That folder isn't there any more",
    not_writable: "That folder can't be written to",
    no_space: "Not enough room",
    nothing_to_export: "There are no memories to export yet",
    write_failed: "Writing the bundle failed",
    import_failed: "The import failed",
    no_account: "Sign in to RetroAchievements first",
    stash_pending: "An unfinished restore is in the way",
    stash_failed: "The old library couldn't be moved aside",
    not_a_bundle: "That isn't a CheevoDeck bundle",
    format_too_new: "That bundle was made by a newer CheevoDeck",
    manifest_bad: "That bundle's details couldn't be read",
    no_records: "That bundle holds no memories",
    media_missing: "Some of that bundle's files are missing",
    count_mismatch: "That bundle's counts don't add up",
    unreadable: "That bundle couldn't be read"
};

export function transferErrorKey(code: string): string {
    return TRANSFER_ERROR_KEYS[code] ?? "Something went wrong";
}
