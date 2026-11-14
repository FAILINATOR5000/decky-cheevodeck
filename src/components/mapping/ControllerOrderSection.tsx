import { DialogButton, Focusable, PanelSectionRow } from "@decky/ui";
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
// Font Awesome Free icons, CC BY 4.0. See ATTRIBUTIONS.md.
import {
    FaArrowDown,
    FaArrowUp,
    FaBatteryEmpty,
    FaBatteryFull,
    FaBatteryHalf,
    FaBatteryQuarter,
    FaBatteryThreeQuarters,
    FaBolt,
    FaBroadcastTower,
    FaInfoCircle
} from "react-icons/fa";
import { FocusClaim } from "../ui/FocusClaim";
import { FocusTarget } from "../ui/FocusTarget";
import { expectHeirClaim } from "../../focusClaims";
import { InfoText } from "../ui/InfoText";
import { t, type LanguageCode } from "../../locales";
import type { SteamPad } from "../../utils/steamControllers";
import { textSize } from "../../utils/scale";
import { openControllerInfo } from "./ControllerInfoModal";

export const PAD_ORDER_FOCUS_KEY = "dolphinMapper:padorder";

const ROW_STYLE: CSSProperties = {
    borderBottom: "1px solid rgba(255, 255, 255, 0.12)",
    padding: "8px 0"
};

const NAME_LINE_STYLE: CSSProperties = {
    width: "100%",
    display: "flex",
    justifyContent: "flex-start",
    alignItems: "flex-start",
    gap: "8px"
};

const PLAYER_BADGE_STYLE: CSSProperties = {
    flexShrink: 0,
    minWidth: "22px",
    height: "22px",
    padding: "0 4px",
    boxSizing: "border-box",
    borderRadius: "11px",
    background: "rgba(255, 255, 255, 0.16)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800
};

const NAME_STYLE: CSSProperties = {
    fontWeight: 600,
    minWidth: 0,
    lineHeight: "22px",
    overflowWrap: "anywhere"
};

const TILES_STYLE: CSSProperties = {
    display: "flex",
    justifyContent: "flex-start",
    gap: "6px",
    marginTop: "6px"
};

const TILE_WIDTH = "44px";
const TILE_HEIGHT = "32px";
const ICON_SIZE = 15;

const TILE_BUTTON_STYLE: CSSProperties = {
    width: TILE_WIDTH,
    minWidth: TILE_WIDTH,
    height: TILE_HEIGHT,
    minHeight: TILE_HEIGHT,
    padding: "0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
};


const LOW_BATTERY = 20;
const LOW_BATTERY_COLOR = "#ff6a6a";

type ControllerOrderSectionProps = {
    language: LanguageCode;
    pads: SteamPad[];
    settled: boolean;
    inGame: boolean;
    onMove: (index: number, step: -1 | 1) => void;
    onPing: (index: number) => void;
};

function padOrderKey(index: number, button: "up" | "down" | "ping" | "info"): string {
    return `${PAD_ORDER_FOCUS_KEY}:${index}:${button}`;
}

function BatteryIcon(props: { level: number; charging: boolean }) {
    const { level, charging } = props;
    const low = level <= LOW_BATTERY && !charging;
    let icon: ReactNode;
    if (level > 87) {
        icon = <FaBatteryFull size={ICON_SIZE + 3} />;
    }
    else if (level > 62) {
        icon = <FaBatteryThreeQuarters size={ICON_SIZE + 3} />;
    }
    else if (level > 37) {
        icon = <FaBatteryHalf size={ICON_SIZE + 3} />;
    }
    else if (level > 12) {
        icon = <FaBatteryQuarter size={ICON_SIZE + 3} />;
    }
    else {
        icon = <FaBatteryEmpty size={ICON_SIZE + 3} />;
    }
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", color: low ? LOW_BATTERY_COLOR : undefined }}>
            {charging && <FaBolt size={ICON_SIZE - 4} />}
            {icon}
        </span>
    );
}

type PendingMove = { key: string; index: number; fromSlot: number };

