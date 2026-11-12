import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useEffect, useState, type ReactNode } from "react";

import { multiplayerCheck, multiplayerPlayInfo } from "../../api";
import { useSlowWait } from "../../hooks/useSlowWait";
import { t, type LanguageCode } from "../../locales";
import type { FixPlan, FixStep, MultiplayerMode } from "../../types";
import { jobErrorText } from "../../utils/emulatorJobs";
import { logError } from "../../utils/errors";
import {
    chooseFixCore,
    chooseFixVia,
    HOST_GATES,
    RUN_SETTLE_MS,
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
import { HeadingStop } from "../ui/HeadingStop";
import { ProgressBar } from "../ui/ProgressBar";
import { STATE_LOOKS } from "./ModeChart";
import { showMultiplayerProblem } from "./ProblemModal";

export type FixItRequest = {
    target: FixTarget;
    gameId: number;
    title: string;
    answer: FixAnswer;
    tools: { emudeck?: boolean; srm?: boolean } | null;
    explain: (gate: string, detail: Record<string, string>) => string;
    refresh: () => Promise<FixAnswer | null>;
    forget?: () => Promise<void>;
    host?: boolean;
};

const MODE_NAMES: Record<MultiplayerMode, string> = { link: "Link Play", couch: "Couch Play", stream: "Stream Play" };

const TITLES: Record<MultiplayerMode, Record<"setup" | "never" | "failed", string>> = {
    link: { setup: "Link Play: Needs setup", never: "Link Play: Won't work", failed: "Link Play: Couldn't finish setup" },
    couch: { setup: "Couch Play: Needs setup", never: "Couch Play: Won't work", failed: "Couch Play: Couldn't finish setup" },
    stream: { setup: "Stream Play: Needs setup", never: "Stream Play: Won't work", failed: "Stream Play: Couldn't finish setup" }
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
        case "add_dolphin_folder":
            return t(language, "Add the Game's Folder to Dolphin");
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
        case "add_dolphin_folder":
            return t(language, "The game's folder was added to Dolphin.");
        case "pick_game_file":
            return t(language, "The game's file was found.");
    }
}

function missingLine(language: LanguageCode, step: FixStep, gate: string, detail: Record<string, string>, game: string): string {
    const name = step.name ?? "";
    switch (step.do) {
        case "enable_shortcut_fallback":
        case "enable_play_shortcut_fallback":
            return t(language, "There is no non-Steam shortcut for {{name}}", { name: game });
        case "install_emulator":
            if (step.reason === "dolphin_tool") {
                return t(language, "Dolphin's Flatpak isn't installed. Cheevo Check needs it to read GameCube and Wii files, even when you play with Dolphin's AppImage.");
            }
            return step.reason === "missing"
                ? t(language, "{{emulator}} isn't installed anymore, but its non-Steam shortcut is still there", { emulator: name })
                : t(language, "{{emulator}} isn't installed", { emulator: name });
        case "add_to_steam":
            return t(language, "There is no non-Steam shortcut for {{name}}", { name });
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
        case "add_dolphin_folder":
            return t(language, "Dolphin's NetPlay offers games from folders you point Dolphin to look in. This folder isn't added yet.");
        case "pick_game_file":
            if (gate === "rom_missing") {
                return detail.picked
                    ? t(language, "The file picked for this game changed or moved")
                    : t(language, "This game's file isn't where Cheevo Check last saw it");
            }
            return t(language, "CheevoDeck doesn't know which file is this game yet");
    }
}

