import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useEffect, useState, type ReactNode } from "react";

import { multiplayerCheck, multiplayerPlayInfo } from "../../api";
import { t, type LanguageCode } from "../../locales";
import type { FixPlan, FixStep, MultiplayerMode } from "../../types";
import { jobErrorText } from "../../utils/emulatorJobs";
import { logError } from "../../utils/errors";
import {
    chooseFixCore,
    chooseFixVia,
    runFixPlan,
    setFixWindowOpen,
    useFixPlan,
    type FixAnswer,
    type FixRun,
    type FixRunStep,
    type FixTarget
} from "../../utils/fixPlan";
import { forgetGameFile, gameFilePickFailure, useGameFilePick } from "../../utils/gameFilePick";
import { showManagedModal } from "../../utils/modalRegistry";
import { requestRoute } from "../../utils/pendingPanelEntry";
import { gateText } from "../../utils/multiplayerProblems";
import { modalSize } from "../../utils/scale";
import { useStreamSetup } from "../../utils/streamPlay";
import { achievementGreen, errorRed, smallTextStyle } from "../../utils/style";
import { DesktopToolButtons } from "../game/DesktopToolButtons";
import { FocusTarget } from "../ui/FocusTarget";
import { ProgressBar } from "../ui/ProgressBar";
import { STATE_LOOKS } from "./ModeChart";
import { ScanOrPickLines } from "./ScanOrPickLines";

export type FixItRequest = {
    target: FixTarget;
    gameId: number;
    title: string;
    answer: FixAnswer;
    tools: { emudeck?: boolean; srm?: boolean } | null;
    explain: (gate: string, detail: Record<string, string>) => string;
    refresh: () => Promise<FixAnswer | null>;
    forget?: () => void;
    switchTo?: (mode: MultiplayerMode) => void;
};

const MODES: MultiplayerMode[] = ["link", "couch", "stream"];

const MODE_NAMES: Record<MultiplayerMode, string> = { link: "Link Play", couch: "Couch Play", stream: "Stream Play" };

const TITLES: Record<MultiplayerMode, Record<"setup" | "never", string>> = {
    link: { setup: "Link Play: Needs setup", never: "Link Play: Won't work" },
    couch: { setup: "Couch Play: Needs setup", never: "Couch Play: Won't work" },
    stream: { setup: "Stream Play: Needs setup", never: "Stream Play: Won't work" }
};

const WILL_BE_READY: Record<FixTarget, string> = {
    link: "Link Play will be ready.",
    couch: "Couch Play will be ready.",
    stream: "Stream Play will be ready.",
    play: "The game will be ready to play."
};

const IS_READY: Record<FixTarget, string> = {
    link: "Link Play is ready.",
    couch: "Couch Play is ready.",
    stream: "Stream Play is ready.",
    play: "The game is ready to play."
};

const SHORTCUT_TOGGLES = ["enable_shortcut_fallback", "enable_play_shortcut_fallback"];

function size(bytes: number | undefined): string {
    return bytes ? `${Math.max(1, Math.round(bytes / 1000 ** 2))} MB` : "";
}

export function fixStepLabel(language: LanguageCode, step: FixStep): string {
    const name = step.name ?? "";
    switch (step.do) {
        case "install_core":
            return t(language, "Install {{core}}", { core: name });
        case "update_core":
            return t(language, "Update {{core}}", { core: name });
        case "install_emulator": {
            const about = size(step.choices?.find((choice) => choice.via === step.via)?.size);
            if (step.via === "appimage") {
                return about
                    ? t(language, "Install {{emulator}} (AppImage, about {{size}})", { emulator: name, size: about })
                    : t(language, "Install {{emulator}} (AppImage)", { emulator: name });
            }
            return about
                ? t(language, "Install {{emulator}} (Flatpak, about {{size}})", { emulator: name, size: about })
                : t(language, "Install {{emulator}} (Flatpak)", { emulator: name });
        }
        case "update_emulator":
            return t(language, "Update {{emulator}}", { emulator: name });
        case "add_to_steam":
            return t(language, "Add {{emulator}} to Steam", { emulator: name });
        case "enable_shortcut_fallback":
            return t(language, "Turn On Emulator Shortcuts");
        case "enable_play_shortcut_fallback":
            return t(language, "Turn On Play Through Emulator Shortcuts");
        case "setup_streaming":
            return t(language, "Set Up Streaming");
        case "pick_game_file":
            return step.path
                ? t(language, "Check {{file}}", { file: step.path.slice(step.path.lastIndexOf("/") + 1) })
                : t(language, "Pick the Game's File");
    }
}

