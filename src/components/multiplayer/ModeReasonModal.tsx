import { DialogButton, Focusable, ModalRoot } from "@decky/ui";

import { t, type LanguageCode } from "../../locales";
import type { MultiplayerMode } from "../../types";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { DesktopToolButtons } from "../game/ShortcutNeededModal";
import { STATE_LOOKS } from "./ModeChart";

const TITLES: Record<MultiplayerMode, Record<"setup" | "never", string>> = {
    link: { setup: "Link Play: Needs setup", never: "Link Play: Won't work" },
    couch: { setup: "Couch Play: Needs setup", never: "Couch Play: Won't work" },
    stream: { setup: "Stream Play: Needs setup", never: "Stream Play: Won't work" }
};

export type ModeFix = { labelKey: string; onPress: (close: () => void) => void };

export type ModeReason = {
    mode: MultiplayerMode;
    state: "setup" | "never";
    text: string;
    fixes: ModeFix[];
    tools: { emudeck?: boolean; srm?: boolean } | null;
};

function ModeReasonModal(props: { language: LanguageCode; reason: ModeReason; close: () => void }) {
    const { language, reason, close } = props;
    const look = STATE_LOOKS[reason.state];
    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <div
                style={{
                    fontSize: `${modalSize(20)}px`,
                    fontWeight: 700,
                    marginBottom: "12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px"
                }}
            >
                <look.Icon style={{ color: look.color, flexShrink: 0 }} />
                {t(language, TITLES[reason.mode][reason.state])}
            </div>
            <div style={{ fontSize: `${modalSize(16)}px`, lineHeight: 1.4, whiteSpace: "pre-line" }}>
                {reason.text}
            </div>
            <Focusable style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "16px" }} flow-children="column">
                {reason.fixes.map((fix) => (
                    <DialogButton key={fix.labelKey} onClick={() => fix.onPress(close)}>
                        {t(language, fix.labelKey)}
                    </DialogButton>
                ))}
                {reason.tools && <DesktopToolButtons language={language} tools={reason.tools} close={close} />}
                <DialogButton onClick={close}>{t(language, "Close")}</DialogButton>
            </Focusable>
        </ModalRoot>
    );
}

export function showModeReason(language: LanguageCode, reason: ModeReason) {
    showManagedModal((close) => <ModeReasonModal language={language} reason={reason} close={close} />);
}
