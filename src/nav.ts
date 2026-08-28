import type { ViewKey } from "./types";

export type Route = {
    view: ViewKey;
};

export type NavStack = Route[];

export type NavIntent = "push" | "back" | "root" | "hub";

type NavStep = { view: ViewKey; intent: NavIntent | "restore"; agreed: boolean };

export type NavState = {
    stack: NavStack;
    step: NavStep;
};

export function initialNav(view: ViewKey): NavState {
    return { stack: [{ view }], step: { view, intent: "root", agreed: true } };
}

export function settleNav(state: NavState, next: Route, intent: NavIntent): NavState {
    const { stack } = state;
    const step = (agreed: boolean) => ({ view: next.view, intent, agreed });

    if (intent === "root") {
        if (stack.length === 1 && stack[0].view === next.view) {
            return state;
        }
        return { stack: [next], step: step(true) };
    }
    if (intent === "hub") {
        const landed = next.view === "achievements" ? [next] : [{ view: "achievements" as ViewKey }, next];
        return { stack: landed, step: step(true) };
    }
    if (intent === "back") {
        const popped = stack.slice(0, -1);
        const uncovered = popped[popped.length - 1];
        if (uncovered && uncovered.view === next.view) {
            return { stack: popped, step: step(true) };
        }
        const resynced = popped.length > 0 ? [...popped.slice(0, -1), next] : [next];
        return { stack: resynced, step: step(false) };
    }
    const top = stack[stack.length - 1];
    if (top && top.view === next.view) {
        return state;
    }
    return { stack: [...stack, next], step: step(true) };
}

export function rehydrateNav(saved: ViewKey[] | null, landed: ViewKey): NavState {
    if (saved && saved.length > 0 && saved[saved.length - 1] === landed) {
        return {
            stack: saved.map((view) => ({ view })),
            step: { view: landed, intent: "restore", agreed: true }
        };
    }
    const synthesised: NavStack = landed === "achievements"
        ? [{ view: landed }]
        : [{ view: "achievements" as ViewKey }, { view: landed }];
    return { stack: synthesised, step: { view: landed, intent: "restore", agreed: saved === null } };
}

export function describeStack(stack: NavStack): string {
    return stack.slice(-6).map((route) => route.view).join(" > ");
}

export function previousView(stack: NavStack): ViewKey | null {
    return stack.length > 1 ? stack[stack.length - 2].view : null;
}
