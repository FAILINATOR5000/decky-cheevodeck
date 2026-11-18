import { DialogButton, Focusable, ModalRoot } from "@decky/ui";

import { t, type LanguageCode } from "../../locales";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { achievementGreen } from "../../utils/style";
import { FocusableItem } from "../ui/FocusableItem";
import { FocusTarget } from "../ui/FocusTarget";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

const BITRATES = [0, 3000, 6000, 10000, 15000, 20000];
const BITRATES_4K = [30000, 40000, 50000];

export function bitrateLabel(language: LanguageCode, kbps: number) {
    return kbps ? t(language, "{{count}} Mbit/s", { count: kbps / 1000 }) : t(language, "Auto");
}

type StreamBitrateProps = {
    language: LanguageCode;
    chosen: number;
    fourK: boolean;
    onPick: (kbps: number) => void;
    close: () => void;
};

function StreamBitrateModal(props: StreamBitrateProps) {
    const { language, chosen, fourK, onPick, close } = props;

    function pick(kbps: number) {
        if (kbps !== chosen) {
            onPick(kbps);
        }
        close();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                {t(language, "Stream Bitrate")}
            </div>
            <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {(fourK ? [...BITRATES, ...BITRATES_4K] : BITRATES).map((kbps) => {
                    const active = kbps === chosen;
                    return (
                        <FocusableItem
                            key={kbps}
                            outerStyle={{ width: "100%", minWidth: 0 }}
                            focusKey={`streambitrate:${kbps}`}
                            onClick={() => pick(kbps)}
                            autoFocus={active}
                            bottomSeparator="none"
                        >
                            <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", textAlign: "left" }}>
                                <span style={{ fontSize: `${modalSize(15)}px`, fontWeight: active ? 700 : 500, minWidth: 0, flex: 1 }}>
                                    {kbps ? bitrateLabel(language, kbps) : t(language, "Auto (Recommended)")}
                                </span>
                                {active && <span style={{ color: achievementGreen, flexShrink: 0 }}>{"✔"}</span>}
                            </div>
                        </FocusableItem>
                    );
                })}
            </Focusable>
            <Focusable style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }} flow-children="row">
                <FocusTarget focusKey="streambitrate:close">
                    <DialogButton onClick={close}>{t(language, "Close")}</DialogButton>
                </FocusTarget>
            </Focusable>
        </ModalRoot>
    );
}

export function openStreamBitrate(options: Omit<StreamBitrateProps, "close">) {
    showManagedModal((close) => <StreamBitrateModal {...options} close={close} />);
}
