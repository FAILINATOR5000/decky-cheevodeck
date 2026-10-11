import { DialogButton } from "@decky/ui";
import { FocusTarget } from "./FocusTarget";

type CollapseToggleButtonProps = {
    collapsed: boolean;
    focusKey: string;
    focusFallback?: string[];
    disabled?: boolean;
    onToggle: () => void;
    onGamepadFocus?: () => void;
    onGamepadDirection?: (evt: { detail?: { button?: number } }) => boolean | void;
};

export function CollapseToggleButton(props: CollapseToggleButtonProps) {
    return (
        <FocusTarget focusKey={props.focusKey} focusFallback={props.focusFallback} style={{ flexShrink: 0 }}>
            <DialogButton
                onClick={props.onToggle}
                disabled={props.disabled}
                onGamepadFocus={props.onGamepadFocus}
                onGamepadDirection={props.onGamepadDirection}
                style={{
                    minWidth: 0,
                    minHeight: 0,
                    width: "32px",
                    height: "22px",
                    padding: "0",
                    lineHeight: "22px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    ...(props.disabled ? { opacity: 0.6 } : {})
                }}
            >
                {props.collapsed ? "+" : "−"}
            </DialogButton>
        </FocusTarget>
    );
}
