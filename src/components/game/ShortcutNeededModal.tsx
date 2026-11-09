import { DialogButton, Focusable, ModalRoot } from "@decky/ui";

import { multiplayerOpenInDesktop } from "../../api";
import { t, type LanguageCode } from "../../locales";
import { logError } from "../../utils/errors";
import { showManagedModal } from "../../utils/modalRegistry";
import { showGameFile } from "../multiplayer/GameFileModal";
import { ScanOrPickLines } from "../multiplayer/ScanOrPickLines";
import { showMultiplayerProblem } from "../multiplayer/ProblemModal";
import { pickGameFile } from "../../utils/gameFilePick";
import { anyGameRunning } from "../../utils/multiplayerSession";
import { requestRoute } from "../../utils/pendingPanelEntry";
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

function toolsFound(tools: { emudeck?: boolean; srm?: boolean }): DesktopTool[] {
    return tools.emudeck ? ["emudeck"] : tools.srm ? ["srm"] : [];
}

export function DesktopToolButtons(props: { language: LanguageCode; tools: { emudeck?: boolean; srm?: boolean }; close: () => void }) {
    const { language, close } = props;
    return (
        <>
            {toolsFound(props.tools).map((tool) => (
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
        </>
    );
}

function ShortcutNeededModal(props: {
    language: LanguageCode;
    tools: { emudeck?: boolean; srm?: boolean };
    host: boolean;
    pick: GameToPick | null;
    close: () => void;
}) {
    const { language, close, pick } = props;
    const paragraph = { fontSize: `${modalSize(16)}px`, lineHeight: 1.4, marginBottom: "10px" };
    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <Focusable onActivate={() => { }} noFocusRing={true}>
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                    {t(language, pick ? "Game Not Found Yet" : "Shortcut Needed")}
                </div>
                {pick ? (
                    <>
                        <div style={paragraph}>
                            {t(language, "CheevoDeck needs to know which of your files is this game before it can launch it.")}
                        </div>
                        <ScanOrPickLines language={language} />
                    </>
                ) : (
                    <>
                        <div style={paragraph}>{t(language, "play_shortcut_needed_body")}</div>
                        <div style={paragraph}>{t(language, props.host ? "host_shortcut_needed_emulators" : "play_shortcut_needed_emulators")}</div>
                    </>
                )}
            </Focusable>
            <Focusable style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }} flow-children="column">
                {pick && (
                    <>
                        <DialogButton
                            onClick={() => {
                                requestRoute({ kind: "cheevoCheck" });
                                close();
                            }}
                        >
                            {t(language, "Run Cheevo Check Scan")}
                        </DialogButton>
                        <DialogButton
                            onClick={() => {
                                close();
                                startPick(language, pick);
                            }}
                        >
                            {t(language, "Pick the Game's File")}
                        </DialogButton>
                    </>
                )}
                {!pick && <DesktopToolButtons language={language} tools={props.tools} close={close} />}
                <DialogButton onClick={close}>{t(language, "Close")}</DialogButton>
            </Focusable>
        </ModalRoot>
    );
}

type GameToPick = { gameId: number; title: string };

function startPick(language: LanguageCode, pick: GameToPick) {
    void pickGameFile(language, pick.gameId, pick.title, () => showGameFile(language, () => startPick(language, pick)));
}

export function showShortcutNeeded(language: LanguageCode, tools: { emudeck?: boolean; srm?: boolean }, host = false,
    pick: GameToPick | null = null) {
    showManagedModal((close) => <ShortcutNeededModal language={language} tools={tools} host={host} pick={pick} close={close} />);
}
