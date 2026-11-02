export const ROOM_STATUSES: { code: string; labelKey: string }[] = [
    { code: "", labelKey: "None" },
    { code: "chill", labelKey: "Chill" },
    { code: "casual", labelKey: "Casual" },
    { code: "competitive", labelKey: "Competitive" },
    { code: "achievements", labelKey: "Achievement Hunting" },
    { code: "fun", labelKey: "Fun" },
    { code: "party", labelKey: "Party Games" },
    { code: "watch", labelKey: "Watch Me Play!" }
];

export function roomStatusLabelKey(code: string): string | null {
    return code ? ROOM_STATUSES.find((entry) => entry.code === code)?.labelKey ?? null : null;
}