export function ControllerOrderSection(props: ControllerOrderSectionProps) {
    const { language, pads, settled, inGame, onMove, onPing } = props;
    const [claim, setClaim] = useState<{ key: string; token: number; armed: boolean } | null>(null);
    const pendingRef = useRef<PendingMove | null>(null);

    useLayoutEffect(() => {
        const pending = pendingRef.current;
        if (!pending) {
            return;
        }
        const pad = pads.find((entry) => entry.index === pending.index);
        if (pad && pad.slot === pending.fromSlot) {
            return;
        }
        pendingRef.current = null;
        if (pad) {
            setClaim((current) => ({ key: pending.key, token: (current?.token ?? 0) + 1, armed: true }));
        }
    }, [pads]);

    const spendClaim = useCallback(() => {
        setClaim((current) => (current?.armed ? { ...current, armed: false } : current));
    }, []);

    if (!settled) {
        return null;
    }

    function move(pad: SteamPad, step: -1 | 1, key: string) {
        const at = pads.indexOf(pad);
        if (!pads[at + step]) {
            return;
        }
        pendingRef.current = { key, index: pad.index, fromSlot: pad.slot };
        expectHeirClaim();
        onMove(pad.index, step);
    }

    function claimed(key: string, tile: ReactNode) {
        if (!claim || claim.key !== key) {
            return tile;
        }
        return (
            <FocusClaim token={claim.token} armed={claim.armed} onSpent={spendClaim}>
                {tile}
            </FocusClaim>
        );
    }

    function renderPad(pad: SteamPad) {
        const up = padOrderKey(pad.index, "up");
        const down = padOrderKey(pad.index, "down");
        const ping = padOrderKey(pad.index, "ping");
        const info = padOrderKey(pad.index, "info");

        return (
            <div key={pad.index} style={ROW_STYLE}>
                <PanelSectionRow>
                    <div style={NAME_LINE_STYLE}>
                        <span style={{ ...PLAYER_BADGE_STYLE, fontSize: `${textSize(12)}px` }}>
                            {pad.slot + 1}
                        </span>
                        <span style={{ ...NAME_STYLE, fontSize: `${textSize(15)}px` }}>
                            {pad.name || t(language, "Controller")}
                        </span>
                    </div>
                </PanelSectionRow>
                <PanelSectionRow>
                    <Focusable flow-children="row" style={TILES_STYLE}>
                        {inGame && claimed(up, (
                            <FocusTarget focusKey={up} focusFallback={[down, ping, PAD_ORDER_FOCUS_KEY]}>
                                <DialogButton
                                    style={TILE_BUTTON_STYLE}
                                    aria-label={t(language, "Up")}
                                    onClick={() => move(pad, -1, up)}
                                >
                                    <FaArrowUp size={ICON_SIZE} />
                                </DialogButton>
                            </FocusTarget>
                        ))}
                        {inGame && claimed(down, (
                            <FocusTarget focusKey={down} focusFallback={[up, ping, PAD_ORDER_FOCUS_KEY]}>
                                <DialogButton
                                    style={TILE_BUTTON_STYLE}
                                    aria-label={t(language, "Down")}
                                    onClick={() => move(pad, 1, down)}
                                >
                                    <FaArrowDown size={ICON_SIZE} />
                                </DialogButton>
                            </FocusTarget>
                        ))}
                        <FocusTarget focusKey={ping} focusFallback={[info, PAD_ORDER_FOCUS_KEY]}>
                            <DialogButton
                                style={TILE_BUTTON_STYLE}
                                aria-label={t(language, "Ping")}
                                onClick={() => onPing(pad.index)}
                            >
                                <FaBroadcastTower size={ICON_SIZE} />
                            </DialogButton>
                        </FocusTarget>
                        <FocusTarget focusKey={info} focusFallback={[ping, PAD_ORDER_FOCUS_KEY]}>
                            <DialogButton
                                style={TILE_BUTTON_STYLE}
                                aria-label={t(language, "Info")}
                                onClick={() => openControllerInfo(language, pad)}
                            >
                                {pad.battery === null
                                    ? <FaInfoCircle size={ICON_SIZE} />
                                    : <BatteryIcon level={pad.battery} charging={pad.charging} />}
                            </DialogButton>
                        </FocusTarget>
                    </Focusable>
                </PanelSectionRow>
            </div>
        );
    }

    return (
        <>
            {!inGame && (
                <PanelSectionRow>
                    <InfoText centered>{t(language, "Reorder only works while a game is running.")}</InfoText>
                </PanelSectionRow>
            )}
            {pads.length === 0
                ? (
                    <PanelSectionRow>
                        <InfoText centered>{t(language, "No controllers connected.")}</InfoText>
                    </PanelSectionRow>
                )
                : pads.map(renderPad)}
        </>
    );
}
