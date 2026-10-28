import React from "react";
import { AwardStamp } from "../achievements/AwardStamp";
import { FocusableItem } from "../ui/FocusableItem";
import { ProgressBar } from "../ui/ProgressBar";
import { CategoryIcon } from "./CategoryIcon";
import { MilestoneInstruction, type InstructionContext } from "./MilestoneInstruction";
import { t } from "../../locales";
import type { MilestoneCategoryIcon, MilestoneDef } from "../../types";
import { formatUnlockDate } from "../../utils/achievements";
import { achievementGreen, achievementUiMetrics, skyBlue, smallTextStyle } from "../../utils/style";

const TICK_MARK = <span style={{ color: achievementGreen, fontSize: "20px", fontWeight: 800 }}>{"✔"}</span>;

const RA_COUNTED = new Set(["unlocks", "award", "active_days", "combo", "unlock_hour", "weekend", "games_one_day", "unlock_points", "perfect_month"]);

export type MilestoneCardList = {
    metrics: ReturnType<typeof achievementUiMetrics>;
    instruction: InstructionContext;
    countsLoaded: boolean;
};

type MilestoneCardProps = {
    milestone: MilestoneDef;
    icon: MilestoneCategoryIcon;
    progress: number;
    target: number;
    claimedAt: number | null;
    isNew: boolean;
    list: MilestoneCardList;
    focusFallback?: string[];
    onGamepadFocus: () => void;
    onGamepadDirection?: (evt: { detail?: { button?: number } }) => boolean | void;
};

export const MilestoneCard = React.memo(function MilestoneCard(props: MilestoneCardProps) {
    const { milestone, list, progress, target, claimedAt } = props;
    const { metrics, instruction } = list;
    const { language } = instruction;
    const done = claimedAt !== null;
    const counting = !done && !list.countsLoaded && RA_COUNTED.has(milestone.ruleType);
    const fraction = done ? 1 : counting ? null : target > 0 ? progress / target : 0;

    const completed = done ? (
        <span style={{ color: achievementGreen, display: "inline-flex", alignItems: "center", gap: "0.35em", flexWrap: "wrap" }}>
            <span>{t(language, "Completed")}</span>
            <AwardStamp date={formatUnlockDate(new Date(claimedAt * 1000).toISOString(), { includeYear: true, dateOnly: true }, language)} />
        </span>
    ) : null;

    return (
        <FocusableItem
            focusKey={`milestone:${milestone.id}`}
            focusFallback={props.focusFallback}
            onGamepadFocus={props.onGamepadFocus}
            onGamepadDirection={props.onGamepadDirection}
            outerStyle={{
                width: "100%",
                minWidth: 0,
                ...(props.isNew ? { background: "rgba(14, 165, 233, 0.16)", borderRadius: "6px" } : null)
            }}
        >
            <div
                style={{
                    width: "100%",
                    display: "flex",
                    gap: `${Math.max(8, metrics.iconGap - 2)}px`,
                    alignItems: "flex-start",
                    padding: `${Math.max(3, Math.round(metrics.rowPaddingY * 0.42))}px 0`,
                    minWidth: 0
                }}
            >
                <div
                    style={{
                        width: `${metrics.iconSize}px`,
                        height: `${metrics.iconSize}px`,
                        borderRadius: "7px",
                        flexShrink: 0,
                        background: "rgba(128,128,128,0.18)",
                        border: "1px solid rgba(128,128,128,0.55)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                    }}
                >
                    <CategoryIcon icon={props.icon} size={Math.round(metrics.iconSize * 0.55)} />
                </div>
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
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "6px", minWidth: 0 }}>
                        <div
                            style={{
                                flex: 1,
                                fontSize: `${metrics.titleFontSize}px`,
                                lineHeight: metrics.titleLineHeight,
                                fontWeight: 800,
                                minWidth: 0,
                                wordBreak: "break-word"
                            }}
                        >
                            {t(language, `ms_${milestone.id}_name`)}
                        </div>
                        {props.isNew && (
                            <span
                                style={{
                                    flexShrink: 0,
                                    fontSize: `${metrics.pointsFontSize}px`,
                                    fontWeight: 800,
                                    padding: "1px 6px",
                                    borderRadius: "999px",
                                    background: skyBlue,
                                    color: "#ffffff"
                                }}
                            >
                                {t(language, "New")}
                            </span>
                        )}
                        {done && <span style={{ flexShrink: 0 }}>{TICK_MARK}</span>}
                    </div>
                    <div
                        style={{
                            ...smallTextStyle(),
                            fontSize: `${metrics.bodyFontSize}px`,
                            lineHeight: metrics.bodyLineHeight,
                            opacity: 1,
                            minWidth: 0,
                            wordBreak: "break-word"
                        }}
                    >
                        <MilestoneInstruction milestone={milestone} ctx={instruction} />
                    </div>
                    {completed && (
                        <div style={{ ...smallTextStyle(), fontSize: `${metrics.bodyFontSize}px`, lineHeight: metrics.bodyLineHeight, opacity: 1 }}>
                            {completed}
                        </div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                        <span
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${metrics.pointsFontSize}px`,
                                lineHeight: metrics.pointsLineHeight,
                                opacity: 1,
                                fontWeight: 800,
                                flexShrink: 0
                            }}
                        >
                            {counting ? "…" : `${Math.min(progress, target)} / ${target}`}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <ProgressBar fraction={fraction} />
                        </div>
                        <span
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${metrics.pointsFontSize}px`,
                                opacity: 0.85,
                                flexShrink: 0
                            }}
                        >
                            {t(language, "+{{xp}} XP", { xp: milestone.xp })}
                        </span>
                    </div>
                </div>
            </div>
        </FocusableItem>
    );
});
