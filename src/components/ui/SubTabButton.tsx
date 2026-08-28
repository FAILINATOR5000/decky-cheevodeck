import { DialogButton } from "@decky/ui";

export type SubTabButtonProps = {
    label: string;
    active: boolean;
    onClick: () => void;
    focusKey: string;
};

export function SubTabButton(props: SubTabButtonProps) {
    return (
        <div data-focus-key={props.focusKey} style={{ display: "flex", flex: 1 }}>
            <DialogButton
                onClick={props.onClick}
                style={{
                    minWidth: 0,
                    width: "100%",
                    padding: "4px 10px",
                    fontSize: "13px",
                    fontWeight: props.active ? 800 : 600,
                    opacity: props.active ? 1 : 0.72,
                    outline: props.active ? "1px solid rgba(255,255,255,0.65)" : undefined
                }}
            >
                {props.label}
            </DialogButton>
        </div>
    );
}
