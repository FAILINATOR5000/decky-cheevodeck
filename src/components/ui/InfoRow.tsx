import { bodyTextStyle } from "../../utils/style";

export function InfoRow(props: { label: string; value: string }) {
    if (!props.value) {
        return null;
    }
    return (
        <div
            style={{
                width: "100%",
                display: "flex",
                justifyContent: "space-between",
                gap: "10px",
                alignItems: "baseline"
            }}
        >
            <span style={{ fontWeight: 700, flexShrink: 0 }}>{props.label}</span>
            <span style={{ ...bodyTextStyle(), textAlign: "right" }}>
                {props.value}
            </span>
        </div>
    );
}
