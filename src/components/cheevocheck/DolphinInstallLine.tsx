import { useEffect, useState, type CSSProperties } from "react";

import { installEmulatorFlatpak } from "../../hooks/useEmulatorsController";
import { t, type LanguageCode } from "../../locales";
import { jobErrorText, useEmulatorJobs } from "../../utils/emulatorJobs";
import { errorRed, warnAmber } from "../../utils/style";
import { ButtonPrompt } from "../ui/ButtonPrompt";
import { FocusableItem } from "../ui/FocusableItem";
import { ProgressBar } from "../ui/ProgressBar";

const DOLPHIN_TARGET = "emulators:row:dolphin:flatpak";

type DolphinInstallLineProps = {
    language: LanguageCode;
    installed: boolean;
    focusKey: string;
    focusFallback: string[];
    textStyle: CSSProperties;
    promptSize: number;
    autoFocus?: boolean;
    onInstalled: () => void;
};

export function DolphinInstallLine(props: DolphinInstallLineProps) {
    const { language, installed, focusKey, focusFallback, textStyle, promptSize, autoFocus, onInstalled } = props;
    const jobs = useEmulatorJobs();
    const job = jobs.active.find((state) => state.target === DOLPHIN_TARGET) ?? null;
    const [watched, setWatched] = useState<string | null>(null);
    const [error, setError] = useState("");
    const ended = watched !== null && jobs.state?.job === watched ? jobs.state : null;
    const done = ended?.stage === "done";

    useEffect(() => {
        if (job && job.job !== watched) {
            setWatched(job.job);
            setError("");
        }
    }, [job?.job]);

    useEffect(() => {
        if (ended?.stage === "done") {
            onInstalled();
        }
        else if (ended?.stage === "failed") {
            setError(ended.error);
        }
    }, [ended?.stage]);

    if (installed || done) {
        return null;
    }

    const progress = job ? Math.max(0, job.progress) : 0;
    const failure = error ? jobErrorText(language, error, "Dolphin", false) : "";
    return (
        <FocusableItem
            focusKey={focusKey}
            focusFallback={focusFallback}
            autoFocus={autoFocus}
            outerStyle={{ width: "100%", minWidth: 0 }}
            onClick={() => {
                if (!job) {
                    void installEmulatorFlatpak(language, "dolphin", "Dolphin", DOLPHIN_TARGET);
                }
            }}
            bottomSeparator="none"
        >
            {job ? (
                <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "6px", textAlign: "left" }}>
                    <ProgressBar fraction={progress / 100} />
                    <div style={textStyle}>{t(language, "Installing… {{percent}}%", { percent: progress })}</div>
                </div>
            ) : (
                <div style={{ width: "100%", textAlign: "left" }}>
                    <div style={{ ...textStyle, color: warnAmber, opacity: 1 }}>{t(language, "cheevo_check_dolphin_install")}</div>
                    {failure && <div style={{ ...textStyle, color: errorRed, opacity: 1, marginTop: "4px" }}>{failure}</div>}
                    <div style={{ ...textStyle, lineHeight: 1, marginTop: "6px" }}>
                        <ButtonPrompt language={language} textKey="{{button}} Install" button="a" fontSize={promptSize} inline />
                    </div>
                </div>
            )}
        </FocusableItem>
    );
}
