import { PanelSectionRow } from "@decky/ui";
// Font Awesome Free icons, CC BY 4.0. See ATTRIBUTIONS.md.
import { FaTrophy } from "react-icons/fa";
import { FocusableItem } from "../ui/FocusableItem";
import { InfoRow } from "../ui/InfoRow";
import { LabeledRow } from "../ui/LabeledRow";
import { SectionTitle } from "../ui/SectionTitle";
import { shortDayLabel } from "./ActivityGrid";
import type { MonthStats } from "./monthStats";
import { t, type LanguageCode } from "../../locales";
import type { ActivityRow, ButtonSpacing } from "../../types";
import { formatInteger } from "../../utils/format";
import { bodyTextStyle, regularButtonSpacingStyle } from "../../utils/style";

function TrophyCount(props: { prefix: string; count: number }) {
    return (
        <>
            {`${props.prefix} · `}
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35em", whiteSpace: "nowrap", verticalAlign: "middle" }}>
                <FaTrophy style={{ flexShrink: 0 }} />
                {formatInteger(props.count)}
            </span>
        </>
    );
}

export function ActivityStats(props: {
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    stats: MonthStats;
    combo: number | null;
    onOpenDay: (day: string) => void;
    onOpenGame: (row: ActivityRow) => void;
}) {
    const { language, stats, combo } = props;
    const spacing = regularButtonSpacingStyle(props.buttonSpacing);

    return (
        <>
            <SectionTitle label={t(language, "Stats")} />
            <PanelSectionRow>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", width: "100%", paddingBottom: "8px" }}>
                    {combo !== null && (
                        <InfoRow label={t(language, "Combo")} value={t(language, "{{count}} days", { count: combo })} />
                    )}
                    <InfoRow
                        label={t(language, "Days active")}
                        value={t(language, "{{awarded}} / {{total}}", { awarded: stats.activeDays, total: stats.totalDays })}
                    />
                    <InfoRow
                        label={t(language, "Longest streak")}
                        value={t(language, "{{count}} days", { count: stats.longestStreak })}
                    />
                    <InfoRow
                        label={t(language, "Hardcore points")}
                        value={stats.hardcorePoints > 0 ? formatInteger(stats.hardcorePoints) : ""}
                    />
                    <InfoRow
                        label={t(language, "Softcore points")}
                        value={stats.softcorePoints > 0 ? formatInteger(stats.softcorePoints) : ""}
                    />
                </div>
            </PanelSectionRow>
            <LabeledRow
                outerStyle={spacing}
                focusKey="activity:stats:day"
                focusFallback={["activity:stats:game", "activity:refresh"]}
                bottomSeparator="none"
                label={t(language, "Best day")}
                value={<TrophyCount prefix={shortDayLabel(stats.bestDay, language)} count={stats.bestDayCount} />}
                onClick={() => props.onOpenDay(stats.bestDay)}
            />
            <PanelSectionRow>
                <FocusableItem
                    outerStyle={spacing}
                    focusKey="activity:stats:game"
                    focusFallback={["activity:refresh", "activity:stats:day"]}
                    bottomSeparator="none"
                    onClick={() => props.onOpenGame(stats.topGame)}
                >
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "2px", width: "100%" }}>
                        <span style={{ fontWeight: 700 }}>{t(language, "Top game")}</span>
                        <span style={{ ...bodyTextStyle(), textAlign: "left", overflowWrap: "break-word" }}>
                            <TrophyCount prefix={stats.topGame.gameTitle || ""} count={stats.topGameCount} />
                        </span>
                    </div>
                </FocusableItem>
            </PanelSectionRow>
        </>
    );
}
