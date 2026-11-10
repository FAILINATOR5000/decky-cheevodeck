import { DialogButton } from "@decky/ui";
import { useState } from "react";

import { emulatorsInstallTool, multiplayerOpenInDesktop } from "../../api";
import { t, type LanguageCode } from "../../locales";
import { jobErrorText, watchEmulatorJob } from "../../utils/emulatorJobs";
import { logError } from "../../utils/errors";
import { anyGameRunning } from "../../utils/multiplayerSession";
import { FocusTarget } from "../ui/FocusTarget";
import { showMultiplayerProblem } from "../multiplayer/ProblemModal";

type DesktopTool = "emudeck" | "srm";

const TOOL_LABELS: Record<DesktopTool, string> = {
    emudeck: "Open EmuDeck in Desktop Mode",
    srm: "Open Steam ROM Manager in Desktop Mode"
};

function openInDesktop(language: LanguageCode, tool: DesktopTool) {
    if (anyGameRunning()) {
        showMultiplayerProblem(language, "Another Game Is Running", t(language, "Close the running game first"));
        return;
    }
    multiplayerOpenInDesktop(tool)
        .then((result) => {
            if (!result.ok) {
                showMultiplayerProblem(language, "Couldn't Switch to Desktop Mode",
                    t(language, "Switch to Desktop Mode from Steam's power menu instead."));
            }
        })
        .catch((e) => logError("play: the switch to Desktop Mode threw", e));
}

function toolsFound(tools: { emudeck?: boolean; srm?: boolean }): DesktopTool[] {
    return tools.emudeck ? ["emudeck"] : tools.srm ? ["srm"] : [];
}

type SrmInstall = { state: "idle" | "working" | "failed" | "done"; progress: number; error: string };

export function DesktopToolButtons(props: {
    language: LanguageCode;
    tools: { emudeck?: boolean; srm?: boolean };
    offerInstall?: boolean;
    close: () => void;
}) {
    const { language, close } = props;
    const [install, setInstall] = useState<SrmInstall>({ state: "idle", progress: -1, error: "" });
    const found = toolsFound(install.state === "done" ? { srm: true } : props.tools);

    async function installSrm() {
        if (install.state === "working") {
            return;
        }
        setInstall({ state: "working", progress: -1, error: "" });
        try {
            const started = await emulatorsInstallTool("srm", "fixit:srm");
            if (!started?.ok || !started.job) {
                setInstall({ state: "failed", progress: -1, error: started?.error ?? "" });
                return;
            }
            const end = await watchEmulatorJob(started.job, (state) => {
                setInstall({ state: "working", progress: state.progress, error: "" });
            });
            setInstall(end.stage === "done"
                ? { state: "done", progress: 100, error: "" }
                : { state: "failed", progress: -1, error: end.error });
        }
        catch (e) {
            logError("emulators: installing Steam ROM Manager", e);
            setInstall({ state: "failed", progress: -1, error: "" });
        }
    }

    if (found.length === 0 && props.offerInstall) {
        const label = install.state === "working"
            ? `${t(language, "Installing Steam ROM Manager...")}${install.progress >= 0 ? ` ${install.progress}%` : ""}`
            : t(language, "Install Steam ROM Manager");
        return (
            <>
                <FocusTarget focusKey="desktop:srm:install">
                    <DialogButton onClick={() => void installSrm()}>{label}</DialogButton>
                </FocusTarget>
                {install.state === "failed" && (
                    <div style={{ opacity: 0.8 }}>
                        {[t(language, "Couldn't install Steam ROM Manager."), jobErrorText(language, install.error, "", false)]
                            .filter(Boolean).join(" ")}
                    </div>
                )}
            </>
        );
    }
    return (
        <>
            {found.map((tool) => (
                <FocusTarget key={tool} focusKey={`desktop:${tool}`}>
                    <DialogButton
                        onClick={() => {
                            close();
                            openInDesktop(language, tool);
                        }}
                    >
                        {t(language, TOOL_LABELS[tool])}
                    </DialogButton>
                </FocusTarget>
            ))}
        </>
    );
}
