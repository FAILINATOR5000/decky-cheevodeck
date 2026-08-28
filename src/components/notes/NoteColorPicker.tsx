import { DialogButton, Focusable } from "@decky/ui";
import type React from "react";
import type { NoteColor } from "../../types";
import { NOTE_COLOR_OPTIONS, noteBodyColor, noteColorIsTransparent } from "../../utils/achievements";

export type NoteColorPickerProps = {
    selectedColor: NoteColor;
    disabled: boolean;
    onChange: (color: NoteColor) => void;
};

const CHECKERBOARD_STYLE: React.CSSProperties = {
    backgroundColor: "#4b5563",
    backgroundImage:
        "linear-gradient(45deg, #9ca3af 25%, transparent 25%), "
        + "linear-gradient(-45deg, #9ca3af 25%, transparent 25%), "
        + "linear-gradient(45deg, transparent 75%, #9ca3af 75%), "
        + "linear-gradient(-45deg, transparent 75%, #9ca3af 75%)",
    backgroundSize: "8px 8px",
    backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0"
};

export function NoteColorPicker(props: NoteColorPickerProps) {
    const { selectedColor, disabled, onChange } = props;

    return (
        <Focusable
            style={{
                display: "flex",
                flexDirection: "row",
                gap: "8px",
                flexWrap: "wrap",
                alignItems: "center"
            }}
            flow-children="grid"
        >
            {NOTE_COLOR_OPTIONS.map((color) => {
                const isSelected = selectedColor === color;
                const fillStyle: React.CSSProperties = noteColorIsTransparent(color)
                    ? CHECKERBOARD_STYLE
                    : { backgroundColor: noteBodyColor(color) };
                return (
                    <div key={color} data-focus-key={`notecolor:${color}`}>
                        <DialogButton
                            onClick={() => {
                                if (!disabled) {
                                    onChange(color);
                                }
                            }}
                            disabled={disabled}
                            style={{
                                minWidth: 0,
                                width: "36px",
                                height: "36px",
                                padding: 0,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center"
                            }}
                        >
                            <div
                                style={{
                                    ...fillStyle,
                                    width: "24px",
                                    height: "24px",
                                    borderRadius: "50%",
                                    border: isSelected
                                        ? "2px solid #ffffff"
                                        : "2px solid transparent",
                                    boxSizing: "border-box"
                                }}
                            />
                        </DialogButton>
                    </div>
                );
            })}
        </Focusable>
    );
}
