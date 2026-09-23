import { Focusable } from "@decky/ui";
import { useState, type ReactNode } from "react";

type ActionLinkProps = {
    onActivate: () => void;
    onOKActionDescription?: string;
    onOptionsButton?: () => void;
    onOptionsActionDescription?: string;
    onSecondaryButton?: () => void;
    onSecondaryActionDescription?: string;
    onButtonDown?: (event: { detail?: { button?: number; is_repeat?: boolean } }) => void;
    actionDescriptionMap?: Record<number, ReactNode>;
    onGamepadFocus?: () => void;
    onGamepadBlur?: () => void;
    block?: boolean;
    children: ReactNode;
};

export function ActionLink(props: ActionLinkProps) {
    const {
        onActivate,
        onOKActionDescription,
        onOptionsButton,
        onOptionsActionDescription,
        onSecondaryButton,
        onSecondaryActionDescription,
        onButtonDown,
        actionDescriptionMap,
        onGamepadFocus,
        onGamepadBlur,
        block,
        children
    } = props;

    const [reactFocused, setReactFocused] = useState(false);
    const [gpFocused, setGpFocused] = useState(false);
    const focused = reactFocused || gpFocused;

    return (
        <div
            onFocusCapture={() => setReactFocused(true)}
            onBlurCapture={() => setReactFocused(false)}
            style={{
                display: block ? "block" : "inline-block",
                width: block ? "100%" : undefined
            }}
        >
            <Focusable
                onActivate={onActivate}
                onOKActionDescription={onOKActionDescription}
                onOptionsButton={onOptionsButton}
                onOptionsActionDescription={onOptionsActionDescription}
                onSecondaryButton={onSecondaryButton}
                onSecondaryActionDescription={onSecondaryActionDescription}
                onButtonDown={onButtonDown}
                actionDescriptionMap={actionDescriptionMap}
                onGamepadFocus={() => {
                    setGpFocused(true);
                    onGamepadFocus?.();
                }}
                onGamepadBlur={() => {
                    setGpFocused(false);
                    onGamepadBlur?.();
                }}
                style={{
                    display: block ? "block" : "inline-block",
                    width: block ? "100%" : undefined,
                    boxSizing: block ? "border-box" : undefined,
                    padding: block ? "4px 6px" : undefined,
                    borderRadius: "3px",
                    color: focused ? "#8fc4ff" : "#4ea1ff",
                    textDecoration: "underline",
                    cursor: "pointer",
                    backgroundColor: focused ? "rgba(255, 255, 255, 0.14)" : "transparent",
                    outline: focused ? "2px solid rgba(255, 255, 255, 0.9)" : "2px solid transparent"
                }}
            >
                {children}
            </Focusable>
        </div>
    );
}
