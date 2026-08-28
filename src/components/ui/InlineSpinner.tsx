export type InlineSpinnerProps = {
    label?: string;
    size?: number;
    bold?: boolean;
};

const SPINNER_KEYFRAMES = `
@keyframes da-inline-spin {
    to { transform: rotate(360deg); }
}
`;

export function InlineSpinner(props: InlineSpinnerProps) {
    const { label, size, bold } = props;
    const dimension = size ?? 14;

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: "8px"
            }}
        >
            <style>{SPINNER_KEYFRAMES}</style>
            <div
                style={{
                    width: `${dimension}px`,
                    height: `${dimension}px`,
                    border: "2px solid rgba(255, 255, 255, 0.25)",
                    borderTopColor: "rgba(255, 255, 255, 0.95)",
                    borderRadius: "50%",
                    animation: "da-inline-spin 0.9s linear infinite",
                    boxSizing: "border-box",
                    flexShrink: 0
                }}
            />
            {label && (
                <span
                    style={{
                        fontSize: "13px",
                        fontWeight: bold ? 700 : undefined,
                        opacity: 0.85,
                        wordBreak: "break-word"
                    }}
                >
                    {label}
                </span>
            )}
        </div>
    );
}
