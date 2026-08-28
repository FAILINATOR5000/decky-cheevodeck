import { ToggleField } from "@decky/ui";
import React, { type ReactNode } from "react";
import { helpDescription } from "./InfoText";
import { getCurrentTextScale, scaleMultiplier } from "../../utils/scale";

export type ToggleRowProps = {
    label: string;
    value: boolean;
    onChange: (nextValue: boolean) => void | Promise<void>;
    disabled?: boolean;
    outerStyle?: React.CSSProperties;
    bottomSeparator?: "standard" | "thick" | "none";
    help?: ReactNode;
    modalHelp?: boolean;
    controlled?: boolean;
};

export function ToggleRow(props: ToggleRowProps) {
    const { label, value, onChange, disabled, outerStyle, bottomSeparator = "standard", help, modalHelp, controlled } = props;

    function handleChange(nextValue: boolean) {
        if (disabled) {
            return;
        }

        void onChange(nextValue);
    }

    return (
        <div style={outerStyle}>
            <ToggleField
                label={<span style={{ fontSize: `${scaleMultiplier(getCurrentTextScale())}em` }}>{label}</span>}
                description={helpDescription(help, modalHelp)}
                checked={value}
                controlled={controlled}
                disabled={disabled}
                bottomSeparator={bottomSeparator}
                onChange={handleChange}
            />
        </div>
    );
}
