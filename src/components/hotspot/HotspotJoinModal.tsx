import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useEffect, useState } from "react";

import { hotspotScan, type HotspotRow } from "../../api";
import { useSlidingWindow } from "../../hooks/useSlidingWindow";
import { getCurrentLanguage, t, type LanguageCode } from "../../locales";
import { logError } from "../../utils/errors";
import { joinHotspot } from "../../utils/hotspotState";
import { showManagedModal } from "../../utils/modalRegistry";
import { getCurrentModalScale, modalSize } from "../../utils/scale";
import { modalBodyStyle } from "../../utils/style";
import { FocusableItem } from "../ui/FocusableItem";
import { FocusTarget } from "../ui/FocusTarget";
import { InlineSpinner } from "../ui/InlineSpinner";
import { SlidingWindowRows } from "../ui/SlidingWindowRows";
import { openHotspotCode } from "./HotspotCodeModal";

const CANCEL_KEY = "hotspot:join:cancel";
const SCAN_MS = 5000;

function rowKey(row: HotspotRow): string {
    return "hotspot:join:" + row.ssid;
}

function HotspotJoinModal(props: { language: LanguageCode; close: () => void }) {
    const { language, close } = props;
    const [found, setFound] = useState<HotspotRow[] | null>(null);

    useEffect(() => {
        let alive = true;
        async function scan() {
            try {
                const result = await hotspotScan();
                if (alive && result.ok) {
                    setFound(result.hotspots);
                }
            }
            catch (e) {
                logError("offline hotspot: scanning from the notifications", e);
            }
        }
        void scan();
        const timer = setInterval(() => void scan(), SCAN_MS);
        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, []);

    const rows = found ?? [];
    const rowWindow = useSlidingWindow({
        items: rows,
        itemKey: (row) => row.ssid,
        focusKeyFor: rowKey,
        windowId: "hotspot:joinmodal",
        heightScope: ["hotspot:joinmodal", getCurrentModalScale(), language].join("|"),
        dynamicLoading: true,
        initialRows: 20,
        rowStep: 20,
        fullSteps: true,
        prefetchDistance: 0,
        sentinelRootMarginPx: 600,
        resetKey: "hotspot:joinmodal"
    });

    function pick(row: HotspotRow) {
        close();
        if (row.private) {
            openHotspotCode(language, row.ssid, (code) => void joinHotspot(row.ssid, code));
            return;
        }
        void joinHotspot(row.ssid, "");
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                {t(language, "Join Offline Hotspot")}
            </div>
            {found === null && <InlineSpinner label={t(language, "Searching for hotspots...")} />}
            {found !== null && rows.length === 0 && (
                <div style={modalBodyStyle()}>{t(language, "No CheevoDeck hotspots nearby.")}</div>
            )}
            {rows.length > 0 && (
                <SlidingWindowRows list={rowWindow}>
                    {rowWindow.mountedItems.map((row, index) => {
                        const at = rowWindow.start + index;
                        const neighbors = [rows[at + 1], rows[at - 1]]
                            .filter((other): other is HotspotRow => other !== undefined)
                            .map(rowKey);
                        return (
                            <div key={row.ssid} style={{ paddingBottom: "4px" }}>
                                <FocusableItem
                                    focusKey={rowKey(row)}
                                    focusFallback={[...neighbors, CANCEL_KEY]}
                                    onGamepadFocus={() => rowWindow.onItemFocus(at)}
                                    onGamepadDirection={rowWindow.guardTopRow(at)}
                                    onClick={() => pick(row)}
                                >
                                    <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", ...modalBodyStyle(), opacity: 1, width: "100%" }}>
                                        <span style={{ fontWeight: 700, overflowWrap: "anywhere" }}>
                                            {row.private ? `${row.ssid} · ${t(language, "tag_private_hotspot")}` : row.ssid}
                                        </span>
                                        <span style={{ opacity: 0.8 }}>{`${row.strength}%`}</span>
                                    </div>
                                </FocusableItem>
                            </div>
                        );
                    })}
                </SlidingWindowRows>
            )}
            <Focusable style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }} flow-children="row">
                <FocusTarget focusKey={CANCEL_KEY}>
                    <DialogButton onClick={close}>{t(language, "Cancel")}</DialogButton>
                </FocusTarget>
            </Focusable>
        </ModalRoot>
    );
}

export function openHotspotJoin() {
    const language = getCurrentLanguage();
    showManagedModal((close) => <HotspotJoinModal language={language} close={close} />);
}
