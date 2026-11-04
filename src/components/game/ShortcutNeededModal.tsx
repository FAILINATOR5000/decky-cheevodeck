import { DialogButton, Focusable, ModalRoot } from "@decky/ui";

import { multiplayerOpenInDesktop } from "../../api";
import { t, type LanguageCode } from "../../locales";
import { logError } from "../../utils/errors";
import { showManagedModal } from "../../utils/modalRegistry";
import { showMultiplayerProblem } from "../multiplayer/ProblemModal";
import { anyGameRunning } from "../../utils/multiplayerSession";
import { requestPanelEntry } from "../../utils/pendingPanelEntry";
import { modalSize } from "../../utils/scale";

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

function ShortcutNeededModal(props: {
    language: LanguageCode;
    tools: DesktopTool[];
    close: () => void;
}) {
    const { language, close } = props;
    const paragraph = { fontSize: `${modalSize(16)}px`, lineHeight: 1.4, marginBottom: "10px" };
    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <Focusable onActivate={() => { }} noFocusRing={true}>
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                    {t(language, "Shortcut Needed")}
                </div>
                <div style={paragraph}>{t(language, "play_shortcut_needed_body")}</div>
                <div style={paragraph}>{t(language, "play_shortcut_needed_emulators")}</div>
            </Focusable>
            <Focusable style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }} flow-children="column">
                <DialogButton
                    onClick={() => {
                        requestPanelEntry({ kind: "cheevoCheck" });
                        close();
                    }}
                >
                    {t(language, "Run Cheevo Check Scan")}
                </DialogButton>
                {props.tools.map((tool) => (
                    <DialogButton
                        key={tool}
                        onClick={() => {
                            close();
                            openInDesktop(language, tool);
                        }}
                    >
                        {t(language, TOOL_LABELS[tool])}
                    </DialogButton>
                ))}
                <DialogButton onClick={close}>{t(language, "Close")}</DialogButton>
            </Focusable>
        </ModalRoot>
    );
}

export function showShortcutNeeded(language: LanguageCode, tools: { emudeck?: boolean; srm?: boolean }) {
    const found: DesktopTool[] = tools.emudeck ? ["emudeck"] : tools.srm ? ["srm"] : [];
    showManagedModal((close) => <ShortcutNeededModal language={language} tools={found} close={close} />);
}
