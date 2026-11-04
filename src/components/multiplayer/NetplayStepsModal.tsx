import { DialogButton, Focusable, ModalRoot } from "@decky/ui";

import { t, type LanguageCode } from "../../locales";
import { cancelQuickAccessReturn, showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";

export type NetplaySteps = "dolphin" | "rmg";

const STEPS: Record<NetplaySteps, { title: string; host: string; guest: string; open: string }> = {
    dolphin: {
        title: "Dolphin NetPlay",
        host: "In Dolphin, open Tools, then Start NetPlay, then Host. Pick the game and press Start once everyone has joined.",
        guest: "In Dolphin, open Tools, then Start NetPlay, then Connect. The host's address is filled in.",
        open: "Open Dolphin"
    },
    rmg: {
        title: "RMG Netplay",
        host: "rmg_steps_host",
        guest: "rmg_steps_guest",
        open: "Open RMG"
    }
};

function NetplayStepsModal(props: { language: LanguageCode; emulator: NetplaySteps; host: boolean; game: string; close: () => void }) {
    const { language, host, close } = props;
    const steps = STEPS[props.emulator];
    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                {t(language, steps.title)}
            </div>
            <div style={{ fontSize: `${modalSize(16)}px`, lineHeight: 1.4 }}>
                {t(language, host ? steps.host : steps.guest, { game: props.game })}
            </div>
            {props.emulator === "rmg" && (
                <div style={{ fontSize: `${modalSize(16)}px`, lineHeight: 1.4, marginTop: "10px" }}>
                    {t(language, "rmg_steps_controls")}
                </div>
            )}
            <Focusable style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }} flow-children="row">
                <DialogButton onClick={close}>{t(language, steps.open)}</DialogButton>
            </Focusable>
        </ModalRoot>
    );
}

export function showNetplaySteps(language: LanguageCode, emulator: NetplaySteps, host: boolean, game: string): Promise<void> {
    return new Promise((resolve) => {
        showManagedModal((close) => (
            <NetplayStepsModal language={language} emulator={emulator} host={host} game={game} close={close} />
        ), {
            onClose: () => {
                cancelQuickAccessReturn();
                resolve();
            }
        });
    });
}
