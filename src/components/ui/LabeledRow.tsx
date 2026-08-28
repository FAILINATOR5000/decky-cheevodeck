import React from "react";
import { PanelSectionRow } from "@decky/ui";
import { FocusableItem } from "./FocusableItem";
import { bodyTextStyle } from "../../utils/style";

export type LabeledRowProps = {
    label: React.ReactNode;
    value: React.ReactNode;
    focusKey?: string;
    onClick?: () => void | Promise<void>;
    disabled?: boolean;
    autoFocus?: boolean;
    outerStyle?: React.CSSProperties;
    gap?: number;
    accentColor?: string;
    scrollMarginTop?: number;
    bottomSeparator?: "standard" | "thick" | "none";
    labelStyle?: React.CSSProperties;
    onMenuButton?: () => void;
    onButtonDown?: (evt: { detail?: { button?: number } }) => void;
    actionDescriptionMap?: Record<number, React.ReactNode>;
    help?: React.ReactNode;
    modalHelp?: boolean;
};

export function LabeledRow(props: LabeledRowProps) {
    const {
        label,
        value,
        focusKey,
        onClick,
        disabled,
        autoFocus,
        outerStyle,
        gap = 8,
        accentColor,
        scrollMarginTop,
        bottomSeparator = "standard",
        labelStyle,
        help,
        modalHelp
    } = props;

    const row = (
        <FocusableItem
            onMenuButton={props.onMenuButton}
            onButtonDown={props.onButtonDown}
            actionDescriptionMap={props.actionDescriptionMap}
            outerStyle={outerStyle}
            focusKey={focusKey}
            onClick={onClick}
            disabled={disabled}
            autoFocus={autoFocus}
            scrollMarginTop={scrollMarginTop}
            bottomSeparator={bottomSeparator}
            help={help}
            modalHelp={modalHelp}
        >
            <div
                style={{
                    width: "100%",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: `${gap}px`,
                    borderLeft: accentColor ? `3px solid ${accentColor}` : undefined,
                    paddingLeft: accentColor ? "8px" : undefined
                }}
            >
                <span
                    style={{
                        fontWeight: 700,
                        textAlign: "left",
                        flexShrink: 100,
                        minWidth: "min-content",
                        ...labelStyle
                    }}
                >
                    {label}
                </span>
                <span
                    style={{
                        ...bodyTextStyle(),
                        flexShrink: 1,
                        minWidth: "min-content",
                        whiteSpace: "normal",
                        overflowWrap: "break-word",
                        textAlign: "center"
                    }}
                >
                    {value}
                </span>
            </div>
        </FocusableItem>
    );

    return <PanelSectionRow>{row}</PanelSectionRow>;
}
