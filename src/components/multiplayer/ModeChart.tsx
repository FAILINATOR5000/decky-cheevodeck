// Font Awesome Free icons, CC BY 4.0. See ATTRIBUTIONS.md.
import { DialogButton, Focusable } from "@decky/ui";
import { useState } from "react";
import { FaCheckCircle, FaExclamationCircle, FaTimesCircle } from "react-icons/fa";

import { t, type LanguageCode } from "../../locales";
import type { MultiplayerMode, MultiplayerModeState } from "../../types";
import { textSize } from "../../utils/scale";
import { achievementGreen, errorRed, warnAmber } from "../../utils/style";
import { FocusTarget } from "../ui/FocusTarget";

export type ModeState = MultiplayerModeState["state"];

const ORDER: MultiplayerMode[] = ["link", "couch", "stream"];

const MODE_LABELS: Record<MultiplayerMode, string> = {
    link: "Link Play",
    couch: "Couch Play",
    stream: "Stream Play"
};

export const STATE_LOOKS: Record<ModeState, { Icon: typeof FaCheckCircle; color: string; labelKey: string }> = {
    ready: { Icon: FaCheckCircle, color: achievementGreen, labelKey: "Ready" },
    setup: { Icon: FaExclamationCircle, color: warnAmber, labelKey: "Needs setup" },
    never: { Icon: FaTimesCircle, color: errorRed, labelKey: "Won't work" }
};

export function ModeStateLabel(props: { language: LanguageCode; state: ModeState; underline?: boolean }) {
    const look = STATE_LOOKS[props.state];
    return (
        <span
            style={{
                color: look.color,
                fontWeight: 700,
                whiteSpace: "nowrap",
                textDecoration: props.underline ? "underline" : undefined
            }}
        >
            <look.Icon style={{ verticalAlign: "-0.125em", marginRight: "6px" }} />
            {t(props.language, look.labelKey)}
        </span>
    );
}

function StatusLink(props: {
    language: LanguageCode;
    mode: MultiplayerMode;
    chosen: MultiplayerMode;
    state: ModeState;
    onPress: () => void;
}) {
    const [focused, setFocused] = useState(false);
    return (
        <FocusTarget
            focusKey={`multiplayer:mode:${props.mode}:status`}
            focusFallback={[`multiplayer:mode:${props.mode}`, `multiplayer:mode:${props.chosen}`, "multiplayer:back"]}
            style={{ display: "flex", flexShrink: 0 }}
        >
            <Focusable
                onActivate={props.onPress}
                onGamepadFocus={() => setFocused(true)}
                onGamepadBlur={() => setFocused(false)}
                style={{
                    fontSize: `${textSize(12)}px`,
                    padding: "4px 6px",
                    borderRadius: "3px",
                    cursor: "pointer",
                    backgroundColor: focused ? "rgba(255, 255, 255, 0.14)" : "transparent",
                    outline: focused ? "2px solid rgba(255, 255, 255, 0.9)" : "2px solid transparent"
                }}
            >
                <ModeStateLabel language={props.language} state={props.state} underline />
            </Focusable>
        </FocusTarget>
    );
}

export function ModeChart(props: {
    language: LanguageCode;
    mode: MultiplayerMode;
    locked: boolean;
    states: Partial<Record<MultiplayerMode, MultiplayerModeState>>;
    onChoose: (mode: MultiplayerMode) => void;
    onStatus: (mode: MultiplayerMode) => void;
}) {
    const { language, mode, locked } = props;
    const [focused, setFocused] = useState<MultiplayerMode | null>(null);

    function row(each: MultiplayerMode) {
        const chosen = each === mode;
        const disabled = locked && !chosen;
        const hasCursor = focused === each;
        const state = props.states[each]?.state;
        return (
            <Focusable key={each} flow-children="row" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <FocusTarget
                    focusKey={`multiplayer:mode:${each}`}
                    focusFallback={[`multiplayer:mode:${mode}`, "multiplayer:mode:link"].filter((key) => key !== `multiplayer:mode:${each}`)}
                    style={{ display: "flex", flex: 1, minWidth: 0 }}
                >
                    <DialogButton
                        onClick={() => props.onChoose(each)}
                        focusable={!disabled}
                        onGamepadFocus={() => setFocused(each)}
                        onGamepadBlur={() => setFocused((current) => current === each ? null : current)}
                        disabled={disabled}
                        style={{
                            background: chosen || hasCursor ? undefined : "transparent",
                            color: chosen || hasCursor ? undefined : "rgba(220, 222, 223, 0.6)",
                            minWidth: 0,
                            width: "100%",
                            padding: "4px 10px",
                            fontSize: `${textSize(13)}px`,
                            fontWeight: chosen ? 800 : 600,
                            boxShadow: chosen ? `inset 0 -3px 0 ${achievementGreen}` : undefined,
                            opacity: disabled ? 0.4 : 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-start",
                            gap: "8px"
                        }}
                    >
                        <span
                            style={{
                                flexShrink: 0,
                                width: "0.7em",
                                height: "0.7em",
                                borderRadius: "50%",
                                border: `2px solid ${chosen ? achievementGreen : "currentColor"}`,
                                background: chosen ? achievementGreen : "transparent"
                            }}
                        />
                        {t(language, MODE_LABELS[each])}
                    </DialogButton>
                </FocusTarget>
                {state === "ready" && (
                    <div style={{ fontSize: `${textSize(12)}px`, padding: "4px 6px", flexShrink: 0 }}>
                        <ModeStateLabel language={language} state="ready" />
                    </div>
                )}
                {(state === "setup" || state === "never") && (
                    <StatusLink language={language} mode={each} chosen={mode} state={state} onPress={() => props.onStatus(each)} />
                )}
            </Focusable>
        );
    }

    return (
        <Focusable
            flow-children="column"
            style={{
                width: "100%",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                margin: "6px 0 4px 0",
                padding: "3px",
                boxSizing: "border-box",
                borderRadius: "4px",
                background: "rgba(0, 0, 0, 0.3)"
            }}
        >
            {ORDER.map(row)}
        </Focusable>
    );
}
