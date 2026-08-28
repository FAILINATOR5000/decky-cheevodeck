export type LoadingOverlayProps = {
    loading: boolean;
    overlayText: string | null;
    loadingText: string;
};

const SPINNER_KEYFRAMES = `
@keyframes da-loading-spin {
    to { transform: rotate(360deg); }
}
`;

export function LoadingOverlay(props: LoadingOverlayProps) {
    const { loading, overlayText, loadingText } = props;

    if (!loading && !overlayText) {
        return null;
    }

    return (
        <div
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                width: "100vw",
                height: "100vh",
                background: "rgba(0, 0, 0, 0.82)",
                zIndex: 9999,
                pointerEvents: "all",
                overflow: "hidden",
                boxSizing: "border-box"
            }}
        >
            <style>{SPINNER_KEYFRAMES}</style>
            <div
                style={{
                    position: "absolute",
                    top: "16px",
                    left: "16px",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px"
                }}
            >
                <div
                    style={{
                        width: "18px",
                        height: "18px",
                        border: "2px solid rgba(255, 255, 255, 0.25)",
                        borderTopColor: "rgba(255, 255, 255, 0.95)",
                        borderRadius: "50%",
                        animation: "da-loading-spin 0.9s linear infinite",
                        boxSizing: "border-box",
                        flexShrink: 0
                    }}
                />
                <span
                    style={{
                        fontWeight: 600,
                        fontSize: "16px",
                        color: "rgba(255, 255, 255, 0.95)",
                        wordBreak: "break-word"
                    }}
                >
                    {overlayText || loadingText}
                </span>
            </div>
        </div>
    );
}