function fixDoneLine(language: LanguageCode, step: FixStep): string {
    const name = step.name ?? "";
    switch (step.do) {
        case "install_core":
            return t(language, "{{core}} was installed.", { core: name });
        case "update_core":
            return t(language, "{{core}} was updated.", { core: name });
        case "install_emulator":
            return t(language, "{{emulator}} was installed.", { emulator: name });
        case "update_emulator":
            return t(language, "{{emulator}} was updated.", { emulator: name });
        case "add_to_steam":
            return t(language, "{{emulator}} was added to Steam.", { emulator: name });
        case "enable_shortcut_fallback":
            return t(language, "Emulator Shortcuts was enabled.");
        case "enable_play_shortcut_fallback":
            return t(language, "Play Through Emulator Shortcuts was turned on.");
        case "setup_streaming":
            return t(language, "Streaming was set up.");
        case "pick_game_file":
            return t(language, "The game's file was found.");
    }
}

function missingLine(language: LanguageCode, step: FixStep, gate: string): string {
    const name = step.name ?? "";
    switch (step.do) {
        case "enable_shortcut_fallback":
        case "enable_play_shortcut_fallback":
            return t(language, "This game has no Steam shortcut of its own");
        case "install_emulator":
            return step.reason === "missing"
                ? t(language, "{{emulator}} isn't installed anymore, but its Steam shortcut is still there", { emulator: name })
                : t(language, "{{emulator}} isn't installed", { emulator: name });
        case "add_to_steam":
            return t(language, "{{emulator}} isn't in Steam", { emulator: name });
        case "install_core":
            if ((step.choices?.length ?? 0) > 1) {
                return gate === "no_couch_core"
                    ? t(language, "None of the installed cores can do Couch Play with this game")
                    : t(language, "None of the installed cores can run this game");
            }
            return t(language, "{{core}} isn't installed", { core: name });
        case "update_core":
            return t(language, "{{core}} is too old", { core: name });
        case "update_emulator":
            return t(language, "{{emulator}} isn't the host's version", { emulator: name });
        case "setup_streaming":
            return t(language, "Streaming isn't set up yet");
        case "pick_game_file":
            return t(language, "CheevoDeck doesn't know which file is this game yet");
    }
}

function missingLines(language: LanguageCode, plan: FixPlan): string[] {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const stage of plan.stages) {
        for (const step of stage.steps) {
            const key = `${step.do}:${step.kind ?? step.core ?? ""}`;
            if (!seen.has(key)) {
                seen.add(key);
                lines.push(missingLine(language, step, stage.gate));
            }
        }
    }
    return lines;
}

function reasonLine(language: LanguageCode, step: FixStep): string {
    if (step.reason === "host_version") {
        const latest = step.choices?.find((choice) => choice.via === step.via)?.latest ?? "";
        return t(language, "Matches the host's {{emulator}} {{version}}", { emulator: step.name ?? "", version: latest });
    }
    if (SHORTCUT_TOGGLES.includes(step.do)) {
        return t(language, "Uses the emulator's own Steam shortcut, so the game doesn't need one");
    }
    if (step.reason === "game_shortcut") {
        return t(language, "Same install as this game's shortcut");
    }
    if (step.reason === "missing") {
        return t(language, "Its Steam shortcut is still there, so it isn't added again");
    }
    if (step.reason === "dolphin_tool") {
        return t(language, "Cheevo Check reads GameCube and Wii files with a tool inside Dolphin's Flatpak");
    }
    return "";
}

