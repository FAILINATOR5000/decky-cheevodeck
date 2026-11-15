import { Focusable } from "@decky/ui";
import { useState, type CSSProperties, type ReactNode } from "react";

import { FocusTarget } from "./FocusTarget";

export function HeadingStop(props: {
    focusKey: string;
    autoFocus?: boolean;
    style?: CSSProperties;
    outerStyle?: CSSProperties;
    onGamepadFocus?: () => void;
    onGamepadDirection?: (evt: { detail?: { button?: number } }) => boolean | void;
    children: ReactNode;
}) {
    const [focused, setFocused] = useState(false);
    return (
        <FocusTarget focusKey={props.focusKey} style={{ display: "flex", ...props.outerStyle }}>
            <Focusable
                onActivate={() => { }}
                noFocusRing={true}
                autoFocus={props.autoFocus}
                onGamepadFocus={() => {
                    setFocused(true);
                    props.onGamepadFocus?.();
                }}
                onGamepadBlur={() => setFocused(false)}
                onGamepadDirection={props.onGamepadDirection}
                style={{
                    ...props.style,
                    borderRadius: "3px",
                    outlineOffset: "3px",
                    backgroundColor: focused ? "rgba(255, 255, 255, 0.14)" : "transparent",
                    outline: focused ? "2px solid rgba(255, 255, 255, 0.9)" : "2px solid transparent"
                }}
            >
                {props.children}
            </Focusable>
        </FocusTarget>
    );
}
