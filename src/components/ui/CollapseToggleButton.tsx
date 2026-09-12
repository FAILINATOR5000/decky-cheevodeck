import { DialogButton } from "@decky/ui";

type CollapseToggleButtonProps = {
    collapsed: boolean;
    focusKey: string;
    disabled?: boolean;
    onToggle: () => void;
};

export function CollapseToggleButton(props: CollapseToggleButtonProps) {
    return (
        <div data-focus-key={props.focusKey} style={{ flexShrink: 0 }}>
            <DialogButton
                onClick={props.onToggle}
                disabled={props.disabled}
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
        </div>
    );
}