function pickFailure(language: LanguageCode, run: FixRun, row: FixRunStep): string {
    return gameFilePickFailure(language, { gameId: run.gameId, title: run.title, fileName: "", state: "failed",
        error: row.error, label: "" });
}

function rowFailure(language: LanguageCode, run: FixRun, row: FixRunStep): string {
    if (row.state === "kept") {
        return t(language, "Kept yours. Fix It stopped here, and the steps before it stay done.");
    }
    if (row.step.do === "pick_game_file") {
        return pickFailure(language, run, row);
    }
    const why = jobErrorText(language, row.error, row.step.name ?? "", row.step.do.endsWith("_core"));
    let after = t(language, "Nothing was changed.");
    if (run.left.length > 0) {
        after = t(language, "Some of it couldn't be undone: {{items}}", { items: run.left.join(", ") });
    }
    else if (run.steps.some((other) => other.state === "undone")) {
        after = t(language, "The steps before it were undone.");
    }
    else if (run.steps.some((other) => other.state === "done")) {
        after = t(language, "The steps marked done stay done.");
    }
    return why ? `${why} ${after}` : after;
}

export function fixFailureText(language: LanguageCode, run: FixRun): string {
    const row = run.steps.find((other) => other.state === "failed" || other.state === "kept");
    return row ? rowFailure(language, run, row) : t(language, "Nothing was changed.");
}

function Section(props: { label: string; children: ReactNode }) {
    return (
        <div style={{ marginBottom: "12px" }}>
            <div style={{ ...smallTextStyle(), fontWeight: 700, opacity: 1, marginBottom: "4px" }}>{props.label}</div>
            {props.children}
        </div>
    );
}

function Line(props: { children: ReactNode; color?: string }) {
    return (
        <div style={{ fontSize: `${modalSize(16)}px`, lineHeight: 1.4, whiteSpace: "pre-line", color: props.color, marginBottom: "4px" }}>
            {props.children}
        </div>
    );
}

