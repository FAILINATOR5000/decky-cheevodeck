import { createElement, type ReactNode } from "react";

type ActionStore = {
    SubscribeToActions: (callback: (descriptions: Record<number, unknown>) => void) => () => void;
    SetAction: (key: number, value: unknown) => boolean;
    Notify: () => void;
    m_boundActions: Map<number, unknown>;
    m_defaultActions: Map<number, unknown>;
};

let cached: ActionStore | null | undefined;

function actionStore(): ActionStore | null {
    if (cached !== undefined) {
        return cached;
    }
    try {
        const root = (window as unknown as { SteamUIStore?: any }).SteamUIStore;
        const store = root?.m_WindowStore?.GamepadUIMainWindowInstance?.ActionDescriptionStore;
        const usable =
            typeof store?.SubscribeToActions === "function" &&
            typeof store?.SetAction === "function" &&
            typeof store?.Notify === "function" &&
            typeof store?.m_boundActions?.forEach === "function" &&
            typeof store?.m_defaultActions?.get === "function";
        cached = usable ? store as ActionStore : null;
    }
    catch {
        cached = null;
    }
    return cached;
}

let working = false;

function restoreDefaultPrompts(store: ActionStore): void {
    if (working) {
        return;
    }
    working = true;
    try {
        const stale: number[] = [];
        store.m_boundActions.forEach((value, key) => {
            if (value !== null) {
                return;
            }
            const fallback = store.m_defaultActions.get(key);
            if (fallback === undefined || fallback === null) {
                return;
            }
            stale.push(key);
        });
        if (!stale.length) {
            return;
        }
        for (const key of stale) {
            store.SetAction(key, undefined);
        }
        store.Notify();
    }
    finally {
        working = false;
    }
}

const CANCEL_ACTION = 1;

let activeStore: ActionStore | null = null;
let backLabel: string | null = null;
let heldBack: ReactNode = null;

function holdBack(store: ActionStore): void {
    if (working || backLabel === null) {
        return;
    }
    const bound = store.m_boundActions.get(CANCEL_ACTION);
    if (bound !== undefined && bound !== null) {
        return;
    }
    working = true;
    try {
        heldBack = createElement("span", null, backLabel);
        store.SetAction(CANCEL_ACTION, heldBack);
        store.Notify();
    }
    finally {
        working = false;
    }
}

function releaseBack(store: ActionStore): void {
    if (heldBack !== null && store.m_boundActions.get(CANCEL_ACTION) === heldBack) {
        working = true;
        try {
            store.SetAction(CANCEL_ACTION, undefined);
            store.Notify();
        }
        finally {
            working = false;
        }
    }
    heldBack = null;
}

export function setFooterBack(label: string | null): void {
    if (label === backLabel) {
        return;
    }
    backLabel = label;
    const store = activeStore;
    if (!store) {
        return;
    }
    try {
        if (label === null) {
            releaseBack(store);
            return;
        }
        if (heldBack === null || store.m_boundActions.get(CANCEL_ACTION) !== heldBack) {
            holdBack(store);
            return;
        }
        working = true;
        try {
            heldBack = createElement("span", null, label);
            store.SetAction(CANCEL_ACTION, heldBack);
            store.Notify();
        }
        finally {
            working = false;
        }
    }
    catch {
    }
}

export function guardFooterPrompts(): () => void {
    const store = actionStore();
    if (!store) {
        return () => { };
    }
    let unsubscribe: (() => void) | null = null;
    try {
        unsubscribe = store.SubscribeToActions(() => {
            restoreDefaultPrompts(store);
            holdBack(store);
        });
        activeStore = store;
        holdBack(store);
    }
    catch {
        return () => { };
    }
    return () => {
        activeStore = null;
        try {
            unsubscribe?.();
            releaseBack(store);
        }
        catch {
        }
    };
}
