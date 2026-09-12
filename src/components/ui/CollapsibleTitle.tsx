import { DialogButton } from "@decky/ui";

export type CollapsibleTitleProps = {
    label: string;
    collapsed: boolean;
    focusKey: string;
    disabled?: boolean;
    onToggle: () => void;
};

export function CollapsibleTitle(props: CollapsibleTitleProps) {
    return (
        <div style={{ display: "flex", width: "100%", alignItems: "center", gap: "8px" }}>
            <div style={{ flex: 1, minWidth: 0, overflowWrap: "break-word" }}>
                {props.label}
            </div>
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
        </div>
    );
}
