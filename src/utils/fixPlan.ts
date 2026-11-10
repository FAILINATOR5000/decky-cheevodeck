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
    savePlayShortcutFallback,
    type EmulatorClientUndo
} from "../api";
import { askAddToSteam, type AddToSteamChoice } from "../components/emulators/AddToSteamModal";
import { askEmulatorQuestion } from "../components/emulators/EmulatorQuestionModal";
import { getCurrentLanguage, t, type LanguageCode } from "../locales";
import type { FixChoice, FixPlan, FixStep, MultiplayerMode } from "../types";
import { showToastAfter } from "./delayedToast";
import { watchEmulatorJob } from "./emulatorJobs";
import { addEmulatorShortcut, removeEmulatorShortcut, steamCollections } from "./emulatorShortcuts";
import { logError } from "./errors";
import { pickGameFile } from "./gameFilePick";
import { quickAccessIsHidden } from "./quickAccess";
import { setUpStreaming } from "./streamPlay";

export type FixTarget = MultiplayerMode | "play";

type FixStepState = "waiting" | "running" | "done" | "failed" | "kept" | "undone";

export type FixRunStep = {
    step: FixStep;
    state: FixStepState;
    progress: number;
    error: string;
};

export type FixAnswer = {
    state: "ready" | "setup" | "never";
    gate: string | null;
    detail: Record<string, string>;
    plan: FixPlan;
};

export type FixRun = {
    target: FixTarget;
    gameId: number;
    title: string;
    startedAt: number;
    steps: FixRunStep[];
    current: number;
    running: boolean;
    done: boolean;
    failed: boolean;
    error: string;
    already: boolean;
    kept: boolean;
    refused: boolean;
    left: string[];
    next: FixAnswer | null;
};

type FixPlanStore = { run: FixRun | null; finished: number };

const MODE_NAMES: Record<MultiplayerMode, string> = {
    link: "Link Play",
    couch: "Couch Play",
    stream: "Stream Play"
};

const MAX_ROUNDS = 6;

export const RUN_SETTLE_MS = 700;

export const HOST_GATES = ["no_scan", "not_in_results", "rom_missing", "no_shortcut", "no_emulator_shortcut"];

let store: FixPlanStore = { run: null, finished: 0 };
let windowsOpen = 0;
let pageShown = false;
let reopenWindow: (() => void) | null = null;
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
    windowsOpen = Math.max(0, windowsOpen + (open ? 1 : -1));
}

export function setMultiplayerPageShown(shown: boolean) {
    pageShown = shown;
}

