import { useEffect, useRef, useState } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { getCheevoCheckState, scheduleCheevoCheckScan } from "../../api";
import { t, type LanguageCode } from "../../locales";
import { logError } from "../../utils/errors";
import { getCurrentModalScale, modalSize } from "../../utils/scale";
import { modalBodyStyle } from "../../utils/style";
import { openPathPicker } from "../pickers/FilePickerModal";
import { confirmFolderSystems, folderPickedThisSession } from "../cheevocheck/FolderSystemsModal";
import { BottomFocusAnchor } from "../ui/BottomFocusAnchor";
import { FocusTarget } from "../ui/FocusTarget";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { withInlineTags } from "../ui/inlineTags";

const SCAN_DELAY_SECONDS = 120;

type Stage = "ask" | "scheduled" | "failed";

type WelcomeCheevoCheckModalProps = {
    language: LanguageCode;
    finish: () => void;
};

export function WelcomeCheevoCheckModal(props: WelcomeCheevoCheckModalProps) {
    const { language, finish } = props;

    const [stage, setStage] = useState<Stage>("ask");
    const [start, setStart] = useState<string | null>(null);
    const [folder, setFolder] = useState<string | null>(null);
    const [dolphinInstalled, setDolphinInstalled] = useState(true);
    const pickingRef = useRef(false);

    useEffect(() => {
        void getCheevoCheckState()
            .then((state) => {
                setStart(state?.startDir || "/");
                setDolphinInstalled(Boolean(state?.dolphinInstalled));
            })
            .catch((e) => {
                logError("read the Cheevo Check start folder for the welcome", e);
                setStart("/");
            });
    }, []);

    function schedule(folder: string) {
        void scheduleCheevoCheckScan(folder, SCAN_DELAY_SECONDS)
            .then((result) => setStage(result?.ok ? "scheduled" : "failed"))
            .catch((e) => {
                logError("schedule the welcome's Cheevo Check scan", e);
                setStage("failed");
            });
    }

    async function choose() {
        if (!start || pickingRef.current) {
            return;
        }
        pickingRef.current = true;
        try {
            let root = folder;
            if (!root) {
                const picked = await openPathPicker({
                    language,
                    prompt: t(language, "Choose your ROMs collection folder"),
                    startPath: start,
                    includeFiles: false,
                    includeFolders: true
                });
                root = picked.realpath || picked.path;
                setFolder(root);
            }
            const choice = await confirmFolderSystems({ language, root, offline: false, forward: "next", dolphinInstalled });
            if (choice) {
                schedule(choice.root);
            }
            else {
                setFolder(folderPickedThisSession() ?? root);
                void getCheevoCheckState()
                    .then((state) => setDolphinInstalled(Boolean(state?.dolphinInstalled)))
                    .catch((e) => logError("read the Cheevo Check state after the folder list", e));
            }
        }
        catch {
        }
        finally {
            pickingRef.current = false;
        }
    }

    const title = (
        <div style={{ fontSize: `${modalSize(22)}px`, fontWeight: 700, marginBottom: "4px" }}>
            {t(language, "Cheevo Check")}
        </div>
    );

    const skipLine = (
        <div style={{ ...modalBodyStyle(), marginTop: "8px", opacity: 0.7 }}>
            {withInlineTags(t(language, "welcome_cheevo_check_skip"))}
        </div>
    );

    const buttonStyle = { width: "100%", fontSize: `${modalSize(14)}px` };

    function button(key: string, label: string, onClick: () => void, autoFocus = false) {
        return (
            <FocusTarget
                key={key}
                focusKey={`welcome-cc:${key}`}
                style={{ display: "flex" }}
            >
                <DialogButton onClick={onClick} autoFocus={autoFocus || undefined} style={buttonStyle}>
                    {label}
                </DialogButton>
            </FocusTarget>
        );
    }

    const portable = getCurrentModalScale() === "normal";

    let body;
    if (stage === "scheduled") {
        body = (
            <Focusable key="welcome-cc:scheduled" style={{ display: "flex", flexDirection: "column" }}>
                <Focusable onActivate={() => { }} noFocusRing={true} data-focus-key="welcome-cc:heading">
                    {title}
                </Focusable>
                <div style={{ fontSize: `${modalSize(14)}px`, lineHeight: 1.4, marginBottom: "12px" }}>
                    {withInlineTags(t(language, "welcome_cheevo_check_scheduled"))}
                </div>
                {button("continue", t(language, "Continue"), finish, true)}
            </Focusable>
        );
    }
    else if (stage === "failed") {
        body = (
            <Focusable key="welcome-cc:failed" style={{ display: "flex", flexDirection: "column" }}>
                <Focusable onActivate={() => { }} noFocusRing={true} autoFocus data-focus-key="welcome-cc:heading">
                    {title}
                </Focusable>
                <div style={{ fontSize: `${modalSize(14)}px`, lineHeight: 1.4 }}>
                    {t(language, "Something went wrong")}
                </div>
                {skipLine}
                <div style={{ marginTop: "12px", display: "flex", flexDirection: "column" }}>
                    {button("skip", t(language, "Skip for Now"), finish)}
                </div>
            </Focusable>
        );
    }
    else {
        body = (
            <Focusable key="welcome-cc:ask" style={{ display: "flex", flexDirection: "column" }}>
                <Focusable onActivate={() => { }} noFocusRing={true} autoFocus={!portable || undefined} data-focus-key="welcome-cc:heading">
                    {title}
                </Focusable>
                <div style={{ fontSize: `${modalSize(14)}px`, lineHeight: 1.4, marginBottom: "8px" }}>
                    {t(language, "welcome_cheevo_check_intro")}
                </div>
                <div style={{ ...modalBodyStyle(), marginBottom: "8px" }}>
                    {withInlineTags(t(language, "welcome_cheevo_check_layouts"))}
                </div>
                {start && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {button("choose", t(language, "Choose Folder"), () => void choose(), portable)}
                        {button("skip", t(language, "Skip for Now"), finish)}
                    </div>
                )}
                {skipLine}
            </Focusable>
        );
    }

    return (
        <ModalRoot onCancel={finish} onEscKeypress={finish}>
            <SnapshotHotkey language={language} />
            {body}
            <BottomFocusAnchor focusKey="welcome-cc:bottom:anchor" headroomPx={8} />
        </ModalRoot>
    );
}
