import { DialogButton } from "@decky/ui";
import { FocusTarget } from "./FocusTarget";

export type SubTabButtonProps = {
    label: string;
    active: boolean;
    onClick: () => void;
    focusKey: string;
    focusFallback?: string[];
    disabled?: boolean;
};

export function SubTabButton(props: SubTabButtonProps) {
    return (
        <FocusTarget focusKey={props.focusKey} focusFallback={props.focusFallback} style={{ display: "flex", flex: 1 }}>
            <DialogButton
                onClick={props.onClick}
                disabled={props.disabled}
                style={{
                    minWidth: 0,
                    width: "100%",
                    padding: "4px 10px",
                    fontSize: "13px",
                    fontWeight: props.active ? 800 : 600,
                    opacity: props.disabled ? 0.35 : props.active ? 1 : 0.72,
                    outline: props.active ? "1px solid rgba(255,255,255,0.65)" : undefined
                }}
            >
                {props.label}
            </DialogButton>
        </FocusTarget>
    );
}
