import { CollapseToggleButton } from "./CollapseToggleButton";

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
            <CollapseToggleButton
                collapsed={props.collapsed}
                focusKey={props.focusKey}
                disabled={props.disabled}
                onToggle={props.onToggle}
            />
        </div>
    );
}
