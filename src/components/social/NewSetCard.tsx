import type { NewSetEntry } from "../../types";
import type { LanguageCode } from "../../locales";
import { t } from "../../locales";
import { useResilientGameIcon } from "../../hooks/useResilientGameIcon";
import { FadeImage } from "../ui/FadeImage";
import { FocusableItem } from "../ui/FocusableItem";
import { UserAvatar } from "../ui/UserAvatar";
import { formatUnlockDate } from "../../utils/achievements";
import { type AchievementUiMetrics, smallTextStyle } from "../../utils/style";

export type NewSetCardProps = {
    entry: NewSetEntry;
    language: LanguageCode;
    metrics: AchievementUiMetrics;
    showIcons: boolean;
    focusKey: string;
    onOpen: (gameId: number) => void | Promise<void>;
};

export function NewSetCard(props: NewSetCardProps) {
    const { entry, language, metrics, showIcons, focusKey, onOpen } = props;

    const gameTitle = String(entry.gameTitle || "").trim();
    const subsetName = entry.subsetName ? String(entry.subsetName).trim() : "";
    const consoleName = String(entry.consoleName || "").trim();
    const author = String(entry.user || "").trim();
    const dateText = formatUnlockDate(entry.doneTime, { includeYear: true }, language);

    const gameId = entry.gameId;
    const { iconDataUri, cold } = useResilientGameIcon(gameId, entry.gameIcon, "NewSetCard getGameIconCached");

    function handleClick() {
        if (gameId == null) {
            return;
        }
        void onOpen(gameId);
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
                <div
                    style={{
                        width: `${metrics.iconSize}px`,
                        height: `${metrics.iconSize}px`,
                        borderRadius: "7px",
                        flexShrink: 0,
                        background: "rgba(255,255,255,0.10)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        overflow: "hidden",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                    }}
                >
                    {iconDataUri && (
                        <FadeImage
                            src={iconDataUri}
                            fadeOnLoad={cold}
                            style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover"
                            }}
                        />
                    )}
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
                    <div
                        style={{
                            fontSize: `${metrics.titleFontSize - 1}px`,
                            lineHeight: metrics.titleLineHeight,
                            fontWeight: 800,
                            minWidth: 0,
                            wordBreak: "break-word"
                        }}
                    >
                        {gameTitle}
                    </div>
                    {subsetName && (
                        <div
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${metrics.bodyFontSize}px`,
                                lineHeight: metrics.bodyLineHeight,
                                opacity: 0.9,
                                minWidth: 0,
                                wordBreak: "break-word"
                            }}
                        >
                            {t(language, "Subset: {{name}}", { name: subsetName })}
                        </div>
                    )}
                    <div
                        style={{
                            display: "flex",
                            gap: "6px",
                            alignItems: "center",
                            flexWrap: "wrap",
                            minWidth: 0
                        }}
                    >
                        {showIcons && author && (
                            <UserAvatar
                                username={author}
                                size={Math.max(20, Math.round(metrics.iconSize * 0.5))}
                                fontSize={Math.max(12, metrics.iconSize * 0.22)}
                            />
                        )}
                        <div
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${metrics.bodyFontSize}px`,
                                lineHeight: metrics.bodyLineHeight,
                                opacity: 0.95
                            }}
                        >
                            {consoleName && author
                                ? `${consoleName} \u2022 ${author}`
                                : consoleName || author}
                        </div>
                        {entry.userIsJrDev && (
                            <div
                                style={{
                                    fontSize: `${metrics.pointsFontSize - 1}px`,
                                    lineHeight: 1,
                                    fontWeight: 800,
                                    padding: "2px 6px",
                                    borderRadius: "8px",
                                    background: "rgba(56, 189, 248, 0.18)",
                                    border: "1px solid rgba(56, 189, 248, 0.45)",
                                    color: "#38bdf8"
                                }}
                            >
                                {t(language, "Jr. Dev")}
                            </div>
                        )}
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
