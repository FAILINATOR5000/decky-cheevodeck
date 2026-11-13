import { useEffect, useRef, useState } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { getCheevoCheckState, scheduleCheevoCheckScan } from "../../api";
import { t, type LanguageCode } from "../../locales";
import { logError } from "../../utils/errors";
import { modalSize } from "../../utils/scale";
import { modalBodyStyle } from "../../utils/style";
import { openPathPicker } from "../pickers/FilePickerModal";
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
    const defaultRef = useRef<HTMLDivElement | null>(null);
    const pickingRef = useRef(false);

    useEffect(() => {
        void getCheevoCheckState()
            .then((state) => setStart(state?.startDir || "/"))
            .catch((e) => {
                logError("read the Cheevo Check start folder for the welcome", e);
                setStart("/");
            });
    }, []);

    useEffect(function seedFocusOnDefault() {
        const target = defaultRef.current?.querySelector("button, [tabindex]") as HTMLElement | null;
        if (target) {
            target.focus();
        }
    }, [stage, start]);

    function schedule(folder: string) {
        void scheduleCheevoCheckScan(folder, SCAN_DELAY_SECONDS)
            .then((result) => setStage(result?.ok ? "scheduled" : "failed"))
            .catch((e) => {
                logError("schedule the welcome's Cheevo Check scan", e);
                setStage("failed");
            });
    }

    function choose() {
        if (!start || pickingRef.current) {
            return;
        }
        pickingRef.current = true;
        openPathPicker({
            language,
            prompt: t(language, "Choose your ROMs collection folder"),
            startPath: start,
            includeFiles: false,
            includeFolders: true
        })
            .then((picked) => schedule(picked.realpath || picked.path))
            .catch(() => { })
            .finally(() => {
                pickingRef.current = false;
            });
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

    function button(key: string, label: string, onClick: () => void, isDefault: boolean) {
        return (
            <FocusTarget
                key={key}
                focusKey={`welcome-cc:${key}`}
                ref={isDefault ? defaultRef : undefined}
                style={{ display: "flex" }}
            >
                <DialogButton onClick={onClick} style={buttonStyle}>
                    {label}
                </DialogButton>
            </FocusTarget>
        );
    }

    let body;
    if (stage === "scheduled") {
        body = (
            <Focusable key="welcome-cc:scheduled" style={{ display: "flex", flexDirection: "column" }}>
                <Focusable onActivate={() => { }} noFocusRing={true} data-focus-key="welcome-cc:heading">
                    {title}
                    <div style={{ fontSize: `${modalSize(14)}px`, lineHeight: 1.4, marginBottom: "12px" }}>
                        {withInlineTags(t(language, "welcome_cheevo_check_scheduled"))}
                    </div>
                </Focusable>
                {button("continue", t(language, "Continue"), finish, true)}
            </Focusable>
        );
    }
    else if (stage === "failed") {
        body = (
            <Focusable key="welcome-cc:failed" style={{ display: "flex", flexDirection: "column" }}>
                <Focusable onActivate={() => { }} noFocusRing={true} data-focus-key="welcome-cc:heading">
                    {title}
                    <div style={{ fontSize: `${modalSize(14)}px`, lineHeight: 1.4 }}>
                        {t(language, "Something went wrong")}
                    </div>
                    {skipLine}
                </Focusable>
                <div style={{ marginTop: "12px", display: "flex", flexDirection: "column" }}>
                    {button("skip", t(language, "Skip for Now"), finish, true)}
                </div>
            </Focusable>
        );
    }
    else {
        body = (
            <Focusable key="welcome-cc:ask" style={{ display: "flex", flexDirection: "column" }}>
                <Focusable onActivate={() => { }} noFocusRing={true} data-focus-key="welcome-cc:heading">
                    {title}
                    <div style={{ fontSize: `${modalSize(14)}px`, lineHeight: 1.4, marginBottom: "8px" }}>
                        {t(language, "welcome_cheevo_check_intro")}
                    </div>
                    <div style={{ ...modalBodyStyle(), marginBottom: "8px" }}>
                        {withInlineTags(t(language, "welcome_cheevo_check_layouts"))}
                    </div>
                    <div style={{ ...modalBodyStyle(), marginBottom: "8px", opacity: 1 }}>
                        {t(language, "welcome_cheevo_check_choose")}
                    </div>
                </Focusable>
                {start && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {button("choose", t(language, "Choose Folder"), choose, true)}
                        {button("skip", t(language, "Skip for Now"), finish, false)}
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
