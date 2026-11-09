import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useEffect, useState } from "react";

import { t, type LanguageCode } from "../../locales";
import type { FixStep, MultiplayerMode } from "../../types";
import { jobErrorText } from "../../utils/emulatorJobs";
import {
    chooseFixCore,
    chooseFixVia,
    runFixPlan,
    setFixWindowOpen,
    useFixPlan,
    type FixAnswer,
    type FixRunStep
} from "../../utils/fixPlan";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { useStreamSetup } from "../../utils/streamPlay";
import { achievementGreen, errorRed, smallTextStyle } from "../../utils/style";
import { DesktopToolButtons } from "../game/ShortcutNeededModal";
import { FocusTarget } from "../ui/FocusTarget";
import { ProgressBar } from "../ui/ProgressBar";
import { STATE_LOOKS } from "./ModeChart";
import { TITLES } from "./ModeReasonModal";

export type FixItReason = {
    mode: MultiplayerMode;
    gameId: number;
    state: "setup" | "never";
    text: string;
    steps: FixStep[];
    tools: { emudeck?: boolean; srm?: boolean } | null;
    refresh: () => Promise<FixAnswer>;
};

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
        case "setup_streaming":
            return t(language, "Set Up Streaming");
    }
}

function reasonLine(language: LanguageCode, step: FixStep): string {
    if (step.reason === "host_version") {
        const latest = step.choices?.find((choice) => choice.via === step.via)?.latest ?? "";
        return t(language, "Matches the host's {{emulator}} {{version}}", { emulator: step.name ?? "", version: latest });
    }
    if (step.do === "enable_shortcut_fallback") {
        return t(language, "Uses the emulator's own Steam shortcut, so the game doesn't need one");
    }
    if (step.reason === "game_shortcut") {
        return t(language, "Same install as this game's shortcut");
    }
    return "";
}

function failureLine(language: LanguageCode, row: FixRunStep): string {
    if (row.state === "kept") {
        return t(language, "Kept yours");
    }
    const why = jobErrorText(language, row.error, row.step.name ?? "", row.step.do.endsWith("_core"));
    return why ? `${why} ${t(language, "Nothing was changed.")}` : t(language, "Nothing was changed.");
}

