import { logError } from "./errors";

export function loadCachedImage(
    readCache: () => string | null,
    fetchImage: () => Promise<{ dataUri: string | null }>,
    apply: (dataUri: string | null, fromFetch: boolean) => void,
    errorTag: string | null
): () => void {
    const cachedDataUri = readCache();
    if (cachedDataUri) {
        apply(cachedDataUri, false);
    }
    else {
        apply(null, false);
    }

    let cancelled = false;
    void (async () => {
        try {
            const result = await fetchImage();
            if (cancelled) {
                return;
            }
            if (result?.dataUri) {
                apply(result.dataUri, true);
            }
            else if (!cachedDataUri) {
                apply(null, true);
            }
        } catch (e) {
            if (errorTag) {
                logError(errorTag, e);
            }
            if (!cancelled && !cachedDataUri) {
                apply(null, true);
            }
        }
    })();

    return () => {
        cancelled = true;
    };
}
