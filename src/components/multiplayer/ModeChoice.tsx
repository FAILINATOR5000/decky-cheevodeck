import { DialogButton, Focusable } from "@decky/ui";
import { useState } from "react";

import { t, type LanguageCode } from "../../locales";
import type { MultiplayerMode } from "../../types";
import { textSize } from "../../utils/scale";
import { achievementGreen } from "../../utils/style";
import { FocusTarget } from "../ui/FocusTarget";

type ModeEntry = { mode: MultiplayerMode; labelKey: string; focusKey: string };

const MODES: ModeEntry[] = [
    { mode: "link", labelKey: "Link Play", focusKey: "multiplayer:mode:link" },
    { mode: "couch", labelKey: "Couch Play", focusKey: "multiplayer:mode:couch" }
];
const STREAM: ModeEntry = { mode: "stream", labelKey: "Stream Play", focusKey: "multiplayer:mode:stream" };

export function ModeChoice(props: {
    language: LanguageCode;
    mode: MultiplayerMode;
    locked: boolean;
    onChoose: (mode: MultiplayerMode) => void;
}) {
    const { language, mode, locked } = props;
    const [focused, setFocused] = useState<MultiplayerMode | null>(null);

    function choice(entry: ModeEntry) {
        const chosen = entry.mode === mode;
        const disabled = locked && !chosen;
        const hasCursor = focused === entry.mode;
        return (
            <FocusTarget
                key={entry.mode}
                focusKey={entry.focusKey}
                focusFallback={entry.mode === "stream" ? [`multiplayer:mode:${mode}`, "multiplayer:mode:link"] : undefined}
                style={{ display: "flex", flex: 1 }}
            >
                <DialogButton
                    onClick={() => props.onChoose(entry.mode)}
                    focusable={!disabled}
                    onGamepadFocus={() => setFocused(entry.mode)}
                    onGamepadBlur={() => setFocused((current) => current === entry.mode ? null : current)}
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
                        justifyContent: "center",
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
                    {t(language, entry.labelKey)}
                </DialogButton>
            </FocusTarget>
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
            <Focusable flow-children="row" style={{ display: "flex", gap: "4px" }}>
                {MODES.map(choice)}
            </Focusable>
            {choice(STREAM)}
        </Focusable>
    );
}
