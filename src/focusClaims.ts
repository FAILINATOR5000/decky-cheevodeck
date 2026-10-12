import { useCallback, useSyncExternalStore } from "react";
import { logFocusDebug } from "./api";

export type KeyClaim = { token: number; armed: boolean; recovery: boolean; owner: number };

const claims = new Map<string, KeyClaim>();
const listeners = new Map<string, Set<() => void>>();
const spentListeners = new Set<(key: string) => void>();
let nextToken = 1;
let lastSpentAt = 0;

function announce(key: string) {
    const set = listeners.get(key);
    if (!set) {
        return;
    }
    queueMicrotask(() => {
        for (const listener of set) {
            listener();
        }
    });
}

export function armKeyClaim(key: string, owner: number, recovery = false): number {
    const token = nextToken;
    nextToken += 1;
    claims.set(key, { token, armed: !recovery, recovery, owner });
    logFocusDebug("claim", recovery ? "recover-offer" : "arm", `${key} token=${token} owner=${owner}`);
    announce(key);
    return token;
}

export function confirmRecoveryClaim(key: string, token: number) {
    const claim = claims.get(key);
    if (!claim || claim.token !== token || !claim.recovery || claim.armed) {
        return;
    }
    claims.set(key, { ...claim, armed: true });
    logFocusDebug("claim", "recover-confirm", `${key} token=${token}`);
    announce(key);
}

export function withdrawKeyClaim(key: string, token: number, why: string) {
    const claim = claims.get(key);
    if (!claim || claim.token !== token) {
        return;
    }
    claims.delete(key);
    logFocusDebug("claim", "withdraw", `${key} token=${token} ${why}`);
    announce(key);
}

export function spendKeyClaim(key: string, token: number) {
    const claim = claims.get(key);
    if (!claim || claim.token !== token || !claim.armed) {
        return;
    }
    claims.set(key, { ...claim, armed: false, recovery: false });
    announce(key);
    for (const listener of spentListeners) {
        listener(key);
    }
}

export function disarmKeyClaims(owner: number) {
    for (const [key, claim] of claims) {
        if (claim.owner === owner && (claim.armed || claim.recovery)) {
            claims.set(key, { ...claim, armed: false, recovery: false });
            announce(key);
        }
    }
}

export function onKeyClaimSpent(listener: (key: string) => void): () => void {
    spentListeners.add(listener);
    return () => {
        spentListeners.delete(listener);
    };
}

function subscribeKey(key: string, listener: () => void): () => void {
    let set = listeners.get(key);
    if (!set) {
        set = new Set();
        listeners.set(key, set);
    }
    set.add(listener);
    return () => {
        set.delete(listener);
        if (set.size === 0) {
            listeners.delete(key);
        }
    };
}

export function useKeyClaim(key: string | undefined): KeyClaim | null {
    const subscribe = useCallback((listener: () => void) => (key ? subscribeKey(key, listener) : () => {}), [key]);
    const read = useCallback(() => (key ? claims.get(key) ?? null : null), [key]);
    return useSyncExternalStore(subscribe, read);
}

export function noteClaimSpent() {
    lastSpentAt = Date.now();
}

export function claimSpentWithin(ms: number): boolean {
    return Date.now() - lastSpentAt < ms;
}

const HEIR_EXPECT_MS = 10000;
let heirExpectedAt = 0;

export function expectHeirClaim() {
    heirExpectedAt = Date.now();
}

export function settleHeirClaim() {
    heirExpectedAt = 0;
}

export function heirClaimExpected(): boolean {
    return heirExpectedAt > lastSpentAt && Date.now() - heirExpectedAt < HEIR_EXPECT_MS;
}
