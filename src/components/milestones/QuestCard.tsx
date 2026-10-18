import { DialogButton } from "@decky/ui";
import { FocusTarget } from "../ui/FocusTarget";
import { ProgressBar } from "../ui/ProgressBar";
import { withInlineTags } from "../ui/inlineTags";
import { MilestonesIcon } from "./MilestonesIcon";
import { t, type LanguageCode } from "../../locales";
import type { QuestPeriod, QuestState } from "../../types";
import { achievementGreen, achievementUiMetrics, smallTextStyle } from "../../utils/style";

const PERIOD_TITLES: Record<QuestPeriod, string> = {
    daily: "Daily Quest",
    bonus: "Bonus Daily Quest",
    weekly: "Weekly Quest"
};

const PERIOD_FOOTERS: Record<QuestPeriod, string> = {
    daily: "New quest at midnight",
    bonus: "Gone at midnight",
    weekly: "New quest on Monday"
};
export function QuestCard(props: {
    language: LanguageCode;
    period: QuestPeriod;
    quest: QuestState;
    metrics: ReturnType<typeof achievementUiMetrics>;
    countsLoaded: boolean;
    rerolling: boolean;
    onReroll: () => void;
}) {
    const { language, period, quest, metrics } = props;
    const unlockBased = !["action", "daily_done"].includes(quest.ruleType);
    const counting = !quest.done && unlockBased && !props.countsLoaded;
    const fraction = quest.done ? 1 : counting ? null : quest.progress / quest.target;
    const focusKey = `milestones:quest:${period}`;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%", minWidth: 0 }}>
            <FocusTarget focusKey={focusKey} focusFallback={period === "bonus" ? ["milestones:quest:daily"] : undefined} style={{ width: "100%" }}>
                <DialogButton
                    style={{ width: "100%", minWidth: 0, padding: "8px 10px", textAlign: "left" }}
                    onClick={() => { }}
                >
                    <div style={{ display: "flex", gap: `${metrics.iconGap}px`, alignItems: "flex-start", minWidth: 0 }}>
                        <MilestonesIcon size={Math.round(metrics.iconSize * 0.6)} />
                        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
                            <div style={{ ...smallTextStyle(), fontSize: `${metrics.pointsFontSize}px`, opacity: 0.8, fontWeight: 700 }}>
                                {t(language, PERIOD_TITLES[period])}
                            </div>
                            <div style={{ fontSize: `${metrics.titleFontSize}px`, lineHeight: metrics.titleLineHeight, fontWeight: 800 }}>
                                {t(language, `q_${quest.quest}_name`)}
                            </div>
                            <div style={{ ...smallTextStyle(), fontSize: `${metrics.bodyFontSize}px`, lineHeight: metrics.bodyLineHeight, opacity: 1 }}>
                                {withInlineTags(t(language, `q_${quest.quest}_how`))}
                            </div>
                            {quest.done && (
                                <div style={{ ...smallTextStyle(), fontSize: `${metrics.bodyFontSize}px`, lineHeight: metrics.bodyLineHeight, opacity: 1, color: achievementGreen }}>
                                    {t(language, "Completed")}
                                </div>
                            )}
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <span style={{ ...smallTextStyle(), fontSize: `${metrics.pointsFontSize}px`, fontWeight: 800, opacity: 1 }}>
                                    {counting ? "…" : `${Math.min(quest.progress, quest.target)} / ${quest.target}`}
                                </span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <ProgressBar fraction={fraction} />
                                </div>
                                <span style={{ ...smallTextStyle(), fontSize: `${metrics.pointsFontSize}px`, opacity: 0.85 }}>
                                    {t(language, "+{{xp}} XP", { xp: quest.xp })}
                                </span>
                            </div>
                            <div style={{ ...smallTextStyle(), fontSize: `${metrics.pointsFontSize}px`, opacity: 0.7 }}>
                                {t(language, PERIOD_FOOTERS[period])}
                                {quest.rerolled && !quest.done ? ` · ${t(language, "Rerolled")}` : ""}
                            </div>
                        </div>
                    </div>
                </DialogButton>
            </FocusTarget>
            {quest.canReroll && (
                <FocusTarget focusKey={`${focusKey}:reroll`} focusFallback={[focusKey]} style={{ width: "100%" }}>
                    <DialogButton style={{ width: "100%", minWidth: 0 }} disabled={props.rerolling} onClick={props.onReroll}>
                        {t(language, "Reroll")}
                    </DialogButton>
                </FocusTarget>
            )}
        </div>
    );
}
