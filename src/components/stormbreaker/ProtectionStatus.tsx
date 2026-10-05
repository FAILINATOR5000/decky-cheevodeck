// Font Awesome Free icons, CC BY 4.0. See ATTRIBUTIONS.md.
import { FaShieldAlt } from "react-icons/fa";

import { t, type LanguageCode } from "../../locales";
import type { FreezeIncidentTotals } from "../../types";
import { bannerSize } from "../../utils/scale";
import { achievementGreen, bodyTextStyle, errorRed, masteredGold } from "../../utils/style";

export type ProtectionLevel = "protected" | "partial" | "unprotected";

export function protectionLevel(input: {
    stormbreaker: boolean;
    automaticRecovery: boolean;
    standingDown: boolean;
    claimStormbreaker: boolean;
    claimAutomaticRecovery: boolean;
}): ProtectionLevel {
    const breaker = input.stormbreaker || input.claimStormbreaker;
    const recovery = (input.automaticRecovery && !input.standingDown) || input.claimAutomaticRecovery;
    if (breaker && recovery) {
        return "protected";
    }
    return breaker || recovery ? "partial" : "unprotected";
}

const LEVELS: Record<ProtectionLevel, { labelKey: string; color: string }> = {
    protected: { labelKey: "Protected", color: achievementGreen },
    partial: { labelKey: "Partially Protected", color: masteredGold },
    unprotected: { labelKey: "Unprotected", color: errorRed }
};

export function ProtectionStatus(props: {
    language: LanguageCode;
    level: ProtectionLevel;
    totals: FreezeIncidentTotals;
    standingDown: boolean;
    loaded: boolean;
}) {
    const { language, level, totals } = props;
    const { labelKey, color } = LEVELS[level];
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "10px 0 6px 0" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                <div style={{ fontSize: `${bannerSize(22)}px`, fontWeight: 800, color, textAlign: "center" }}>
                    {t(language, labelKey)}
                </div>
                <FaShieldAlt size={bannerSize(64)} color={color} />
            </div>
            <div style={{ ...bodyTextStyle(13), visibility: props.loaded ? "visible" : "hidden" }}>
                <div>{t(language, "QAM Freezes Prevented: {{count}}", { count: totals.prevented })}</div>
                <div>{t(language, "Steam Freezes Recovered: {{count}}", { count: totals.recovered })}</div>
                {props.standingDown && (
                    <div>{t(language, "Automatic Recovery paused until the plugin reloads")}</div>
                )}
            </div>
        </div>
    );
}
