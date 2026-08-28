import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { FocusableItem } from "./FocusableItem";
import type { ButtonSpacing } from "../../types";
import { regularButtonSpacingStyle, confirmAmber } from "../../utils/style";

export type ConfirmRowProps = {
    focusKey: string;
    idleLabel: string;
    armedLabel: string;
    disabled: boolean;
    onConfirm: () => void | Promise<void>;
    buttonSpacing?: ButtonSpacing;
    bottomSeparator?: "standard" | "thick" | "none";
    labelStyle?: CSSProperties;
    skipWhenDisabled?: boolean;
    help?: ReactNode;
};

export function ConfirmRow(props: ConfirmRowProps) {
    const { focusKey, idleLabel, armedLabel, disabled, onConfirm, buttonSpacing, bottomSeparator, labelStyle, skipWhenDisabled, help } = props;
    const [armed, setArmed] = useState(false);

    useEffect(() => {
        if (disabled && armed) {
            setArmed(false);
        }
    }, [disabled, armed]);

    function handleClick() {
        if (disabled) {
            return;
        }
        if (!armed) {
            setArmed(true);
            return;
        }
        setArmed(false);
        void onConfirm();
    }

    function handleBlur() {
        setArmed(false);
    }

    return (
        <FocusableItem
            outerStyle={buttonSpacing ? regularButtonSpacingStyle(buttonSpacing) : undefined}
            focusKey={focusKey}
            disabled={disabled}
            skipWhenDisabled={skipWhenDisabled}
            onClick={handleClick}
            onBlur={handleBlur}
            onGamepadBlur={handleBlur}
            bottomSeparator={bottomSeparator}
            help={help}
        >
            <span style={{ fontWeight: 700, ...labelStyle, color: armed ? confirmAmber : undefined }}>
                {armed ? armedLabel : idleLabel}
            </span>
        </FocusableItem>
    );
}
