import { useSyncExternalStore } from "react";

import {
    emulatorsClearPendingClient,
    emulatorsPendingClient,
    emulatorsPlanAbandon,
    emulatorsPlanAbort,
    emulatorsPlanBegin,
    emulatorsPlanClient,
    emulatorsPlanEnd,
    emulatorsPlanStep,
    saveMpShortcutFallback,
    type EmulatorClientUndo
} from "../api";
import { askAddToSteam, type AddToSteamChoice } from "../components/emulators/AddToSteamModal";
import { askEmulatorQuestion } from "../components/emulators/EmulatorQuestionModal";
import { getCurrentLanguage, t, type LanguageCode } from "../locales";
import type { FixStep, MultiplayerMode } from "../types";
import { showToastAfter } from "./delayedToast";
import { watchEmulatorJob } from "./emulatorJobs";
import { addEmulatorShortcut, removeEmulatorShortcut, steamCollections } from "./emulatorShortcuts";
import { logError } from "./errors";
import { setUpStreaming } from "./streamPlay";

type FixStepState = "waiting" | "running" | "done" | "failed" | "kept";

export type FixRunStep = {
    step: FixStep;
    state: FixStepState;
    progress: number;
    error: string;
};

export type FixRun = {
    mode: MultiplayerMode;
    gameId: number;
    startedAt: number;
    steps: FixRunStep[];
    current: number;
    running: boolean;
    done: boolean;
    failed: boolean;
    error: string;
};

type FixPlanStore = { run: FixRun | null; finished: number };

const MODE_NAMES: Record<MultiplayerMode, string> = {
    link: "Link Play",
    couch: "Couch Play",
    stream: "Stream Play"
};

let store: FixPlanStore = { run: null, finished: 0 };
let windowOpen = false;
let pageShown = false;
const listeners = new Set<() => void>();

