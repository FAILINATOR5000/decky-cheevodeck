import type { RankTier } from "../../types";

const NUMERALS = ["I", "II", "III", "IV"];

const NUMERAL_MIN_SIZE = 32;

const LAUREL_LEAVES: [number, number, number][] = [
    [14.88, 44.15, -192.8], [16.03, 41.7, -116.8], [11.3, 41.25, -176.8], [13.09, 39.21, -100.8],
    [8.71, 37.48, -160.6], [10.99, 36.02, -84.6], [7.05, 32.94, -146.5], [9.62, 32.08, -70.5],
    [6.23, 27.68, -135.3], [8.91, 27.34, -59.3], [6.19, 21.66, -126.9], [8.9, 21.72, -50.9],
    [6.92, 14.84, -120.5], [9.61, 15.2, -44.5]
];

const BLADES = [
    "M14 12L0.5 2.5L4 10L14 17Z",
    "M14 16L0 11L3.5 17.5L14 21Z",
    "M14 20.5L1 20L5 25L14 25Z",
    "M14 25L3.5 29L8.5 31.5L14 29Z"
];

function Laurel() {
    return (
        <>
            <path d="M21 45Q3 41 9 11" fill="none" stroke="#d97706" strokeWidth="1.2" strokeLinecap="round" />
            {LAUREL_LEAVES.map(([cx, cy, angle]) => (
                <ellipse key={`${cx}:${cy}`} cx={cx} cy={cy} rx="2.4" ry="1.15" transform={`rotate(${angle} ${cx} ${cy})`} fill="#f59e0b" />
            ))}
        </>
    );
}

function Blades() {
    return (
        <>
            {BLADES.map((d) => (
                <path key={d} d={d} fill="#1f2937" stroke="#fbbf24" strokeWidth="0.7" strokeLinejoin="round" />
            ))}
        </>
    );
}

function shield(tier: RankTier) {
    switch (tier) {
        case "tracker":
            return (
                <>
                    <path d="M24 4L39.5 8.8V22C39.5 35.2 30.2 41.2 24 44C17.8 41.2 8.5 35.2 8.5 22V8.8Z" fill="#64748b" stroke="#94a3b8" strokeWidth="1.6" />
                    <path d="M24 8L35.5 11.72V21.95C35.5 32.18 28.6 36.83 24 39C19.4 36.83 12.5 32.18 12.5 21.95V11.72Z" fill="#0b1220" opacity="0.28" />
                </>
            );
        case "hunter":
            return (
                <>
                    <path d="M24 3L41 8.04V21.9C41 35.76 30.8 42.06 24 45C17.2 42.06 7 35.76 7 21.9V8.04Z" fill="#0ea5e9" />
                    <path d="M24 7.5L37 11.46V22.35C37 33.24 29.2 38.19 24 40.5C18.8 38.19 11 33.24 11 22.35V11.46Z" fill="#0b1220" opacity="0.4" />
                </>
            );
        case "expert":
            return (
                <>
                    <path d="M8 6L16 9L24 4L32 9L40 6V22C40 33 33 40.5 24 45C15 40.5 8 33 8 22Z" fill="#a855f7" />
                    <path d="M12 10.5L17 12.3L24 8.8L31 12.3L36 10.5V22C36 30.5 30.8 36.5 24 40C17.2 36.5 12 30.5 12 22Z" fill="#0b1220" opacity="0.42" />
                    <path d="M14 28L24 34L34 28" fill="none" stroke="#e9d5ff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
                </>
            );
        case "master":
            return (
                <>
                    <Laurel />
                    <g transform="translate(48 0) scale(-1 1)">
                        <Laurel />
                    </g>
                    <path d="M24 9L37 13.08V24.3C37 35.52 29.2 40.62 24 43C18.8 40.62 11 35.52 11 24.3V13.08Z" fill="#fbbf24" />
                    <path d="M24 12.5L33.75 15.62V24.2C33.75 32.78 27.9 36.68 24 38.5C20.1 36.68 14.25 32.78 14.25 24.2V15.62Z" fill="#0b1220" opacity="0.38" />
                    <polygon points="24,1 25.06,3.74 27.99,3.9 25.71,5.76 26.47,8.6 24,7 21.53,8.6 22.29,5.76 20.01,3.9 22.94,3.74" fill="#fde68a" />
                </>
            );
        case "legend":
            return (
                <>
                    <Blades />
                    <g transform="translate(48 0) scale(-1 1)">
                        <Blades />
                    </g>
                    <path d="M24 8L36.5 12.74V25.78C36.5 38.81 29 44.74 24 47.5C19 44.74 11.5 38.81 11.5 25.78V12.74Z" fill="#dc2626" stroke="#fbbf24" strokeWidth="2" />
                    <path d="M24 12L33 15.6V25.5C33 35.4 27.6 39.9 24 42C20.4 39.9 15 35.4 15 25.5V15.6Z" fill="#0b1220" opacity="0.42" />
                    <path d="M14 16L24 21L34 16M16 33L24 38L32 33" fill="none" stroke="#fbbf24" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
                    <path d="M15.5 10L16.5 2.5L20 6.5L24 0.5L28 6.5L31.5 2.5L32.5 10Z" fill="#fbbf24" stroke="#b45309" strokeWidth="0.6" strokeLinejoin="round" />
                    <circle cx="24" cy="7.6" r="1.2" fill="#dc2626" />
                </>
            );
    }
}

const NUMERAL_SPOT: Record<RankTier, { y: number; size: number; fill: string }> = {
    tracker: { y: 22.5, size: 13, fill: "#e2e8f0" },
    hunter: { y: 22.5, size: 13, fill: "#ffffff" },
    expert: { y: 21, size: 12, fill: "#ffffff" },
    master: { y: 26, size: 11, fill: "#ffffff" },
    legend: { y: 26, size: 12, fill: "#ffffff" }
};

export function RankEmblem(props: { tier: RankTier; step: number; size: number }) {
    const { tier, step, size } = props;
    const spot = NUMERAL_SPOT[tier];
    return (
        <svg
            viewBox="0 0 48 48"
            width={size}
            height={size}
            xmlns="http://www.w3.org/2000/svg"
            focusable="false"
            style={{ display: "block", flexShrink: 0 }}
        >
            {shield(tier)}
            {size >= NUMERAL_MIN_SIZE && (
                <text
                    x="24"
                    y={spot.y}
                    fontWeight="800"
                    fontSize={spot.size}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={spot.fill}
                    style={{ fontFamily: "inherit" }}
                >
                    {NUMERALS[step - 1] ?? String(step)}
                </text>
            )}
        </svg>
    );
}

export function rankNumeral(step: number): string {
    return NUMERALS[step - 1] ?? String(step);
}
