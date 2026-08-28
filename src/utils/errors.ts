export function getErrorMessage(error: any, fallback: string) {
    const message = String(
        error?.message ?? error?.error ?? error?.body?.error ?? error?.body?.message ?? error ?? ""
    ).trim();

    return message || fallback;
}

export function logError(label: string, err: unknown) {
    // eslint-disable-next-line no-console
    console.error(`[cheevodeck] ${label}:`, err);
}
