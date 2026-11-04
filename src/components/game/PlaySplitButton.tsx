import { useState, type CSSProperties } from "react";
import { DialogButton, Focusable } from "@decky/ui";

import { FocusTarget } from "../ui/FocusTarget";
import { steamPlayGreen, steamPlayGrey, steamPlayGreyText, steamPlayStrip } from "../../utils/style";
import type { PlayMode } from "../../hooks/useGamePlayController";

function PlayIcon() {
    return (
        <svg viewBox="0 0 12 14" width="12" height="14" fill="currentColor" focusable="false">
            <path d="M1 0.5 L11.5 7 L1 13.5 Z" />
        </svg>
    );
}

function CaretDownIcon() {
    return (
        <svg viewBox="0 0 12 8" width="12" height="8" fill="currentColor" focusable="false">
            <path d="M0.5 0.5 H11.5 L6 7.5 Z" />
        </svg>
    );
}

type PlaySplitButtonProps = {
    focusKeyBase: string;
    backKey: string;
    mode: PlayMode;
    label: string;
    disabled: boolean;
    onPress: () => void;
    onToggleMode: () => void;
    style?: CSSProperties;
};

export function PlaySplitButton(props: PlaySplitButtonProps) {
    const { focusKeyBase, backKey, mode, label, disabled } = props;
    const [focused, setFocused] = useState<"main" | "caret" | null>(null);
    const mainKey = `${focusKeyBase}:play`;
    const caretKey = `${focusKeyBase}:mode`;
    const mainLit = focused === "main";
    const caretLit = focused === "caret";

    return (
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "4px", ...props.style }}>
            <Focusable flow-children="row" style={{ display: "flex", gap: "2px", width: "100%" }}>
                <FocusTarget
                    focusKey={mainKey}
                    focusFallback={[caretKey, backKey]}
                    style={{ display: "flex", flex: 1, minWidth: 0 }}
                >
                    <DialogButton
                        onClick={props.onPress}
                        onGamepadFocus={() => setFocused("main")}
                        onGamepadBlur={() => setFocused((was) => (was === "main" ? null : was))}
                        style={{
                            width: "100%",
                            minWidth: 0,
                            height: "40px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-start",
                            gap: "10px",
                            padding: "0 14px",
                            fontWeight: 700,
                            background: mainLit ? undefined : disabled ? steamPlayGrey : steamPlayGreen,
                            color: mainLit ? undefined : disabled ? steamPlayGreyText : "#ffffff"
                        }}
                    >
                        {mode === "play" && <PlayIcon />}
                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {label}
                        </span>
                    </DialogButton>
                </FocusTarget>
                <FocusTarget
                    focusKey={caretKey}
                    focusFallback={[mainKey, backKey]}
                    style={{ display: "flex", flex: "0 0 40px" }}
                >
                    <DialogButton
                        onClick={props.onToggleMode}
                        onGamepadFocus={() => setFocused("caret")}
                        onGamepadBlur={() => setFocused((was) => (was === "caret" ? null : was))}
                        style={{
                            width: "100%",
                            minWidth: 0,
                            height: "40px",
                            padding: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: caretLit ? undefined : steamPlayStrip,
                            color: caretLit ? undefined : "#dcdedf"
                        }}
                    >
                        <CaretDownIcon />
                    </DialogButton>
                </FocusTarget>
            </Focusable>
        </div>
    );
}
