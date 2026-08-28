import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { FocusableItem } from "./FocusableItem";
import type { ButtonSpacing } from "../../types";
import { regularButtonSpacingStyle, confirmAmber } from "../../utils/style";

export type TripleConfirmRowProps = {
    focusKey: string;
    idleLabel: string;
    armedLabel2: string;
    armedLabel3: string;
    disabled: boolean;
    onConfirm: () => void | Promise<void>;
    busy?: boolean;
    busyLabel?: string;
    buttonSpacing?: ButtonSpacing;
    bottomSeparator?: "standard" | "thick" | "none";
    labelStyle?: CSSProperties;
    help?: ReactNode;
};

export function TripleConfirmRow(props: TripleConfirmRowProps) {
    const { focusKey, idleLabel, armedLabel2, armedLabel3, disabled, onConfirm, busy, busyLabel, buttonSpacing, bottomSeparator, labelStyle, help } = props;
    const [step, setStep] = useState(0);

    const locked = disabled || Boolean(busy);

    useEffect(() => {
        if (locked && step !== 0) {
            setStep(0);
        }
    }, [locked, step]);

    function handleClick() {
        if (locked) {
            return;
        }
        if (step < 2) {
            setStep(step + 1);
            return;
        }
        setStep(0);
        void onConfirm();
    }

    function handleBlur() {
        setStep(0);
    }

    const label = busy && busyLabel
            ? busyLabel
            : step === 0 ? idleLabel : step === 1 ? armedLabel2 : armedLabel3;
    const color = busy ? undefined : step === 0 ? undefined : step === 1 ? confirmAmber : "#ff6b5e";

    return (
        <FocusableItem
            outerStyle={buttonSpacing ? regularButtonSpacingStyle(buttonSpacing) : undefined}
            focusKey={focusKey}
            disabled={locked}
            onClick={handleClick}
            onBlur={handleBlur}
            onGamepadBlur={handleBlur}
            bottomSeparator={bottomSeparator}
            help={help}
        >
            <span style={{ fontWeight: 700, ...labelStyle, color }}>
                {label}
            </span>
        </FocusableItem>
    );
}
