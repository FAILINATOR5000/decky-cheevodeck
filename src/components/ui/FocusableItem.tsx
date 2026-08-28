import { ButtonItem } from "@decky/ui";
import React, { useLayoutEffect, useRef } from "react";
import { helpDescription } from "./InfoText";

export type FocusableItemProps = {
    focusKey?: string;
    children: React.ReactNode;
    onClick?: () => void | Promise<void>;
    onFocus?: () => void;
    onBlur?: () => void;
    onGamepadFocus?: () => void;
    onGamepadBlur?: () => void;
    onButtonDown?: (evt: { detail?: { button?: number } }) => void;
    onMenuButton?: () => void;
    actionDescriptionMap?: Record<number, React.ReactNode>;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    disabled?: boolean;
    skipWhenDisabled?: boolean;
    autoFocus?: boolean;
    outerStyle?: React.CSSProperties;
    scrollMarginTop?: number;
    bottomSeparator?: "standard" | "thick" | "none";
    help?: React.ReactNode;
    modalHelp?: boolean;
};

export function FocusableItem(props: FocusableItemProps) {
    const { children, onClick, onFocus, onBlur, onGamepadFocus, onGamepadBlur, onButtonDown, onMenuButton, actionDescriptionMap, onMouseEnter, onMouseLeave, disabled, skipWhenDisabled, autoFocus, focusKey, outerStyle, scrollMarginTop, bottomSeparator = "standard", help, modalHelp } = props;
    const wrapperRef = useRef<HTMLDivElement | null>(null);

    function handleFocusCapture() {
        onFocus?.();
    }

    function handleBlurCapture() {
        onBlur?.();
    }

    function handleMouseEnter() {
        onMouseEnter?.();
    }

    function handleMouseLeave() {
        onMouseLeave?.();
    }

    function handleClick() {
        void (onClick ?? function noop() { })();
    }

    useLayoutEffect(() => {
        if (!autoFocus || disabled) {
            return;
        }

        const root = wrapperRef.current?.closest("[data-cheevodeck-root]") as HTMLElement | null;
        const active = document.activeElement as HTMLElement | null;
        if (root && active && root.contains(active)) {
            return;
        }

        const target = wrapperRef.current?.querySelector("button, [tabindex]") as HTMLElement | null;
        if (!target) {
            return;
        }
        target.focus();
    }, [autoFocus, disabled]);

    useLayoutEffect(() => {
        const target = wrapperRef.current?.querySelector("button, [tabindex]") as HTMLElement | null;
        if (!target) {
            return;
        }
        target.style.scrollMarginTop = scrollMarginTop ? `${scrollMarginTop}px` : "";
    }, [scrollMarginTop]);

    return (
        <div
            ref={wrapperRef}
            data-focus-key={focusKey}
            onFocusCapture={handleFocusCapture}
            onBlurCapture={handleBlurCapture}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            style={outerStyle}
        >
            <ButtonItem
                layout="below"
                onClick={handleClick}
                onGamepadFocus={onGamepadFocus}
                onGamepadBlur={onGamepadBlur}
                onButtonDown={onButtonDown}
                onMenuButton={onMenuButton}
                actionDescriptionMap={actionDescriptionMap}
                disabled={disabled}
                focusable={skipWhenDisabled && disabled ? false : undefined}
                bottomSeparator={bottomSeparator}
                description={helpDescription(help, modalHelp)}
            >
                <div style={{ opacity: disabled ? 0.6 : 1 }}>
                    {children}
                </div>
            </ButtonItem>
        </div>
    );
}
