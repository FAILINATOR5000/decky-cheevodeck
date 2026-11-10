import { useSlowWait } from "../../hooks/useSlowWait";
import { t, type LanguageCode } from "../../locales";
import { RUN_SETTLE_MS, type FixRun } from "../../utils/fixPlan";
import { bodyTextStyle, errorRed } from "../../utils/style";
import { ProgressBar } from "../ui/ProgressBar";
import { fixFailureText, fixStepLabel } from "./FixItModal";

export function FixRunLine(props: { language: LanguageCode; run: FixRun; streamProgress?: number }) {
    const { language, run } = props;
    const shown = useSlowWait(run.running, RUN_SETTLE_MS) || (run.running && Date.now() - run.startedAt >= RUN_SETTLE_MS);
    const row = run.running ? run.steps[run.current] ?? null : null;
    const progress = row === null ? -1 : row.step.do === "setup_streaming" ? props.streamProgress ?? -1 : row.progress;
    return (
        <div style={{ width: "100%", paddingTop: "4px" }}>
            {row !== null && shown && (
                <>
                    <div style={bodyTextStyle()}>{fixStepLabel(language, row.step)}</div>
                    <div style={{ marginTop: "6px" }}>
                        <ProgressBar fraction={progress >= 0 ? progress / 100 : null} />
                    </div>
                    <div style={{ ...bodyTextStyle(), marginTop: "6px" }}>
                        {t(language, "Step {{step}} of {{count}}", { step: run.current + 1, count: run.steps.length })}
                        {progress >= 0 ? ` · ${progress}%` : ""}
                    </div>
                </>
            )}
            {run.failed && (
                <div style={{ ...bodyTextStyle(), color: errorRed, opacity: 1 }}>{fixFailureText(language, run)}</div>
            )}
        </div>
    );
}
