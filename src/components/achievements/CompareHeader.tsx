import type { FriendGamePayload, FriendRow, Payload, UiSize } from "../../types";
import type { LanguageCode } from "../../locales";
import { t } from "../../locales";
import { InlineSpinner } from "../ui/InlineSpinner";
import { formatInteger } from "../../utils/format";
import { earned } from "../../utils/achievements";
import { achievementUiMetrics, smallTextStyle } from "../../utils/style";

type CompareHeaderProps = {
    language: LanguageCode;
    uiSize: UiSize;
    friend: FriendRow | null;
    friendUsername: string;
    currentPayload: Payload | null;
    comparePayload: FriendGamePayload | null;
};

type CompletionLevel = "none" | "beaten" | "mastered";

function completionLevelFromPayload(payload: Payload | null): CompletionLevel {
    if (!payload) {
        return "none";
    }
    const total = Math.max(0, Number(payload.numAchievements ?? payload.achievements?.length ?? 0));
    if (total === 0) {
        return "none";
    }
    const earnedCount = (payload.achievements ?? []).filter((a) => earned(a)).length;
    const hardcoreCount = (payload.achievements ?? []).filter((a) => Boolean(a.dateEarnedHardcore)).length;
    if (hardcoreCount >= total) {
        return "mastered";
    }
    if (earnedCount >= total) {
        return "beaten";
    }
    return "none";
}

function completionRank(level: CompletionLevel) {
    if (level === "mastered") {
        return 2;
    }
    if (level === "beaten") {
        return 1;
    }
    return 0;
}

function completionLabel(level: CompletionLevel, language: LanguageCode) {
    if (level === "mastered") {
        return t(language, "Mastered");
    }
    if (level === "beaten") {
        return t(language, "Beaten");
    }
    return t(language, "None");
}

function totalPoints(payload: Payload | null) {
    if (!payload) {
        return 0;
    }
    let sum = 0;
    for (const achievement of payload.achievements ?? []) {
        if (earned(achievement)) {
            sum += Math.max(0, Number(achievement.points ?? 0));
        }
    }
    return sum;
}

function totalRetroPoints(payload: Payload | null) {
    if (!payload) {
        return 0;
    }
    let sum = 0;
    for (const achievement of payload.achievements ?? []) {
        if (earned(achievement)) {
            sum += Math.max(0, Number(achievement.trueRatio ?? 0));
        }
    }
    return sum;
}

function leadTag(yourValue: number, theirValue: number, friendName: string, language: LanguageCode) {
    if (yourValue > theirValue) {
        return t(language, "You lead");
    }
    if (theirValue > yourValue) {
        return t(language, "{{name}} leads", { name: friendName });
    }
    return t(language, "Tied");
}

function StatRow(props: {
    label: string;
    uiSize: UiSize;
    yourValue: string;
    theirValue: string;
    youAreAhead: number;
    leadText: string;
    loading: boolean;
}) {
    const { label, uiSize, yourValue, theirValue, youAreAhead, leadText, loading } = props;
    const metrics = achievementUiMetrics(uiSize);

    const labelFontSize = metrics.captionFontSize + 1;

    let tagBackground = "rgba(255,255,255,0.08)";
    let tagColor = "rgba(255,255,255,0.85)";
    if (youAreAhead > 0) {
        tagBackground = "rgba(72,187,120,0.18)";
        tagColor = "#9ae6b4";
    } else if (youAreAhead < 0) {
        tagBackground = "rgba(245,101,101,0.18)";
        tagColor = "#feb2b2";
    }

    return (
        <div
            style={{
                width: "100%",
                display: "flex",
                flexDirection: "column",
                gap: "3px",
                padding: "5px 0",
                borderBottom: "1px solid rgba(255,255,255,0.06)"
            }}
        >
            <div
                style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: "8px"
                }}
            >
                <div style={{ fontWeight: 700, fontSize: `${labelFontSize}px` }}>{label}</div>
                {loading ? (
                    <InlineSpinner size={12} />
                ) : leadText ? (
                    <div
                        style={{
                            ...smallTextStyle(),
                            fontSize: `${metrics.captionFontSize}px`,
                            background: tagBackground,
                            color: tagColor,
                            padding: "1px 8px",
                            borderRadius: "999px",
                            fontWeight: 700,
                            whiteSpace: "nowrap"
                        }}
                    >
                        {leadText}
                    </div>
                ) : null}
            </div>
            <div
                style={{
                    width: "100%",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "8px"
                }}
            >
                <div
                    style={{
                        ...smallTextStyle(),
                        fontSize: `${metrics.captionFontSize}px`,
                        fontWeight: 700,
                        opacity: youAreAhead > 0 ? 1 : 0.85
                    }}
                >
                    {yourValue}
                </div>
                {loading ? (
                    <InlineSpinner size={12} />
                ) : (
                    <div
                        style={{
                            ...smallTextStyle(),
                            fontSize: `${metrics.captionFontSize}px`,
                            fontWeight: 700,
                            opacity: youAreAhead < 0 ? 1 : 0.85,
                            textAlign: "right"
                        }}
                    >
                        {theirValue}
                    </div>
                )}
            </div>
        </div>
    );
}

