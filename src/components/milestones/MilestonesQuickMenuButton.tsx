import type { CSSProperties } from "react";
import { FocusableItem } from "../ui/FocusableItem";
import { ProgressBar } from "../ui/ProgressBar";
import { RankEmblem } from "./RankEmblem";
import { rankName } from "./RankTableModal";
import { useMilestonesSummary } from "../../hooks/useMilestonesSummary";
import { t, type LanguageCode } from "../../locales";
import { formatInteger } from "../../utils/format";
import { textSize } from "../../utils/scale";
import { smallTextStyle } from "../../utils/style";

const sheenStyle = (focusKey: string, flush: boolean) => `
[data-focus-key="${focusKey}"] button {
    position: relative;
    overflow: hidden;
}
[data-focus-key="${focusKey}"] button::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: -40%;
    width: 35%;
    background: linear-gradient(100deg, transparent, rgba(255, 255, 255, 0.22), transparent);
    transform: translateX(0) skewX(-15deg);
    animation: da-ms-sheen 5s ease-in-out infinite;
    pointer-events: none;
}
@keyframes da-ms-sheen {
    0%, 70% { transform: translateX(0) skewX(-15deg); opacity: 0; }
    72% { opacity: 1; }
    100% { transform: translateX(420%) skewX(-15deg); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
    [data-focus-key="${focusKey}"] button::after { animation: none; opacity: 0; }
}
[data-focus-key="${focusKey}"] > div { ${flush ? "padding-top: 0 !important; " : ""}background: transparent !important; }
`;

export function MilestonesQuickMenuButton(props: {
    language: LanguageCode;
    onOpen: () => void;
    focusKey?: string;
    flush?: boolean;
    outerStyle?: CSSProperties;
}) {
    const { language } = props;
    const focusKey = props.focusKey ?? "quickmenu:milestones";
    const flush = props.flush ?? true;
    const summary = useMilestonesSummary();
    const rank = summary ? summary.ranks[summary.rank] : null;
    const newCount = summary?.newIds.length ?? 0;
    const fraction = summary && summary.nextRankXp !== null
        ? (summary.xp - summary.rankXp) / Math.max(1, summary.nextRankXp - summary.rankXp)
        : 1;

    return (
        <FocusableItem
            focusKey={focusKey}
            bottomSeparator="none"
            onClick={props.onOpen}
            outerStyle={{ width: "100%", minWidth: 0, ...props.outerStyle }}
        >
            <style>{sheenStyle(focusKey, flush)}</style>
            <div
                style={{
                    position: "relative",
                    overflow: "hidden",
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "4px 2px",
                    minWidth: 0
                }}
            >
                <span style={{ width: "30px", height: "30px", flexShrink: 0, display: "flex" }}>
                    {rank && <RankEmblem tier={rank.tier} step={rank.step} size={30} />}
                </span>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", textAlign: "left" }}>
                    <span style={{ fontWeight: 700 }}>{t(language, "Milestones")}</span>
                    <span style={{ ...smallTextStyle(), fontSize: `${textSize(11)}px`, opacity: 0.75 }}>
                        {summary && rank
                            ? `${rankName(language, rank)} · ${summary.nextRankXp === null
                                ? t(language, "{{xp}} XP", { xp: formatInteger(summary.xp) })
                                : t(language, "{{xp}} / {{next}} XP", { xp: formatInteger(summary.xp), next: formatInteger(summary.nextRankXp) })}`
                            : "\u00a0"}
                    </span>
                    <div style={{ marginTop: "4px" }}>
                        <ProgressBar fraction={summary ? Math.min(1, fraction) : 0} height={4} />
                    </div>
                </div>
                {newCount > 0 && (
                    <span style={{ flexShrink: 0, fontSize: `${textSize(11)}px`, fontWeight: 700, padding: "2px 7px", borderRadius: "999px", background: "#16a34a", color: "#ffffff" }}>
                        {t(language, "{{count}} new", { count: newCount })}
                    </span>
                )}
            </div>
        </FocusableItem>
    );
}
