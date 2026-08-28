import type { AotwUnlock } from "../../types";
import type { LanguageCode } from "../../locales";
import { t } from "../../locales";
import { FocusableItem } from "../ui/FocusableItem";
import { HardcoreBadge } from "../achievements/HardcoreBadge";
import { UserAvatar } from "../ui/UserAvatar";
import { formatInteger } from "../../utils/format";
import { formatUnlockDate } from "../../utils/achievements";
import { type AchievementUiMetrics, smallTextStyle } from "../../utils/style";

export type AotwUnlockRowProps = {
    unlock: AotwUnlock;
    language: LanguageCode;
    metrics: AchievementUiMetrics;
    showIcons: boolean;
    focusKey: string;
    onClick: (unlock: AotwUnlock) => void | Promise<void>;
};

export function AotwUnlockRow(props: AotwUnlockRowProps) {
    const { unlock, language, metrics, showIcons, focusKey, onClick } = props;

    const username = String(unlock.user || "").trim() || t(language, "Someone");
    const dateText = formatUnlockDate(unlock.dateAwarded, { includeYear: true }, language);
    const points = unlock.hardcoreMode ? unlock.raPoints : unlock.raSoftcorePoints;

    function handleClick() {
        void onClick(unlock);
    }

    return (
        <FocusableItem focusKey={focusKey} onClick={handleClick}>
            <div
                style={{
                    width: "100%",
                    display: "flex",
                    gap: `${Math.max(8, metrics.iconGap - 2)}px`,
                    alignItems: "flex-start",
                    padding: "2px 0",
                    minWidth: 0
                }}
            >
                {showIcons && (
                    <UserAvatar
                        username={unlock.user}
                        size={metrics.iconSize}
                        fontSize={Math.max(16, metrics.iconSize * 0.42)}
                    />
                )}
                <div
                    style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: `${Math.max(2, metrics.contentGap - 1)}px`,
                        textAlign: "left"
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            gap: "6px",
                            alignItems: "center",
                            flexWrap: "wrap",
                            minWidth: 0
                        }}
                    >
                        <div
                            style={{
                                fontSize: `${metrics.titleFontSize - 1}px`,
                                lineHeight: metrics.titleLineHeight,
                                fontWeight: 800,
                                wordBreak: "break-word"
                            }}
                        >
                            {username}
                        </div>
                        {unlock.hardcoreMode && (
                            <HardcoreBadge
                                language={language}
                                fontSize={metrics.pointsFontSize - 1}
                            />
                        )}
                    </div>
                    <div
                        style={{
                            ...smallTextStyle(),
                            fontSize: `${metrics.bodyFontSize}px`,
                            lineHeight: metrics.bodyLineHeight,
                            opacity: 0.95
                        }}
                    >
                        {t(language, "{{points}} points", { points: formatInteger(points) })}
                    </div>
                    {dateText && (
                        <div
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${metrics.pointsFontSize}px`,
                                lineHeight: metrics.pointsLineHeight,
                                opacity: 1,
                                fontWeight: 700
                            }}
                        >
                            {dateText}
                        </div>
                    )}
                </div>
            </div>
        </FocusableItem>
    );
}
