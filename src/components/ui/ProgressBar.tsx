import { skyBlue } from "../../utils/style";

const TRACK_HEIGHT_PX = 6;

const SWEEP_WIDTH_PCT = 30;

const SWEEP_KEYFRAMES = `
@keyframes da-progress-sweep {
    from { transform: translateX(-100%); }
    to { transform: translateX(400%); }
}
@media (prefers-reduced-motion: reduce) {
    .da-progress-sweep {
        animation: none !important;
        width: 100% !important;
        opacity: 0.45;
    }
}
`;

export type ProgressBarProps = {
    fraction: number | null;
};

export function ProgressBar(props: ProgressBarProps) {
    const { fraction } = props;
    const sweeping = fraction === null;
    const filled = sweeping ? SWEEP_WIDTH_PCT : Math.min(1, Math.max(0, fraction)) * 100;

    return (
        <div
            style={{
                width: "100%",
                height: `${TRACK_HEIGHT_PX}px`,
                borderRadius: "999px",
                background: "rgba(255, 255, 255, 0.14)",
                overflow: "hidden"
            }}
        >
            <style>{SWEEP_KEYFRAMES}</style>
            <div
                className={sweeping ? "da-progress-sweep" : undefined}
                style={{
                    width: `${filled}%`,
                    height: "100%",
                    borderRadius: "999px",
                    background: skyBlue,
                    animation: sweeping ? "da-progress-sweep 1.4s ease-in-out infinite" : undefined,
                    transition: sweeping ? undefined : "width 300ms linear"
                }}
            />
        </div>
    );
}