function FixItModal(props: { language: LanguageCode; reason: FixItReason; close: () => void }) {
    const { language, reason, close } = props;
    const { run } = useFixPlan();
    const stream = useStreamSetup(true);
    const [steps, setSteps] = useState(reason.steps);
    const [openedAt] = useState(() => Date.now());
    const [followed, setFollowed] = useState(run?.running ? run.startedAt : 0);
    const look = STATE_LOOKS[reason.state];

    useEffect(() => {
        setFixWindowOpen(true);
        return () => setFixWindowOpen(false);
    }, []);

    useEffect(() => {
        if (run?.running) {
            setFollowed(run.startedAt);
        }
    }, [run?.running, run?.startedAt]);

    const ours = run !== null && run.mode === reason.mode && run.gameId === reason.gameId;
    const shown = run !== null && (run.running || (ours && run.failed)) ? run : null;
    const finished = run !== null && ours && run.done && !run.running
        && (run.startedAt >= openedAt || run.startedAt === followed);
    const phase = shown?.running ? "running" : shown?.failed ? "failed" : finished ? "done" : "ready";

    function start() {
        const picked = shown?.failed ? shown.steps.map((row) => row.step) : steps;
        void runFixPlan(shown?.failed ? shown.mode : reason.mode, shown?.failed ? shown.gameId : reason.gameId, picked,
            reason.refresh);
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
                    const picked = step.do === "install_core" ? choice.core === step.core : choice.via === step.via;
                    const label = choice.via === "flatpak" ? "Flatpak" : choice.via === "appimage" ? "AppImage" : choice.name ?? id;
                    const pick = () => setSteps((current) => (step.do === "install_core"
                        ? chooseFixCore(current, index, choice.core ?? "")
                        : chooseFixVia(current, index, choice.via ?? "flatpak")));
                    return (
                        <FocusTarget key={id} focusKey={`fix:choice:${index}:${id}`}>
                            <DialogButton
                                onClick={pick}
                                onGamepadFocus={pick}
                                style={{ outline: picked ? `2px solid ${achievementGreen}` : undefined, borderRadius: "4px", padding: "4px 10px" }}
                            >
                                {picked ? "✔ " : ""}{label}{choice.recommended ? ` · ${t(language, "Recommended")}` : ""}
                            </DialogButton>
                        </FocusTarget>
                    );
                })}
            </Focusable>
        );
    }

    function renderProgress(row: FixRunStep, index: number) {
        const label = `${index + 1}. ${fixStepLabel(language, row.step)}`;
        const percent = row.step.do === "setup_streaming" ? stream.progress : row.progress;
        return (
            <div key={index} style={{ marginBottom: "8px", opacity: row.state === "waiting" ? 0.5 : 1 }}>
                <div style={{ fontSize: `${modalSize(15)}px`, color: row.state === "done" ? achievementGreen : undefined }}>
                    {row.state === "done" ? `✔ ${label}` : label}
                </div>
                {row.state === "running" && (
                    <div style={{ marginTop: "4px" }}>
                        <ProgressBar fraction={percent >= 0 ? percent / 100 : null} />
                        {percent >= 0 && <div style={smallTextStyle()}>{`${percent}%`}</div>}
                    </div>
                )}
                {(row.state === "failed" || row.state === "kept") && (
                    <div style={{ ...smallTextStyle(), color: errorRed, opacity: 1 }}>{failureLine(language, row)}</div>
                )}
            </div>
        );
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px", display: "flex", alignItems: "center", gap: "10px" }}>
                <look.Icon style={{ color: look.color, flexShrink: 0 }} />
                {t(language, TITLES[reason.mode][reason.state])}
            </div>
            <div style={{ fontSize: `${modalSize(16)}px`, lineHeight: 1.4, whiteSpace: "pre-line", marginBottom: "12px" }}>
                {reason.text}
            </div>
            {shown !== null ? (
                <div>
                    {shown.running && (
                        <div style={{ ...smallTextStyle(), marginBottom: "8px" }}>
                            {t(language, "Step {{step}} of {{count}}", { step: shown.current + 1, count: shown.steps.length })}
                        </div>
                    )}
                    {shown.steps.map(renderProgress)}
                </div>
            ) : finished ? (
                <div style={{ fontSize: `${modalSize(16)}px`, color: achievementGreen }}>{t(language, "Done")}</div>
            ) : (
                <Focusable flow-children="column">
                    {steps.map((step, index) => (
                        <div key={index} style={{ marginBottom: "8px" }}>
                            <div style={{ fontSize: `${modalSize(15)}px` }}>{`${index + 1}. ${fixStepLabel(language, step)}`}</div>
                            {renderChoices(step, index)}
                        </div>
                    ))}
                </Focusable>
            )}
            <Focusable key={`fix:buttons:${phase}`} style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "16px" }}
                flow-children="column">
                {phase !== "done" && (
                    <FocusTarget focusKey="fix:run">
                        <DialogButton autoFocus={phase !== "running"} disabled={phase === "running"} onClick={start}>
                            {phase === "running" ? t(language, "Working...") : phase === "failed" ? t(language, "Try Again") : t(language, "Fix It")}
                        </DialogButton>
                    </FocusTarget>
                )}
                {phase === "ready" && reason.tools && <DesktopToolButtons language={language} tools={reason.tools} close={close} />}
                <FocusTarget focusKey="fix:close">
                    <DialogButton autoFocus={phase === "done" || phase === "running"} onClick={close}>{t(language, "Close")}</DialogButton>
                </FocusTarget>
            </Focusable>
        </ModalRoot>
    );
}

export function showFixIt(language: LanguageCode, reason: FixItReason) {
    showManagedModal((close) => <FixItModal language={language} reason={reason} close={close} />);
}
