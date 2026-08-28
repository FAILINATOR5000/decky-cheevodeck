import React from "react";
import { PanelSectionRow } from "@decky/ui";
import { ConfirmRow } from "../ui/ConfirmRow";
import { FocusableItem } from "../ui/FocusableItem";
import { LabeledRow } from "../ui/LabeledRow";
import { ToggleRow } from "../ui/ToggleRow";
import { TripleConfirmRow } from "../ui/TripleConfirmRow";
import type { ButtonSpacing } from "../../types";
import { getCurrentTextScale, scaleMultiplier } from "../../utils/scale";

function optionLabelStyle(): React.CSSProperties {
    return {
        fontSize: `${scaleMultiplier(getCurrentTextScale())}em`,
        fontWeight: "inherit"
    };
}

function separatorFor(separator: boolean | undefined): "standard" | "none" {
    return separator ? "standard" : "none";
}

export type OptionButtonProps = {
    focusKey: string;
    label: string;
    help?: React.ReactNode;
    separator?: boolean;
    onClick: () => void | Promise<void>;
    disabled?: boolean;
    outerStyle?: React.CSSProperties;
    onGamepadFocus?: () => void;
};

export function OptionButton(props: OptionButtonProps) {
    const { focusKey, label, help, separator, onClick, disabled, outerStyle, onGamepadFocus } = props;

    return (
        <PanelSectionRow>
            <FocusableItem
                outerStyle={outerStyle}
                bottomSeparator={separatorFor(separator)}
                focusKey={focusKey}
                onClick={onClick}
                onGamepadFocus={onGamepadFocus}
                disabled={disabled}
                help={help}
            >
                {label}
            </FocusableItem>
        </PanelSectionRow>
    );
}

export type OptionToggleProps = {
    label: string;
    help?: React.ReactNode;
    separator?: boolean;
    value: boolean;
    onChange: (nextValue: boolean) => void | Promise<void>;
    disabled?: boolean;
    outerStyle?: React.CSSProperties;
    controlled?: boolean;
};

export function OptionToggle(props: OptionToggleProps) {
    const { label, help, separator, value, onChange, disabled, outerStyle, controlled } = props;

    return (
        <PanelSectionRow>
            <ToggleRow
                outerStyle={outerStyle}
                bottomSeparator={separatorFor(separator)}
                label={label}
                help={help}
                value={value}
                controlled={controlled}
                onChange={onChange}
                disabled={disabled}
            />
        </PanelSectionRow>
    );
}

export type OptionValueRowProps = {
    focusKey: string;
    label: React.ReactNode;
    help?: React.ReactNode;
    separator?: boolean;
    value: React.ReactNode;
    onClick: () => void | Promise<void>;
    disabled?: boolean;
    outerStyle?: React.CSSProperties;
    accentColor?: string;
    onButtonDown?: (evt: { detail?: { button?: number } }) => void;
};

export function OptionValueRow(props: OptionValueRowProps) {
    const { focusKey, label, help, separator, value, onClick, disabled, outerStyle, accentColor, onButtonDown } = props;

    return (
        <LabeledRow
            outerStyle={outerStyle}
            bottomSeparator={separatorFor(separator)}
            focusKey={focusKey}
            onClick={onClick}
            onButtonDown={onButtonDown}
            disabled={disabled}
            label={label}
            help={help}
            value={value}
            accentColor={accentColor}
            labelStyle={optionLabelStyle()}
        />
    );
}

export type OptionConfirmProps = {
    focusKey: string;
    idleLabel: string;
    armedLabel: string;
    help?: React.ReactNode;
    separator?: boolean;
    onConfirm: () => void | Promise<void>;
    disabled: boolean;
    buttonSpacing: ButtonSpacing;
};

export function OptionConfirm(props: OptionConfirmProps) {
    const { focusKey, idleLabel, armedLabel, help, separator, onConfirm, disabled, buttonSpacing } = props;

    return (
        <PanelSectionRow>
            <ConfirmRow
                buttonSpacing={buttonSpacing}
                bottomSeparator={separatorFor(separator)}
                help={help}
                focusKey={focusKey}
                idleLabel={idleLabel}
                armedLabel={armedLabel}
                onConfirm={onConfirm}
                disabled={disabled}
                labelStyle={optionLabelStyle()}
            />
        </PanelSectionRow>
    );
}

export type OptionTripleConfirmProps = {
    focusKey: string;
    idleLabel: string;
    armedLabel2: string;
    armedLabel3: string;
    help?: React.ReactNode;
    separator?: boolean;
    onConfirm: () => void | Promise<void>;
    disabled: boolean;
    buttonSpacing: ButtonSpacing;
    busy?: boolean;
    busyLabel?: string;
};

export function OptionTripleConfirm(props: OptionTripleConfirmProps) {
    const { focusKey, idleLabel, armedLabel2, armedLabel3, help, separator, onConfirm, disabled, buttonSpacing, busy, busyLabel } = props;

    return (
        <PanelSectionRow>
            <TripleConfirmRow
                buttonSpacing={buttonSpacing}
                bottomSeparator={separatorFor(separator)}
                help={help}
                focusKey={focusKey}
                idleLabel={idleLabel}
                armedLabel2={armedLabel2}
                armedLabel3={armedLabel3}
                busy={busy}
                busyLabel={busyLabel}
                onConfirm={onConfirm}
                disabled={disabled}
                labelStyle={optionLabelStyle()}
            />
        </PanelSectionRow>
    );
}