function FixItModal(props: { language: LanguageCode; request: FixItRequest; close: () => void }) {
    const { language, request, close } = props;
    const { run } = useFixPlan();
    const pick = useGameFilePick().pick;
    const stream = useStreamSetup(true);
    const [openedAt] = useState(() => Date.now());
    const [followed, setFollowed] = useState(run?.running ? run.startedAt : 0);

    useEffect(() => {
        setFixWindowOpen(true);
        return () => setFixWindowOpen(false);
    }, []);

    useEffect(() => {
        if (run?.running) {
            setFollowed(run.startedAt);
        }
    }, [run?.running, run?.startedAt]);

    const ours = run !== null && run.target === request.target && run.gameId === request.gameId;
    const live = run !== null && (run.running || (ours && run.failed)) ? run : null;
    const ended = run !== null && ours && run.done && !run.running && (run.startedAt >= openedAt || run.startedAt === followed)
        ? run : null;
    const waiting = ended?.next && ended.next.state !== "ready" && ended.next.plan.steps.length > 0 ? ended.next : null;
    const answer = waiting ?? request.answer;
    const plan = answer.plan;
    const phase = live?.running ? "running" : live?.failed ? "failed" : ended && !waiting ? "done" : "ready";
    const [steps, setSteps] = useState(plan.steps);

    useEffect(() => {
        setSteps(plan.steps);
    }, [plan]);

    const after = ended?.next ?? null;
    const state = phase === "done" ? after?.state === "ready" ? "ready" : after?.state === "never" ? "never" : "setup" : answer.state;
    const look = STATE_LOOKS[state];
    const title = request.target === "play" ? request.title
        : state === "ready" ? t(language, MODE_NAMES[request.target]) : t(language, TITLES[request.target][state]);
    const picking = plan.steps.some((step) => step.do === "pick_game_file");
    const toggling = plan.steps.some((step) => SHORTCUT_TOGGLES.includes(step.do))
        || (plan.steps.length === 0 && (answer.gate === "no_shortcut" || answer.gate === "no_emulator_shortcut"));

    function start() {
        const picked = live?.failed ? live.steps.map((row) => row.step) : steps;
        void runFixPlan(request.target, request.gameId, request.title, picked, request.refresh,
            () => showFixIt(language, request));
    }

    function renderChoices(step: FixStep, index: number) {
        if (!step.choices || step.choices.length < 2) {
            const why = reasonLine(language, step);
            return why ? <div style={{ ...smallTextStyle(), marginLeft: "18px" }}>{why}</div> : null;
        }
        return (
            <Focusable flow-children={step.do === "install_core" ? "column" : "row"}
                style={{ display: "flex", flexDirection: step.do === "install_core" ? "column" : "row", gap: "6px", margin: "6px 0 0 18px" }}>
                {step.choices.map((choice) => {
                    const id = choice.via ?? choice.core ?? "";
                    const chosen = step.do === "install_core" ? choice.core === step.core : choice.via === step.via;
                    const label = choice.via === "flatpak" ? "Flatpak" : choice.via === "appimage" ? "AppImage" : choice.name ?? id;
                    const choose = () => setSteps((current) => (step.do === "install_core"
                        ? chooseFixCore(current, index, choice.core ?? "")
                        : chooseFixVia(current, index, choice.via ?? "flatpak")));
                    return (
                        <FocusTarget key={id} focusKey={`fix:choice:${index}:${id}`}>
                            <DialogButton
                                onClick={choose}
                                onGamepadFocus={choose}
                                style={{ outline: chosen ? `2px solid ${achievementGreen}` : undefined, borderRadius: "4px", padding: "4px 10px" }}
                            >
                                {chosen ? "✔ " : ""}{label}{choice.recommended ? ` · ${t(language, "Recommended")}` : ""}
                            </DialogButton>
                        </FocusTarget>
                    );
                })}
            </Focusable>
        );
    }

    function renderProgress(shown: FixRun, row: FixRunStep, index: number) {
        const label = `${index + 1}. ${fixStepLabel(language, row.step)}`;
        const percent = row.step.do === "setup_streaming" ? stream.progress : row.progress;
        const checking = row.step.do === "pick_game_file" && pick?.state === "running" && pick.gameId === shown.gameId;
        return (
            <div key={index} style={{ marginBottom: "8px", opacity: row.state === "waiting" || row.state === "undone" ? 0.5 : 1 }}>
                <div style={{ fontSize: `${modalSize(15)}px`, color: row.state === "done" ? achievementGreen : undefined }}>
                    {row.state === "done" ? `✔ ${label}` : row.state === "undone" ? `${label} · ${t(language, "Undone")}` : label}
                </div>
                {row.state === "running" && (
                    <div style={{ marginTop: "4px" }}>
                        {checking && (
                            <div style={smallTextStyle()}>
                                {t(language, "Checking {{file}} with RetroAchievements...", { file: pick.fileName })}
                            </div>
                        )}
                        <ProgressBar fraction={percent >= 0 ? percent / 100 : null} />
                        {percent >= 0 && <div style={smallTextStyle()}>{`${percent}%`}</div>}
                        {checking && (
                            <div style={{ ...smallTextStyle(), marginTop: "6px" }}>
                                {t(language, "Big games, like GameCube and Wii discs, can take a few minutes. You can close this and keep going.")}
                            </div>
                        )}
                    </div>
                )}
                {(row.state === "failed" || row.state === "kept") && (
                    <div style={{ ...smallTextStyle(), color: errorRed, opacity: 1 }}>{rowFailure(language, shown, row)}</div>
                )}
            </div>
        );
    }

    function renderDone(shown: FixRun) {
        return shown.steps.filter((row) => row.state === "done").map((row, index) => (
            <Line key={index} color={achievementGreen}>{`✔ ${fixDoneLine(language, row.step)}`}</Line>
        ));
    }

    function renderOutcome(shown: FixRun) {
        const next = shown.next;
        const blocker = next?.plan.blocker ?? (next && next.state !== "ready" && next.gate
            ? { gate: next.gate, detail: next.detail } : null);
        return (
            <>
                {shown.kept && <Line>{t(language, "Kept yours. Fix It stopped here, and the steps before it stay done.")}</Line>}
                {shown.already && <Line>{t(language, "Already set up")}</Line>}
                {next?.state === "ready" && <Line color={achievementGreen}>{t(language, IS_READY[shown.target])}</Line>}
                {next?.state !== "ready" && blocker && (
                    <>
                        <Line>{t(language, "One thing is still needed:")}</Line>
                        <Line>{request.explain(blocker.gate, blocker.detail)}</Line>
                    </>
                )}
            </>
        );
    }

    function renderPlan() {
        if (plan.steps.length === 0) {
            return <Line>{answer.gate ? request.explain(answer.gate, answer.detail) : ""}</Line>;
        }
        return (
            <>
                {waiting && ended && renderDone(ended)}
                <Section label={t(language, "What's missing")}>
                    {missingLines(language, plan).map((line) => <Line key={line}>{line}</Line>)}
                    {picking && <ScanOrPickLines language={language} />}
                </Section>
                <Section label={t(language, "What Fix It will do")}>
                    <Focusable key={`fix:steps:${waiting ? ended?.startedAt : "first"}`} flow-children="column">
                        {steps.map((step, index) => (
                            <div key={index} style={{ marginBottom: "8px" }}>
                                <div style={{ fontSize: `${modalSize(15)}px` }}>{`${index + 1}. ${fixStepLabel(language, step)}`}</div>
                                {renderChoices(step, index)}
                            </div>
                        ))}
                    </Focusable>
                </Section>
                <Section label={t(language, "After this")}>
                    {plan.outcome === "ready" && <Line>{t(language, WILL_BE_READY[request.target])}</Line>}
                    {plan.outcome === "after_pick" && (
                        <Line>{t(language, "Fix It will check what else is needed once the file is found.")}</Line>
                    )}
                    {plan.outcome === "blocked" && plan.blocker && (
                        <>
                            <Line>{t(language, "After that, one thing is still needed:")}</Line>
                            <Line>{request.explain(plan.blocker.gate, plan.blocker.detail)}</Line>
                        </>
                    )}
                </Section>
            </>
        );
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px", display: "flex", alignItems: "center", gap: "10px" }}>
                <look.Icon style={{ color: look.color, flexShrink: 0 }} />
                {title}
            </div>
            {request.switchTo && request.target !== "play" && phase !== "running" && (
                <Focusable key="fix:modes" flow-children="row" style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
                    {MODES.map((mode) => (
                        <FocusTarget key={mode} focusKey={`fix:mode:${mode}`}>
                            <DialogButton
                                onClick={() => {
                                    if (mode !== request.target) {
                                        close();
                                        request.switchTo?.(mode);
                                    }
                                }}
                                style={{ outline: mode === request.target ? `2px solid ${achievementGreen}` : undefined, borderRadius: "4px",
                                    padding: "4px 10px", minWidth: 0 }}
                            >
                                {t(language, MODE_NAMES[mode])}
                            </DialogButton>
                        </FocusTarget>
                    ))}
                </Focusable>
            )}
            {live !== null ? (
                <div>
                    {live.running && (
                        <div style={{ ...smallTextStyle(), marginBottom: "8px" }}>
                            {t(language, "Step {{step}} of {{count}}", { step: live.current + 1, count: live.steps.length })}
                        </div>
                    )}
                    {live.steps.map((row, index) => renderProgress(live, row, index))}
                </div>
            ) : phase === "done" && ended !== null ? (
                <div>
                    {renderDone(ended)}
                    {renderOutcome(ended)}
                </div>
            ) : renderPlan()}
            <Focusable key={`fix:buttons:${phase}`} style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "16px" }}
                flow-children="column">
                {(phase === "running" || phase === "failed" || (phase === "ready" && plan.steps.length > 0)) && (
                    <FocusTarget focusKey="fix:run">
                        <DialogButton autoFocus={phase !== "running"} disabled={phase === "running"} onClick={start}>
                            {phase === "running" ? t(language, "Working...") : phase === "failed" ? t(language, "Try Again") : t(language, "Fix It")}
                        </DialogButton>
                    </FocusTarget>
                )}
                {phase === "ready" && picking && (
                    <FocusTarget focusKey="fix:scan">
                        <DialogButton
                            onClick={() => {
                                requestRoute({ kind: "cheevoCheck" });
                                close();
                            }}
                        >
                            {t(language, "Run Cheevo Check Scan")}
                        </DialogButton>
                    </FocusTarget>
                )}
                {phase === "ready" && request.forget && answer.detail.picked && (
                    <FocusTarget focusKey="fix:forget">
                        <DialogButton
                            onClick={() => {
                                close();
                                request.forget?.();
                            }}
                        >
                            {t(language, "Forget This File")}
                        </DialogButton>
                    </FocusTarget>
                )}
                {phase === "ready" && toggling && request.tools && (
                    <DesktopToolButtons language={language} tools={request.tools} close={close} />
                )}
                <FocusTarget focusKey="fix:close">
                    <DialogButton autoFocus={phase === "done" || phase === "running" || (phase === "ready" && plan.steps.length === 0)}
                        onClick={close}>
                        {t(language, "Close")}
                    </DialogButton>
                </FocusTarget>
            </Focusable>
        </ModalRoot>
    );
}

