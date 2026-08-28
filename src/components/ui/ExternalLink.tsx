import { Focusable } from "@decky/ui";
import { useState, type ReactNode } from "react";
import { openExternalUrl } from "../../utils/navigation";

export type ExternalLinkProps = {
    url: string;
    onBeforeNavigate?: () => void;
    block?: boolean;
    children: ReactNode;
};

export function ExternalLink(props: ExternalLinkProps) {
    const { url, onBeforeNavigate, block, children } = props;
    const [reactFocused, setReactFocused] = useState(false);
    const [gpFocused, setGpFocused] = useState(false);
    const focused = reactFocused || gpFocused;

    function open() {
        onBeforeNavigate?.();
        void openExternalUrl(url);
    }

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
                onActivate={open}
                onGamepadFocus={() => setGpFocused(true)}
                onGamepadBlur={() => setGpFocused(false)}
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
