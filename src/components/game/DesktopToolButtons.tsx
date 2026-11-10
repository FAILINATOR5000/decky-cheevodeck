import { DialogButton } from "@decky/ui";

import { multiplayerOpenInDesktop } from "../../api";
import { t, type LanguageCode } from "../../locales";
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

export function DesktopToolButtons(props: { language: LanguageCode; tools: { emudeck?: boolean; srm?: boolean }; close: () => void }) {
    const { language, close } = props;
    return (
        <>
            {toolsFound(props.tools).map((tool) => (
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