export function CompareHeader(props: CompareHeaderProps) {
    const { language, uiSize, friend, friendUsername, currentPayload, comparePayload } = props;
    const metrics = achievementUiMetrics(uiSize);

    const friendName = (friend?.username || friendUsername || "").trim();
    const friendPayload = comparePayload?.payload ?? null;

    const friendDataLoaded = friendPayload !== null;
    function leadFor(yourValue: number, theirValue: number) {
        if (!friendDataLoaded) {
            return "";
        }
        return leadTag(yourValue, theirValue, friendName, language);
    }
    function aheadFor(yourValue: number, theirValue: number) {
        if (!friendDataLoaded) {
            return 0;
        }
        return Math.sign(yourValue - theirValue);
    }

    const totalAchievements = Math.max(0, Number(currentPayload?.numAchievements ?? currentPayload?.achievements?.length ?? 0));
    const yourEarned = (currentPayload?.achievements ?? []).filter((a) => earned(a)).length;
    const theirEarned = (friendPayload?.achievements ?? []).filter((a) => earned(a)).length;

    const yourPercent = totalAchievements > 0 ? Math.round((yourEarned / totalAchievements) * 100) : 0;
    const theirPercent = totalAchievements > 0 ? Math.round((theirEarned / totalAchievements) * 100) : 0;

    const yourPoints = totalPoints(currentPayload);
    const theirPoints = totalPoints(friendPayload);
    const yourRetroPoints = totalRetroPoints(currentPayload);
    const theirRetroPoints = totalRetroPoints(friendPayload);

    const yourCompletion = completionLevelFromPayload(currentPayload);
    const theirCompletion = completionLevelFromPayload(friendPayload);
    const yourCompletionRank = completionRank(yourCompletion);
    const theirCompletionRank = completionRank(theirCompletion);

    return (
        <div
            style={{
                width: "100%",
                display: "flex",
                flexDirection: "column",
                padding: "6px 0 4px 0"
            }}
        >
            <div
                style={{
                    ...smallTextStyle(),
                    fontSize: `${metrics.captionFontSize}px`,
                    width: "100%",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "8px",
                    fontWeight: 800,
                    letterSpacing: "0.02em",
                    textTransform: "uppercase",
                    opacity: 0.92,
                    padding: "2px 0 4px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.06)"
                }}
            >
                <span>{t(language, "You")}</span>
                <span
                    style={{
                        textAlign: "right",
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                    }}
                >
                    {friendName}
                </span>
            </div>
            <StatRow
                label={t(language, "Unlocked")}
                uiSize={uiSize}
                yourValue={`${formatInteger(yourEarned)} / ${formatInteger(totalAchievements)} (${yourPercent}%)`}
                theirValue={friendDataLoaded
                    ? `${formatInteger(theirEarned)} / ${formatInteger(totalAchievements)} (${theirPercent}%)`
                    : ""}
                youAreAhead={aheadFor(yourEarned, theirEarned)}
                leadText={leadFor(yourEarned, theirEarned)}
                loading={!friendDataLoaded}
            />
            <StatRow
                label={t(language, "Points")}
                uiSize={uiSize}
                yourValue={formatInteger(yourPoints)}
                theirValue={friendDataLoaded ? formatInteger(theirPoints) : ""}
                youAreAhead={aheadFor(yourPoints, theirPoints)}
                leadText={leadFor(yourPoints, theirPoints)}
                loading={!friendDataLoaded}
            />
            <StatRow
                label={t(language, "RetroPoints")}
                uiSize={uiSize}
                yourValue={formatInteger(yourRetroPoints)}
                theirValue={friendDataLoaded ? formatInteger(theirRetroPoints) : ""}
                youAreAhead={aheadFor(yourRetroPoints, theirRetroPoints)}
                leadText={leadFor(yourRetroPoints, theirRetroPoints)}
                loading={!friendDataLoaded}
            />
            <StatRow
                label={t(language, "Completion")}
                uiSize={uiSize}
                yourValue={completionLabel(yourCompletion, language)}
                theirValue={friendDataLoaded ? completionLabel(theirCompletion, language) : ""}
                youAreAhead={aheadFor(yourCompletionRank, theirCompletionRank)}
                leadText={leadFor(yourCompletionRank, theirCompletionRank)}
                loading={!friendDataLoaded}
            />
        </div>
    );
}
