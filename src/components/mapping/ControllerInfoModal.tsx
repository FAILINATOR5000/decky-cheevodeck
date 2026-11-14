import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useEffect, useState, type CSSProperties } from "react";
import { getSteamControllerSlots } from "../../api";
import { t, type LanguageCode } from "../../locales";
import type { SteamControllerSlot } from "../../types";
import { controllerTypeLabel } from "../../utils/dolphin";
import { logError } from "../../utils/errors";
import { modalSize } from "../../utils/scale";
import type { SteamPad } from "../../utils/steamControllers";
import { showManagedModal } from "../../utils/modalRegistry";
import { FocusTarget } from "../ui/FocusTarget";
import { HeadingStop } from "../ui/HeadingStop";

const ROW_STYLE: CSSProperties = {
    width: "100%",
    display: "flex",
    gap: "12px",
    padding: "4px 6px"
};

const ROW_OUTER_STYLE: CSSProperties = {
    padding: "2px 0",
    borderBottom: "1px solid rgba(255, 255, 255, 0.08)"
};

const LABEL_STYLE: CSSProperties = {
    flex: "0 0 40%",
    opacity: 0.7
};

const VALUE_STYLE: CSSProperties = {
    flex: 1,
    minWidth: 0,
    overflowWrap: "anywhere",
    fontWeight: 600
};

function hex4(value: number): string {
    return value.toString(16).padStart(4, "0");
}

function slotFor(pad: SteamPad, slots: SteamControllerSlot[]): SteamControllerSlot | null {
    const vid = `0x${hex4(pad.vendorId)}`;
    const pid = `0x${hex4(pad.productId)}`;
    const same = (slot: SteamControllerSlot) => slot.vid === vid && slot.pid === pid;
    return slots.find((slot) => slot.slot === pad.slot && same(slot)) ?? slots.find(same) ?? null;
}

function connectionLabel(pad: SteamPad, language: LanguageCode): string {
    switch (pad.connection) {
        case "builtIn":
            return t(language, "Built-in");
        case "bluetooth":
            return t(language, "Bluetooth");
        case "dongle":
            return t(language, "Steam dongle");
        default:
            return t(language, "Wired");
    }
}

function ControllerInfoModal(props: { language: LanguageCode; pad: SteamPad; close: () => void }) {
    const { language, pad, close } = props;
    const [slot, setSlot] = useState<SteamControllerSlot | null | undefined>(undefined);

    useEffect(() => {
        let live = true;
        getSteamControllerSlots()
            .then((result) => {
                if (live) {
                    setSlot(slotFor(pad, result?.slots ?? []));
                }
            })
            .catch((e) => {
                logError("getSteamControllerSlots", e);
                if (live) {
                    setSlot(null);
                }
            });
        return () => {
            live = false;
        };
    }, [pad]);

    const pending = slot === undefined ? "…" : null;
    const missing = t(language, "Not in Steam's slot file");
    const rows: [string, string][] = [
        [t(language, "Player"), String(pad.slot + 1)],
        [t(language, "Steam name"), pad.name],
        [t(language, "SDL name"), pending ?? slot?.name ?? missing],
        [t(language, "Dolphin Mapper type"), pending ?? (slot?.mapperType ? controllerTypeLabel(slot.mapperType, language) : t(language, "No match"))],
        [t(language, "SDL type"), pending ?? (slot?.type || missing)],
        ["VID:PID", `${hex4(pad.vendorId)}:${hex4(pad.productId)}`],
        [t(language, "Connection"), connectionLabel(pad, language)]
    ];
    if (pad.battery !== null) {
        rows.push([t(language, "Battery"), pad.charging ? `${pad.battery}% (${t(language, "Charging")})` : `${pad.battery}%`]);
    }
    if (pad.serial) {
        rows.push([t(language, "Serial number"), pad.serial]);
    }
    if (pad.firmware) {
        rows.push([t(language, "Firmware"), pad.firmware]);
    }
    rows.push([t(language, "Steam controller index"), String(pad.index)]);
    if (slot?.handle) {
        rows.push([t(language, "SDL handle"), slot.handle]);
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <HeadingStop focusKey="padinfo:title" autoFocus outerStyle={{ marginBottom: "10px" }}
                style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700 }}>
                {t(language, "Controller Info")}
            </HeadingStop>
            <div style={{ fontSize: `${modalSize(14)}px` }}>
                {rows.map(([label, value], index) => (
                    <HeadingStop key={label} focusKey={`padinfo:row:${index}`} outerStyle={ROW_OUTER_STYLE} style={ROW_STYLE}>
                        <div style={LABEL_STYLE}>{label}</div>
                        <div style={VALUE_STYLE}>{value}</div>
                    </HeadingStop>
                ))}
            </div>
            <Focusable style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }} flow-children="row">
                <FocusTarget focusKey="padinfo:close">
                    <DialogButton onClick={close}>{t(language, "Close")}</DialogButton>
                </FocusTarget>
            </Focusable>
        </ModalRoot>
    );
}

export function openControllerInfo(language: LanguageCode, pad: SteamPad) {
    showManagedModal((close) => <ControllerInfoModal language={language} pad={pad} close={close} />);
}
