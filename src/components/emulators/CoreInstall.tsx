import { useEffect, useState } from "react";

import { emulatorsInstallCores } from "../../api";
import { t, type LanguageCode } from "../../locales";
import { jobErrorText, useEmulatorJobProgress, useEmulatorJobsFinished, watchEmulatorJob } from "../../utils/emulatorJobs";
import { logError } from "../../utils/errors";
import { modalBodyStyle, warnAmber } from "../../utils/style";
import { ButtonPrompt } from "../ui/ButtonPrompt";
import { ProgressBar } from "../ui/ProgressBar";

type CoreInstallState = { running: boolean; progress: number; failed: boolean; error: string };

const JOB_TARGET = "core-list";

const startedJobs = new Map<string, string>();

export function useCoreInstalls(onInstalled: (core: string) => void) {
    const [own, setStates] = useState<Record<string, CoreInstallState>>({});
    const tracked = [...startedJobs];
    const progress = useEmulatorJobProgress(tracked.map(([, job]) => job)).split(",");
    const finished = useEmulatorJobsFinished();

    const states: Record<string, CoreInstallState> = { ...own };
    tracked.forEach(([core], at) => {
        if (progress[at] && !own[core]) {
            states[core] = { running: true, progress: Number(progress[at]), failed: false, error: "" };
        }
    });

    useEffect(() => {
        tracked.forEach(([core], at) => {
            if (!progress[at]) {
                startedJobs.delete(core);
                if (!own[core]) {
                    onInstalled(core);
                }
            }
        });
    }, [finished]);

    function set(core: string, state: CoreInstallState) {
        setStates((was) => ({ ...was, [core]: state }));
    }

    async function install(core: string) {
        if (states[core]?.running) {
            return;
        }
        set(core, { running: true, progress: -1, failed: false, error: "" });
        try {
            const started = await emulatorsInstallCores([core], JOB_TARGET);
            if (!started.ok || !started.job) {
                set(core, { running: false, progress: -1, failed: true, error: started.error ?? "" });
                return;
            }
            startedJobs.set(core, started.job);
            const ended = await watchEmulatorJob(started.job, (state) => {
                set(core, { running: true, progress: state.progress, failed: false, error: "" });
            });
            if (ended.stage === "done") {
                set(core, { running: false, progress: 100, failed: false, error: "" });
                onInstalled(core);
                return;
            }
            set(core, { running: false, progress: -1, failed: true, error: ended.error });
        }
        catch (e) {
            logError("core lists: installing a core", e);
            set(core, { running: false, progress: -1, failed: true, error: "" });
        }
    }

    return { states, install };
}

type CoreInstallLineProps = {
    language: LanguageCode;
    state: CoreInstallState | undefined;
    fontSize: number;
};

export function CoreInstallLine(props: CoreInstallLineProps) {
    const { language, state, fontSize } = props;
    const style = { ...modalBodyStyle(), fontSize: `${fontSize}px` };
    if (state?.running) {
        const percent = Math.max(0, state.progress);
        return (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px", width: "100%" }}>
                <ProgressBar fraction={state.progress >= 0 ? state.progress / 100 : null} />
                <div style={style}>{t(language, "Installing… {{percent}}%", { percent })}</div>
            </div>
        );
    }
    if (state?.failed) {
        const reason = jobErrorText(language, state.error, "", true);
        return (
            <div style={{ ...style, color: warnAmber, opacity: 1 }}>
                <ButtonPrompt
                    language={language}
                    textKey="Couldn't install it. Press {{button}} to try again."
                    button="a"
                    fontSize={fontSize}
                    inline
                />
                {reason && <div>{reason}</div>}
            </div>
        );
    }
    return (
        <div style={style}>
            <ButtonPrompt language={language} textKey="Press {{button}} to install" button="a" fontSize={fontSize} inline />
        </div>
    );
}
