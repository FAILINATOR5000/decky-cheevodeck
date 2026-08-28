import type { AchievementRow } from "../../types";
import { pointsLabel } from "../../utils/achievements";
import type { LanguageCode } from "../../locales";

export const POINTS_LABEL_STYLES = `
.da-points-number { color: rgba(120, 200, 255, 0.95); }
.da-retro-points { color: rgba(255, 255, 255, 0.95); }
[class*="gpfocus"] .da-retro-points,
[class*="GPFocus"] .da-retro-points {
    color: inherit;
}
`;

export function PointsLabel(props: {
    achievement: AchievementRow;
    showRetroPoints: boolean;
    language: LanguageCode;
}) {
    const label = pointsLabel(props.achievement, props.showRetroPoints, props.language);

    if (label.kind === "single") {
        return <>{label.text}</>;
    }

    return (
        <>
            <span className="da-points-number">{label.points}</span>
            {" "}
            <span className="da-retro-points">{label.retroPoints}</span>
        </>
    );
}
