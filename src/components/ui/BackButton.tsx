import { Focusable, PanelSectionRow } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import { FocusableItem } from "./FocusableItem";
import type { ButtonSpacing } from "../../types";
import { currentJumpToTopToken, subscribeJumpToTop } from "../../utils/jumpToTop";
import { regularButtonSpacingStyle } from "../../utils/style";

export type BackButtonProps = {
    label: string;
    focusKey: string;
    buttonSpacing?: ButtonSpacing;
    onClick: () => void | Promise<void>;
    disabled?: boolean;
    scrollMarginTop?: number;
    autoFocus?: boolean;
    navAutoFocus?: boolean;
    bottomSeparator?: "standard" | "thick" | "none";
};

export function BackButton(props: BackButtonProps) {
    const [jumpToken, setJumpToken] = useState(currentJumpToTopToken);
    const initialJumpTokenRef = useRef(jumpToken);
    useEffect(() => subscribeJumpToTop(setJumpToken), []);

    function handleClick() {
        void props.onClick();
    }

    const row = (
        <PanelSectionRow>
            <FocusableItem
                outerStyle={
                    props.buttonSpacing ? regularButtonSpacingStyle(props.buttonSpacing) : undefined
                }
                focusKey={props.focusKey}
                onClick={handleClick}
                disabled={props.disabled}
                autoFocus={props.autoFocus}
                scrollMarginTop={props.scrollMarginTop}
                bottomSeparator={props.bottomSeparator}
            >
                {props.label}
            </FocusableItem>
        </PanelSectionRow>
    );

    const jumped = jumpToken !== initialJumpTokenRef.current;
    if (!props.navAutoFocus && !jumped) {
        return row;
    }

    return <Focusable key={`jump:${jumpToken}`} autoFocus>{row}</Focusable>;
}
