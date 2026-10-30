import { DialogButton, Focusable } from "@decky/ui";
import { useState } from "react";

import { FocusTarget } from "../ui/FocusTarget";
import { ButtonPrompt, GlyphGroup } from "../ui/ButtonPrompt";
import { t, type LanguageCode } from "../../locales";
import { textSize } from "../../utils/scale";
import { bodyTextStyle } from "../../utils/style";

const DIR_UP = 9;
const DIR_DOWN = 10;

type DigitPickerProps = {
    language: LanguageCode;
    digits: string;
    onChange: (digits: string) => void;
    focusPrefix: string;
    groupSize?: number;
    fallbacks: string[];
};

export function DigitPicker(props: DigitPickerProps) {
    const { language, digits, onChange, focusPrefix, groupSize } = props;
    const [editing, setEditing] = useState<number | null>(null);

    function step(index: number, by: number) {
        const current = Number(digits[index] ?? "0");
        const next = String((current + by + 10) % 10);
        onChange(digits.slice(0, index) + next + digits.slice(index + 1));
    }

    function handleButtonDown(index: number, evt: { detail?: { button?: number }; stopPropagation?: () => void }) {
        if (editing !== index) {
            return;
        }
        const button = evt?.detail?.button;
        if (button !== DIR_UP && button !== DIR_DOWN) {
            return;
        }
        evt.stopPropagation?.();
        step(index, button === DIR_UP ? 1 : -1);
    }

    const cellSize = textSize(26);
    const cells = Array.from(digits);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: `${textSize(4)}px` }}>
            <Focusable flow-children="row" style={{ display: "flex", flexWrap: "wrap", gap: `${textSize(4)}px` }}>
                {cells.map((digit, index) => {
                    const key = `${focusPrefix}:${index}`;
                    const neighbors = [`${focusPrefix}:${index + 1}`, `${focusPrefix}:${index - 1}`]
                        .filter((_, which) => (which === 0 ? index + 1 < cells.length : index > 0));
                    const gapAfter = groupSize && (index + 1) % groupSize === 0 && index + 1 < cells.length;
                    return (
                        <div key={key} style={{ display: "flex", marginRight: gapAfter ? `${textSize(8)}px` : 0 }}>
                            <FocusTarget focusKey={key} focusFallback={[...neighbors, ...props.fallbacks]}>
                                <DialogButton
                                    onClick={() => setEditing(editing === index ? null : index)}
                                    onButtonDown={(evt: { detail?: { button?: number }; stopPropagation?: () => void }) =>
                                        handleButtonDown(index, evt)}
                                    onCancelButton={editing === index ? () => setEditing(null) : undefined}
                                    onGamepadBlur={() => {
                                        if (editing === index) {
                                            setEditing(null);
                                        }
                                    }}
                                    style={{
                                        minWidth: 0,
                                        width: `${cellSize}px`,
                                        height: `${cellSize + textSize(8)}px`,
                                        padding: 0,
                                        fontSize: `${textSize(16)}px`,
                                        fontWeight: 700,
                                        outline: editing === index ? "2px solid rgba(255,255,255,0.85)" : undefined
                                    }}
                                >
                                    {digit}
                                </DialogButton>
                            </FocusTarget>
                        </div>
                    );
                })}
            </Focusable>
            {editing !== null && (
                <div style={bodyTextStyle()}>
                    <ButtonPrompt
                        language={language}
                        textKey="help_multiplayer_digit_edit"
                        fontSize={textSize(12)}
                        groups={[
                            <GlyphGroup key="dpad" buttons={["dpadUp", "dpadDown"]} fontSize={textSize(12)} />,
                            <GlyphGroup key="a" buttons={["a"]} fontSize={textSize(12)} />
                        ]}
                    />
                </div>
            )}
            {editing === null && cells.length > 4 && (
                <div style={bodyTextStyle()}>{t(language, "help_multiplayer_ip_digits")}</div>
            )}
        </div>
    );
}