function publish(next: Partial<FixPlanStore>) {
    store = { ...store, ...next };
    for (const listener of listeners) {
        listener();
    }
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function update(index: number, change: Partial<FixRunStep>, run: Partial<FixRun> = {}) {
    const current = store.run;
    if (current === null) {
        return;
    }
    const steps = current.steps.map((row, at) => (at === index ? { ...row, ...change } : row));
    publish({ run: { ...current, ...run, steps } });
}

export function useFixPlan(): FixPlanStore {
    return useSyncExternalStore(subscribe, () => store);
}

function fixPlanRunning(): boolean {
    return store.run?.running ?? false;
}

export function setFixWindowOpen(open: boolean) {
    windowOpen = open;
}

export function setMultiplayerPageShown(shown: boolean) {
    pageShown = shown;
}

export function chooseFixVia(steps: FixStep[], index: number, via: "flatpak" | "appimage"): FixStep[] {
    const kind = steps[index].kind;
    const choice = steps[index].choices?.find((option) => option.via === via);
    if (!choice) {
        return steps;
    }
    return steps.map((step, at) => {
        if (at === index) {
            return { ...step, via };
        }
        if (step.do === "add_to_steam" && step.kind === kind) {
            return { ...step, via, id: choice.id, scope: choice.scope, path: choice.path };
        }
        return step;
    });
}

export function chooseFixCore(steps: FixStep[], index: number, core: string): FixStep[] {
    const choice = steps[index].choices?.find((option) => option.core === core);
    if (!choice) {
        return steps;
    }
    return steps.map((step, at) => (at === index ? { ...step, core, name: choice.name, size: choice.size } : step));
}

function carryChoices(fresh: FixStep[], picked: FixStep[]): FixStep[] {
    let steps = fresh;
    picked.forEach((step) => {
        const at = steps.findIndex((other) => other.do === step.do && other.kind === step.kind && other.choices);
        if (at < 0) {
            return;
        }
        if (step.do === "install_emulator" && step.via) {
            steps = chooseFixVia(steps, at, step.via);
        }
        else if (step.do === "install_core" && step.core) {
            steps = chooseFixCore(steps, at, step.core);
        }
    });
    return steps;
}

async function runClientUndos(undos: EmulatorClientUndo[]) {
    for (const undo of undos) {
        try {
            if (undo.do === "remove_shortcut" && typeof undo.appid === "number") {
                removeEmulatorShortcut(undo.appid);
            }
            else if (undo.do === "shortcut_fallback_off") {
                await saveMpShortcutFallback(false);
            }
        }
        catch (e) {
            logError("ez fix: undoing a step", e);
        }
    }
    try {
        await emulatorsClearPendingClient();
    }
    catch (e) {
        logError("ez fix: clearing undone steps", e);
    }
}

async function runBackendStep(language: LanguageCode, plan: string, index: number, step: FixStep): Promise<string> {
    let force = false;
    for (;;) {
        const started = await emulatorsPlanStep(plan, step, force);
        if (!started?.ok || !started.job) {
            return started?.error ?? "failed";
        }
        const ended = await watchEmulatorJob(started.job, (state) => update(index, { progress: state.progress }));
        if (ended.stage === "done") {
            return "";
        }
        if (ended.error !== "newer_than_stable" || force) {
            return ended.error || "failed";
        }
        const replace = await askEmulatorQuestion({
            language,
            title: t(language, "Newer Than Stable"),
            text: t(language, "{{name}} on this device is newer than the stable one, probably a nightly or dev build you installed. CheevoDeck leaves it alone unless you choose to replace it.", {
                name: step.name ?? ""
            }),
            confirm: t(language, "Replace with Stable"),
            cancel: t(language, "Keep Mine"),
            focusConfirm: false
        });
        if (!replace) {
            return "kept";
        }
        force = true;
    }
}

async function runClientStep(language: LanguageCode, plan: string, step: FixStep, shortcut: AddToSteamChoice | null): Promise<string> {
    if (step.do === "add_to_steam" && step.kind && step.via) {
        const install = step.via === "flatpak"
            ? { via: "flatpak" as const, id: step.id ?? "", scope: step.scope ?? "user" }
            : { via: "appimage" as const, path: step.path ?? "" };
        const name = shortcut?.name || t(language, "{{name}} (Emulator)", { name: step.name ?? "" });
        const appid = await addEmulatorShortcut(name, install, shortcut?.collection ?? "");
        if (appid <= 0) {
            return "failed";
        }
        const noted = await emulatorsPlanClient(plan, { do: "remove_shortcut", appid, kind: step.kind, via: step.via,
            path: step.path ?? "" });
        if (!noted?.ok) {
            removeEmulatorShortcut(appid);
            return "failed";
        }
        return "";
    }
    if (step.do === "enable_shortcut_fallback") {
        const saved = await saveMpShortcutFallback(true);
        if (!saved?.ok) {
            return "failed";
        }
        await emulatorsPlanClient(plan, { do: "shortcut_fallback_off" });
        return "";
    }
    if (step.do === "setup_streaming") {
        return (await setUpStreaming()) ? "" : "failed";
    }
    return "failed";
}

function announce(language: LanguageCode, mode: MultiplayerMode, ok: boolean) {
    if (windowOpen || pageShown) {
        return;
    }
    showToastAfter({
        title: t(language, MODE_NAMES[mode]),
        body: ok ? t(language, "Ready to play") : t(language, "Couldn't finish the setup"),
        duration: 3000
    }, 0);
}

export type FixAnswer = { state: string; fix: FixStep[] | null } | null;

export async function runFixPlan(mode: MultiplayerMode, gameId: number, picked: FixStep[], refresh: () => Promise<FixAnswer>) {
    if (fixPlanRunning() || picked.length === 0) {
        return;
    }
    const language = getCurrentLanguage();
    const startedAt = Date.now();
    const begin = (steps: FixStep[]): FixRun => ({ mode, gameId, startedAt,
        steps: steps.map((step) => ({ step, state: "waiting", progress: -1, error: "" })), current: 0, running: true,
        done: false, failed: false, error: "" });
    publish({ run: begin(picked) });
    let answer: FixAnswer = null;
    try {
        answer = await refresh();
    }
    catch (e) {
        logError("ez fix: re-making the plan", e);
    }
    if (answer?.state === "ready") {
        publish({ run: { ...store.run!, steps: store.run!.steps.map((row) => ({ ...row, state: "done" })), running: false,
            done: true }, finished: store.finished + 1 });
        announce(language, mode, true);
        return;
    }
    if (!answer?.fix || answer.fix.length === 0) {
        publish({ run: { ...store.run!, running: false, failed: true, error: "failed" }, finished: store.finished + 1 });
        announce(language, mode, false);
        return;
    }
    const steps = carryChoices(answer.fix, picked);
    const shortcuts = new Map<number, AddToSteamChoice>();
    for (const [index, step] of steps.entries()) {
        if (step.do !== "add_to_steam") {
            continue;
        }
        const choice = await askAddToSteam(language, {
            defaultName: t(language, "{{name}} (Emulator)", { name: step.name ?? "" }),
            lines: [],
            collections: steamCollections()
        });
        if (choice === null) {
            publish({ run: null });
            return;
        }
        shortcuts.set(index, choice);
    }
    publish({ run: begin(steps) });
    let plan = "";
    let failure = "";
    let at = 0;
    try {
        const begun = await emulatorsPlanBegin();
        if (!begun?.ok || !begun.plan) {
            failure = begun?.error ?? "failed";
        }
        else {
            plan = begun.plan;
            for (; at < steps.length; at += 1) {
                update(at, { state: "running", progress: -1 }, { current: at });
                failure = steps[at].where === "backend"
                    ? await runBackendStep(language, plan, at, steps[at])
                    : await runClientStep(language, plan, steps[at], shortcuts.get(at) ?? null);
                if (failure) {
                    break;
                }
                update(at, { state: "done", progress: 100 });
            }
        }
    }
    catch (e) {
        logError("ez fix: running the plan", e);
        failure = "failed";
    }
    if (!failure) {
        try {
            const ended = await emulatorsPlanEnd(plan);
            if (!ended?.ok) {
                logError("ez fix: closing the plan", new Error("the plan wouldn't close"));
            }
        }
        catch (e) {
            logError("ez fix: closing the plan", e);
        }
        publish({ run: { ...store.run!, running: false, done: true }, finished: store.finished + 1 });
        announce(language, mode, true);
        return;
    }
    if (at < steps.length) {
        update(at, { state: failure === "kept" ? "kept" : "failed", error: failure });
    }
    if (plan) {
        try {
            const aborted = await emulatorsPlanAbort(plan);
            await runClientUndos(aborted?.client ?? []);
        }
        catch (e) {
            logError("ez fix: rolling the plan back", e);
        }
    }
    publish({ run: { ...store.run!, running: false, failed: true, error: failure }, finished: store.finished + 1 });
    announce(language, mode, false);
}

export async function finishPendingFixes() {
    try {
        const abandoned = await emulatorsPlanAbandon();
        if (abandoned?.ok && abandoned.client.length > 0) {
            await runClientUndos(abandoned.client);
        }
        const pending = await emulatorsPendingClient();
        if (pending?.ok && pending.client.length > 0) {
            await runClientUndos(pending.client);
        }
    }
    catch (e) {
        logError("ez fix: finishing an interrupted plan", e);
    }
}