function missingLines(language: LanguageCode, plan: FixPlan, game: string): string[] {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const stage of plan.stages) {
        for (const step of stage.steps) {
            if (step.do === "pick_game_file" && step.path) {
                continue;
            }
            const key = `${step.do}:${step.kind ?? step.core ?? ""}`;
            if (!seen.has(key)) {
                seen.add(key);
                lines.push(missingLine(language, step, stage.gate, stage.detail, game));
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
        return t(language, "Uses the emulator's own non-Steam shortcut, so the game doesn't need one");
    }
    if (step.reason === "game_shortcut") {
        return t(language, "Same install as this game's shortcut");
    }
    if (step.reason === "missing") {
        return t(language, "Its non-Steam shortcut is still there, so it isn't added again");
    }
    return "";
}

function pickFailure(language: LanguageCode, run: FixRun, row: FixRunStep): string {
    return gameFilePickFailure(language, { gameId: run.gameId, title: run.title, fileName: "", state: "failed",
        error: row.error, label: "" });
}

function failureReason(language: LanguageCode, run: FixRun, row: FixRunStep | undefined): string {
    if (row?.step.do === "pick_game_file") {
        return pickFailure(language, run, row);
    }
    const why = row
        ? jobErrorText(language, row.error, row.step.name ?? "", row.step.do.endsWith("_core"))
        : jobErrorText(language, run.error, "", false);
    return why || t(language, "Something went wrong, so Fix It stopped.");
}

function leftBehind(language: LanguageCode, run: FixRun): string {
    return run.left.length > 0 ? t(language, "Some of it couldn't be undone: {{items}}", { items: run.left.join(", ") }) : "";
}

export function fixFailureText(language: LanguageCode, run: FixRun): string {
    const row = run.steps.find((other) => other.state === "failed");
    return [failureReason(language, run, row), leftBehind(language, run)].filter(Boolean).join(" ");
}

function Section(props: { focusKey: string; label: string; children: ReactNode }) {
    return (
        <div style={{ marginBottom: "14px" }}>
            <HeadingStop focusKey={props.focusKey} style={{ fontSize: `${modalSize(15)}px`, fontWeight: 700 }}
                outerStyle={{ marginBottom: "6px" }}>
                {props.label}
            </HeadingStop>
            {props.children}
        </div>
    );
}

function Bullet(props: { children: ReactNode }) {
    return (
        <div style={{ display: "flex", gap: "8px", fontSize: `${modalSize(15)}px`, lineHeight: 1.4, marginBottom: "6px", paddingLeft: "4px" }}>
            <span style={{ flexShrink: 0 }}>•</span>
            <span>{props.children}</span>
        </div>
    );
}

function Item(props: { children: ReactNode }) {
    return (
        <div style={{ fontSize: `${modalSize(15)}px`, lineHeight: 1.4, marginBottom: "4px", paddingLeft: "4px" }}>{props.children}</div>
    );
}

function Intro(props: { lines: string[]; children: ReactNode }) {
    return (
        <div style={{ marginBottom: "16px" }}>
            {props.lines.map((line) => (
                <div key={line} style={{ fontSize: `${modalSize(16)}px`, lineHeight: 1.4, marginBottom: "10px" }}>{line}</div>
            ))}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>{props.children}</div>
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

    const ours = run !== null && run.target === request.target && run.gameId === request.gameId
        && (run.running || run.startedAt >= openedAt || run.startedAt === followed);
    const live = run !== null && (run.running || (ours && run.failed)) ? run : null;
    const ended = run !== null && ours && run.done && !run.running ? run : null;
    const waiting = ended?.next && ended.next.state !== "ready" && ended.next.plan.steps.length > 0 ? ended.next : null;
    const answer = waiting ?? request.answer;
    const plan = answer.plan;
    const settled = useSlowWait(live?.running === true, RUN_SETTLE_MS)
        || (live?.running === true && Date.now() - live.startedAt >= RUN_SETTLE_MS);
    const phase = live?.running && settled ? "running" : live?.failed ? "failed" : ended && !waiting ? "done" : "ready";
    const briefing = phase === "ready" && plan.steps.length > 0;
    const [chosen, setChosen] = useState({ plan, steps: plan.steps });
    const steps = chosen.plan === plan ? chosen.steps : plan.steps;
    const setSteps = (change: (current: FixStep[]) => FixStep[]) => setChosen({ plan, steps: change(steps) });

    const after = ended?.next ?? null;
    const state = phase === "done" ? after?.state === "ready" ? "ready" : after?.state === "never" ? "never" : "setup" : answer.state;
    const look = STATE_LOOKS[phase === "failed" ? "never" : state];
    const title = request.target === "play" ? request.title
        : request.host ? t(language, phase === "failed" ? "Host: Couldn't finish setup" : state === "ready" ? "Host" : "Host: Needs setup")
        : phase === "failed" ? t(language, TITLES[request.target].failed)
        : state === "ready" ? t(language, MODE_NAMES[request.target]) : t(language, TITLES[request.target][state]);
    const picking = plan.steps.some((step) => step.do === "pick_game_file" && !step.path);
    const heldFile = phase === "ready" && plan.steps.some((step) => step.do === "pick_game_file" && step.path);
    const needsDolphin = heldFile && ended?.refused === true;
    const fileMoved = plan.stages.some((stage) => stage.gate === "rom_missing" && !stage.detail.picked);
    const shortcutless = !picking && plan.steps.some((step) => SHORTCUT_TOGGLES.includes(step.do) || step.do === "add_to_steam");
    const noPlanForShortcut = plan.steps.length === 0 && (answer.gate === "no_shortcut" || answer.gate === "no_emulator_shortcut");

    function pickAnother() {
        void runFixPlan(request.target, request.gameId, request.title, steps, request.refresh,
            () => showFixIt(language, request), true);
    }

    function start() {
        void runFixPlan(request.target, request.gameId, request.title, steps, request.refresh,
            () => showFixIt(language, request));
    }

    const scanButton = (
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
    );

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
            <div key={index} style={{ marginBottom: "8px", opacity: row.state === "waiting" ? 0.5 : 1 }}>
                <div style={{ fontSize: `${modalSize(15)}px`, color: row.state === "done" ? achievementGreen : undefined }}>
                    {row.state === "done" ? `✔ ${label}` : label}
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
                {row.state === "kept" && (
                    <div style={{ ...smallTextStyle(), opacity: 1 }}>
                        {t(language, "Kept yours. Fix It stopped here, and the steps before it stay done.")}
                    </div>
                )}
            </div>
        );
    }

    function renderDone(shown: FixRun) {
        return shown.steps.filter((row) => row.state === "done").map((row, index) => (
            <Line key={index} color={achievementGreen}>{`✔ ${fixDoneLine(language, row.step)}`}</Line>
        ));
    }

    function renderFailure(shown: FixRun) {
        const row = shown.steps.find((other) => other.state === "failed");
        const left = leftBehind(language, shown);
        return (
            <>
                {row && <Line>{`✕ ${fixStepLabel(language, row.step)}`}</Line>}
                <Line>{failureReason(language, shown, row)}</Line>
                {left && <Line color={errorRed}>{left}</Line>}
            </>
        );
    }

    function renderOutcome(shown: FixRun) {
        const next = shown.next;
        const blocker = next?.plan.blocker ?? (next && next.state !== "ready" && next.gate
            ? { gate: next.gate, detail: next.detail } : null);
        return (
            <>
                {!shown.already && shown.steps.map((row, index) => renderProgress(shown, row, index))}
                {shown.already && <Line>{t(language, "Already set up")}</Line>}
                {next?.state === "ready" && <Line color={achievementGreen}>{t(language, request.host ? "Host is ready." : IS_READY[shown.target])}</Line>}
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
            if (answer.state === "ready" || !answer.gate) {
                return <Line color={achievementGreen}>{t(language, request.host ? "Host is ready." : IS_READY[request.target])}</Line>;
            }
            return <Line>{request.explain(answer.gate, answer.detail)}</Line>;
        }
        return (
            <>
                {waiting && ended && renderDone(ended)}
                {waiting && ended?.kept && (
                    <Line>{t(language, "Kept yours. Fix It stopped here, and the steps before it stay done.")}</Line>
                )}
                {picking && (
                    <Intro lines={fileMoved ? [
                        t(language, "The file for this game might have been moved or deleted since the last Cheevo Check scan. It's recommended to rescan your library whenever you make changes to ROM names, folders, etc."),
                        t(language, "Don't want to run a scan now? Try the “Fix It” feature below that will scan just this game only.")
                    ] : [
                        t(language, "For the smoothest experience, run a Cheevo Check scan once on your whole library. It tells CheevoDeck which game each file is."),
                        t(language, "Rather not? The “Fix It” feature below checks just this game's file instead.")
                    ]}>
                        {scanButton}
                    </Intro>
                )}
                {shortcutless && (
                    <Intro lines={[
                        t(language, "For the smoothest experience, add your games to Steam as non-Steam shortcuts with Steam ROM Manager, which bulk adds your games at once. At the least, add your emulators as non-Steam shortcuts, which allows CheevoDeck to launch your games through them."),
                        t(language, "Rather not? The “Fix It” feature below takes a quicker route to get you up and running right now.")
                    ]}>
                        {request.tools && <DesktopToolButtons language={language} tools={request.tools} offerInstall close={close} />}
                    </Intro>
                )}
                <Section focusKey="fix:section:missing" label={t(language, "What's missing")}>
                    {missingLines(language, plan, request.title).map((line) => <Bullet key={line}>{line}</Bullet>)}
                </Section>
                <Section focusKey="fix:section:steps" label={t(language, "What the “Fix It” button below will do")}>
                    <Focusable key={`fix:steps:${waiting ? ended?.startedAt : "first"}`} flow-children="column">
                        {steps.map((step, index) => (
                            <div key={index} style={{ marginBottom: "8px", paddingLeft: "4px" }}>
                                <div style={{ fontSize: `${modalSize(15)}px` }}>{`${index + 1}. ${fixStepLabel(language, step)}`}</div>
                                {renderChoices(step, index)}
                            </div>
                        ))}
                    </Focusable>
                </Section>
                <Section focusKey="fix:section:after" label={t(language, "After this")}>
                    {plan.outcome === "ready" && <Item>{t(language, request.host ? "Host will be ready." : WILL_BE_READY[request.target])}</Item>}
                    {plan.outcome === "after_pick" && (
                        <Item>{t(language, "Fix It will check what else is needed once the file is found.")}</Item>
                    )}
                    {plan.outcome === "blocked" && plan.blocker && (
                        <>
                            <Item>{t(language, "After that, one thing is still needed:")}</Item>
                            <Item>{request.explain(plan.blocker.gate, plan.blocker.detail)}</Item>
                        </>
                    )}
                </Section>
            </>
        );
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <HeadingStop focusKey="fix:title" autoFocus={briefing} outerStyle={{ marginBottom: "12px" }}
                style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, display: "flex", alignItems: "center", gap: "10px" }}>
                <look.Icon style={{ color: look.color, flexShrink: 0 }} />
                {title}
            </HeadingStop>
            {needsDolphin && (
                <Line color={errorRed}>{t(language, "Scan failed because you do not have Dolphin's Flatpak. New fix plan proposed.")}</Line>
            )}
            {phase === "running" && live ? (
                <div>
                    <div style={{ ...smallTextStyle(), marginBottom: "8px" }}>
                        {t(language, "Step {{step}} of {{count}}", { step: live.current + 1, count: live.steps.length })}
                    </div>
                    {live.steps.map((row, index) => renderProgress(live, row, index))}
                </div>
            ) : live?.failed ? (
                <div>{renderFailure(live)}</div>
            ) : phase === "done" && ended !== null ? (
                <div>{renderOutcome(ended)}</div>
            ) : renderPlan()}
            <Focusable key={`fix:buttons:${phase}`} style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "16px" }}
                flow-children="column">
                {(phase === "running" || (phase === "ready" && plan.steps.length > 0)) && (
                    <FocusTarget focusKey="fix:run">
                        <DialogButton disabled={phase === "running"} onClick={start}>
                            {phase === "running" ? t(language, "Working...") : t(language, "Fix It")}
                        </DialogButton>
                    </FocusTarget>
                )}
                {heldFile && request.forget && (
                    <FocusTarget focusKey="fix:repick">
                        <DialogButton onClick={pickAnother}>
                            {t(language, "Pick a Different File")}
                        </DialogButton>
                    </FocusTarget>
                )}
                {phase === "ready" && request.forget && answer.detail.picked && (
                    <FocusTarget focusKey="fix:forget">
                        <DialogButton
                            onClick={() => {
                                close();
                                void request.forget?.();
                            }}
                        >
                            {t(language, "Forget This File")}
                        </DialogButton>
                    </FocusTarget>
                )}
                {phase === "ready" && noPlanForShortcut && request.tools && (
                    <DesktopToolButtons language={language} tools={request.tools} close={close} />
                )}
                <FocusTarget focusKey="fix:close">
                    <DialogButton autoFocus={phase !== "ready" || plan.steps.length === 0} onClick={close}>
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
    host?: boolean;
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
    const answer: FixAnswer = { state, gate: checked.gate, detail: checked.detail ?? {}, plan: checked.plan };
    return { answer: about.host ? hostAnswer(answer) : answer, tools: about.tools ?? null };
}

function hostAnswer(answer: FixAnswer): FixAnswer {
    const first = answer.plan.stages[0];
    if (!answer.gate || !HOST_GATES.includes(answer.gate) || !first) {
        return { state: "ready", gate: null, detail: {}, plan: { outcome: "ready", stages: [], steps: [], blocker: null } };
    }
    const picking = first.steps.some((step) => step.do === "pick_game_file");
    return { ...answer, plan: { outcome: picking ? "after_pick" : "ready", stages: [first], steps: first.steps, blocker: null } };
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
        showMultiplayerProblem(language, "Fix It", t(language, "Couldn't check what this game needs. Try again."), true);
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
        forget: () => forgetGameFile(about.gameId),
        host: about.host
    });
}
