import { getLibraryBadgeProgress } from "../../api";

export type LibraryBadgeProgress = {
    earned: number;
    total: number;
};

type Entry = {
    value: LibraryBadgeProgress | null;
    expires: number;
};

type Running = {
    promise: Promise<LibraryBadgeProgress | null>;
    startedAt: number;
};

function since() {
    return performance.now();
}

const SUCCESS_TTL_MS = 30 * 1000;
const FAILURE_TTL_MS = 15 * 1000;

const DEADLINE_MS = 10000;

const MAX_ENTRIES = 300;

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Running>();

function keyFor(activeUlid: string, gameId: number) {
    return `${activeUlid}:${gameId}`;
}

function remember(key: string, value: LibraryBadgeProgress | null) {
    cache.delete(key);
    cache.set(key, {
        value,
        expires: since() + (value ? SUCCESS_TTL_MS : FAILURE_TTL_MS)
    });
    while (cache.size > MAX_ENTRIES) {
        const oldest = cache.keys().next();
        if (oldest.done) {
            break;
        }
        cache.delete(oldest.value);
    }
}

export function readCachedProgress(activeUlid: string, gameId: number) {
    const found = cache.get(keyFor(activeUlid, gameId));
    if (!found || found.expires <= since()) {
        return undefined;
    }
    return found.value;
}

async function withDeadline(call: Promise<LibraryBadgeProgress | null>) {
    const timedOut = Symbol("timedOut");
    let timer = 0;
    const deadline = new Promise<typeof timedOut>((resolve) => {
        timer = window.setTimeout(() => resolve(timedOut), DEADLINE_MS);
    });
    try {
        const first = await Promise.race([call, deadline]);
        return first === timedOut ? null : first;
    } finally {
        window.clearTimeout(timer);
    }
}

export async function loadProgress(activeUlid: string, gameId: number) {
    const key = keyFor(activeUlid, gameId);
    const cached = cache.get(key);
    if (cached && cached.expires > since()) {
        return cached.value;
    }

    const running = inFlight.get(key);
    if (running && since() - running.startedAt < DEADLINE_MS) {
        return withDeadline(running.promise);
    }

    const call = Promise.resolve().then(async () => {
        try {
            const result = await getLibraryBadgeProgress(gameId);
            const total = Number(result?.total ?? 0);
            if (!result || !total) {
                remember(key, null);
                return null;
            }
            const value = { earned: Number(result.earned ?? 0), total };
            remember(key, value);
            return value;
        } catch {
            remember(key, null);
            return null;
        } finally {
            if (inFlight.get(key)?.promise === call) {
                inFlight.delete(key);
            }
        }
    });

    inFlight.set(key, { promise: call, startedAt: since() });

    return withDeadline(call);
}

export function forgetLibraryBadgeProgress() {
    cache.clear();
}