export function showFixIt(language: LanguageCode, request: FixItRequest) {
    showManagedModal((close) => <FixItModal language={language} request={request} close={close} />);
}

type FixItFor = {
    target: FixTarget;
    gameId: number;
    title: string;
    roomId?: string;
    switchable?: boolean;
    tools?: { emudeck?: boolean; srm?: boolean } | null;
};

type Fetched = { answer: FixAnswer; tools: { emudeck?: boolean; srm?: boolean } | null };

async function fetchFixAnswer(about: FixItFor): Promise<Fetched | null> {
    if (about.target === "play") {
        const info = await multiplayerPlayInfo(about.gameId, null);
        return info.plan && info.state
            ? { answer: { state: info.state, gate: info.gate, detail: info.detail ?? {}, plan: info.plan }, tools: info.tools ?? null }
            : null;
    }
    const checked = await multiplayerCheck(about.target, about.gameId, "", about.roomId ?? "");
    if (!checked.plan) {
        return null;
    }
    const state = checked.state ?? (checked.gate ? "setup" : "ready");
    return { answer: { state, gate: checked.gate, detail: checked.detail ?? {}, plan: checked.plan }, tools: about.tools ?? null };
}

export async function openFixIt(language: LanguageCode, about: FixItFor) {
    let fetched: Fetched | null = null;
    try {
        fetched = await fetchFixAnswer(about);
    }
    catch (e) {
        logError("fix it: couldn't ask what this game needs", e);
    }
    if (fetched === null) {
        return;
    }
    const refresh = async () => (await fetchFixAnswer(about))?.answer ?? null;
    showFixIt(language, {
        target: about.target,
        gameId: about.gameId,
        title: about.title,
        answer: fetched.answer,
        tools: fetched.tools,
        explain: (gate, detail) => gateText(language, about.target, gate, detail, Boolean(about.roomId)),
        refresh,
        forget: () => void forgetGameFile(about.gameId),
        switchTo: about.switchable ? (mode) => void openFixIt(language, { ...about, target: mode }) : undefined
    });
}