function bringWindowBack() {
    if (windowsOpen === 0 && reopenWindow !== null) {
        reopenWindow();
    }
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

function choiceSet(choices: FixChoice[] | undefined): string {
    return (choices ?? []).map((choice) => choice.core ?? choice.via ?? "").sort().join("|");
}

function carryChoices(fresh: FixStep[], picked: FixStep[]): FixStep[] {
    let steps = fresh;
    picked.forEach((step) => {
        const at = steps.findIndex((other) => other.do === step.do && other.kind === step.kind && other.choices
            && choiceSet(other.choices) === choiceSet(step.choices));
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
            else if (undo.do === "play_shortcut_fallback_off") {
                await savePlayShortcutFallback(false);
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
        bringWindowBack();
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
        const appid = await addEmulatorShortcut(name, install, shortcut?.collection ?? "", shortcut?.newCollection ?? "");
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
    if (step.do === "enable_play_shortcut_fallback") {
        const saved = await savePlayShortcutFallback(true);
        if (!saved?.ok) {
            return "failed";
        }
        await emulatorsPlanClient(plan, { do: "play_shortcut_fallback_off" });
        return "";
    }
    if (step.do === "setup_streaming") {
        return (await setUpStreaming()) ? "" : "failed";
    }
    return "failed";
}

function announce(language: LanguageCode, run: FixRun, ok: boolean) {
    if (windowsOpen > 0 || (pageShown && !quickAccessIsHidden())) {
        return;
    }
    showToastAfter({
        title: run.target === "play" ? run.title : t(language, MODE_NAMES[run.target]),
        body: ok ? t(language, "Ready to play") : t(language, "Couldn't finish the setup"),
        duration: 3000
    }, 0);
}

async function askShortcutNames(language: LanguageCode, steps: FixStep[], offset: number): Promise<Map<number, AddToSteamChoice> | null> {
    const names = new Map<number, AddToSteamChoice>();
    for (const [index, step] of steps.entries()) {
        if (step.do !== "add_to_steam") {
            continue;
        }
        bringWindowBack();
        const choice = await askAddToSteam(language, {
            defaultName: t(language, "{{name}} (Emulator)", { name: step.name ?? "" }),
            lines: [],
            collections: steamCollections()
        });
        if (choice === null) {
            return null;
        }
        names.set(offset + index, choice);
    }
    return names;
}

type RoundEnd = { failure: string; kept: boolean; left: string[] };

async function runSession(language: LanguageCode, steps: FixStep[], offset: number,
    names: Map<number, AddToSteamChoice>): Promise<RoundEnd> {
    const indexes = steps.map((_step, index) => offset + index).filter((at) => store.run!.steps[at].step.do !== "pick_game_file");
    if (indexes.length === 0) {
        return { failure: "", kept: false, left: [] };
    }
    let plan = "";
    let failure = "";
    let failedAt = -1;
    let current = -1;
    try {
        const begun = await emulatorsPlanBegin();
        if (!begun?.ok || !begun.plan) {
            failure = begun?.error ?? "failed";
        }
        else {
            plan = begun.plan;
            for (const at of indexes) {
                const step = store.run!.steps[at].step;
                current = at;
                update(at, { state: "running", progress: -1 }, { current: at });
                failure = step.where === "backend"
                    ? await runBackendStep(language, plan, at, step)
                    : await runClientStep(language, plan, step, names.get(at) ?? null);
                if (failure) {
                    failedAt = at;
                    break;
                }
                update(at, { state: "done", progress: 100 });
            }
        }
    }
    catch (e) {
        logError("ez fix: running the plan", e);
        failure = failure || "failed";
        if (failedAt < 0) {
            failedAt = current;
        }
    }
    if (!failure || failure === "kept") {
        if (failure === "kept") {
            update(failedAt, { state: "kept", error: failure });
        }
        try {
            const ended = await emulatorsPlanEnd(plan);
            if (!ended?.ok) {
                logError("ez fix: closing the plan", new Error("the plan wouldn't close"));
            }
        }
        catch (e) {
            logError("ez fix: closing the plan", e);
        }
        return { failure: "", kept: failure === "kept", left: [] };
    }
    if (failedAt >= 0) {
        update(failedAt, { state: "failed", error: failure });
    }
    let left: string[] = [];
    if (plan) {
        try {
            const aborted = await emulatorsPlanAbort(plan);
            await runClientUndos(aborted?.client ?? []);
            left = aborted?.left ?? [];
        }
        catch (e) {
            logError("ez fix: rolling the plan back", e);
        }
        for (const at of indexes) {
            if (store.run!.steps[at].state === "done") {
                update(at, { state: "undone" });
            }
        }
    }
    return { failure, kept: false, left };
}

async function fetchAnswer(refresh: () => Promise<FixAnswer | null>): Promise<FixAnswer | null> {
    try {
        return await refresh();
    }
    catch (e) {
        logError("ez fix: re-making the plan", e);
        return null;
    }
}

function stepKey(step: FixStep): string {
    return `${step.do}:${step.kind ?? step.core ?? ""}`;
}

function rows(steps: FixStep[]): FixRunStep[] {
    return steps.map((step) => ({ step, state: "waiting", progress: -1, error: "" }));
}

function finish(language: LanguageCode, change: Partial<FixRun>) {
    const run: FixRun = { ...store.run!, running: false, ...change };
    publish({ run, finished: store.finished + 1 });
    announce(language, run, !run.failed && run.next?.state === "ready");
}

export async function runFixPlan(target: FixTarget, gameId: number, title: string, picked: FixStep[],
    refresh: () => Promise<FixAnswer | null>, reopen: () => void, pickOnly = false) {
    if (fixPlanRunning() || picked.length === 0) {
        return;
    }
    const language = getCurrentLanguage();
    reopenWindow = reopen;
    const begin = (steps: FixStep[]): FixRun => ({ target, gameId, title, startedAt: Date.now(), steps: rows(steps),
        current: 0, running: true, done: false, failed: false, error: "", already: false, kept: false, refused: false,
        left: [], next: null });
    publish({ run: begin(picked) });
    let answer = await fetchAnswer(refresh);
    if (answer?.state === "ready" && answer.plan.steps.length === 0) {
        finish(language, { done: true, already: true, next: answer });
        return;
    }
    if (!answer || answer.plan.steps.length === 0) {
        finish(language, { failed: true, error: "failed", next: answer });
        return;
    }
    let steps = carryChoices(answer.plan.steps, picked);
    if (pickOnly) {
        steps = steps.filter((step) => step.do === "pick_game_file").map((step) => ({ ...step, path: undefined }));
    }
    publish({ run: { ...begin(steps), startedAt: store.run!.startedAt } });
    let offset = 0;
    for (let round = 1; ; round += 1) {
        const names = await askShortcutNames(language, steps, offset);
        if (names === null) {
            if (round === 1) {
                publish({ run: { ...store.run!, running: false, done: true,
                    next: answer && { ...answer, plan: { ...answer.plan, steps } } } });
                return;
            }
            finish(language, { done: true, next: answer });
            return;
        }
        const ended = await runSession(language, steps, offset, names);
        if (ended.failure) {
            finish(language, { failed: true, error: ended.failure, left: ended.left, next: answer });
            return;
        }
        if (ended.kept) {
            finish(language, { done: true, kept: true, next: await fetchAnswer(refresh) });
            return;
        }
        const pickAt = steps.findIndex((step) => step.do === "pick_game_file");
        if (pickAt >= 0) {
            const at = offset + pickAt;
            update(at, { state: "running", progress: -1 }, { current: at });
            const found = await pickGameFile(language, gameId, title, steps[pickAt].path ?? "");
            if (found === null) {
                update(at, { state: "waiting" });
                finish(language, { done: true, next: await fetchAnswer(refresh) });
                return;
            }
            if (found.error === "needs_dolphin") {
                update(at, { state: "waiting" });
                finish(language, { done: true, refused: true, next: await fetchAnswer(refresh) });
                return;
            }
            if (found.state !== "done") {
                update(at, { state: "failed", error: found.error });
                finish(language, { failed: true, error: found.error, next: answer });
                return;
            }
            update(at, { state: "done", progress: 100 });
            finish(language, { done: true, next: await fetchAnswer(refresh) });
            return;
        }
        answer = await fetchAnswer(refresh);
        const more = answer?.plan.steps ?? [];
        const done = new Set(store.run!.steps.filter((row) => row.state === "done").map((row) => stepKey(row.step)));
        const repeats = more.length > 0 && more.every((step) => done.has(stepKey(step)));
        if (more.length === 0 || repeats || answer?.plan.outcome === "after_pick" || round >= MAX_ROUNDS) {
            finish(language, { done: true, next: answer });
            return;
        }
        offset = store.run!.steps.length;
        steps = more;
        publish({ run: { ...store.run!, steps: [...store.run!.steps, ...rows(more)] } });
    }
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
