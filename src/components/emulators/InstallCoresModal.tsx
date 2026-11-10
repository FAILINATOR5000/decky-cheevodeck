import { DialogButton, Focusable, ModalRoot } from "@decky/ui";

import { t, type LanguageCode } from "../../locales";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { FocusTarget } from "../ui/FocusTarget";
import { HeadingStop } from "../ui/HeadingStop";

export type CoresOffer = {
    systems: number;
    recommendedBytes: number;
    allBytes: number;
};

export type CoresChoice = "recommended" | "all";

function megabytes(bytes: number): string {
    return `${Math.max(1, Math.round(bytes / 1000 ** 2))} MB`;
}

function InstallCoresModal(props: { language: LanguageCode; offer: CoresOffer; onChoose: (choice: CoresChoice) => void; close: () => void }) {
    const { language, offer, onChoose, close } = props;

    function choose(choice: CoresChoice) {
        onChoose(choice);
        close();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <HeadingStop focusKey="emulators:cores:title" autoFocus outerStyle={{ marginBottom: "12px" }}
                style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700 }}>
                {t(language, "Install Cores")}
            </HeadingStop>
            <div style={{ fontSize: `${modalSize(16)}px`, lineHeight: 1.4 }}>
                {t(language, "{{count}} systems with games have no core yet. Install the recommended one for each?", { count: offer.systems })}
            </div>
            <div style={{ fontSize: `${modalSize(15)}px`, lineHeight: 1.4, marginTop: "8px", opacity: 0.8 }}>
                {t(language, "Recommended cores: {{size}}. Every core for those systems: {{all}}.", {
                    size: megabytes(offer.recommendedBytes),
                    all: megabytes(offer.allBytes)
                })}
            </div>
            <div style={{ fontSize: `${modalSize(15)}px`, lineHeight: 1.4, marginTop: "8px", opacity: 0.8 }}>
                {t(language, "Cores come from RetroArch's nightly builds, the same place RetroArch's own updater gets them.")}
            </div>
            <Focusable style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "16px" }} flow-children="column">
                <FocusTarget focusKey="emulators:cores:recommended">
                    <DialogButton onClick={() => choose("recommended")}>{t(language, "Install Recommended")}</DialogButton>
                </FocusTarget>
                <FocusTarget focusKey="emulators:cores:all">
                    <DialogButton onClick={() => choose("all")}>{t(language, "Install Every Core")}</DialogButton>
                </FocusTarget>
                <FocusTarget focusKey="emulators:cores:cancel">
                    <DialogButton onClick={close}>{t(language, "Cancel")}</DialogButton>
                </FocusTarget>
            </Focusable>
        </ModalRoot>
    );
}

export function askInstallCores(language: LanguageCode, offer: CoresOffer): Promise<CoresChoice | null> {
    return new Promise((resolve) => {
        let chosen: CoresChoice | null = null;
        showManagedModal(
            (close) => <InstallCoresModal language={language} offer={offer} onChoose={(choice) => { chosen = choice; }} close={close} />,
            { onClose: () => resolve(chosen) }
        );
    });
}
