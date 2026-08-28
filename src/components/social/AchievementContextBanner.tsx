import { type CSSProperties } from "react";
import { PanelSectionRow } from "@decky/ui";
import { FadeImage } from "../ui/FadeImage";
import { useAchievementBadge } from "../../hooks/useAchievementBadge";
import { bannerSize } from "../../utils/scale";
import { FADE_IN_KEYFRAMES } from "../../utils/style";

export type AchievementContextBannerProps = {
    gameId: number | null;
    achievementTitle: string | null | undefined;
    badgeName: string | null | undefined;
    gameTitle: string | null | undefined;
    showIcons: boolean;
};

function bannerMetrics(): { iconSize: number; titleSize: number; subSize: number } {
    return {
        iconSize: bannerSize(24),
        titleSize: bannerSize(13),
        subSize: bannerSize(11)
    };
}

export function AchievementContextBanner(props: AchievementContextBannerProps) {
    const { gameId, achievementTitle, badgeName, gameTitle, showIcons } = props;

    const trimmedTitle = String(achievementTitle || "").trim();
    const trimmedGame = String(gameTitle || "").trim();

    const badgeDataUri = useAchievementBadge(
        showIcons ? gameId : null,
        showIcons ? badgeName : null,
        "AchievementContextBanner useAchievementBadge"
    );

    if (!trimmedTitle) {
        return null;
    }

    const metrics = bannerMetrics();

    const wrapperStyle: CSSProperties = {
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: "8px",
        padding: "10px 0 4px"
    };

    const iconBoxStyle: CSSProperties = {
        width: `${metrics.iconSize}px`,
        height: `${metrics.iconSize}px`,
        borderRadius: "7px",
        overflow: "hidden",
        flexShrink: 0,
        background: "rgba(255,255,255,0.10)",
        border: "1px solid rgba(255,255,255,0.12)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
    };

    return (
        <PanelSectionRow>
            <div style={wrapperStyle}>
                <style>{FADE_IN_KEYFRAMES}</style>
                {showIcons ? (
                    <div style={iconBoxStyle}>
                        {badgeDataUri ? (
                            <FadeImage
                                src={badgeDataUri}
                                fadeOnLoad={true}
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                    display: "block"
                                }}
                            />
                        ) : null}
                    </div>
                ) : null}
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" }}>
                    <span
                        style={{
                            fontSize: `${metrics.titleSize}px`,
                            fontWeight: 700,
                            opacity: 0.95,
                            whiteSpace: "normal",
                            overflowWrap: "break-word",
                            wordBreak: "break-word",
                            textAlign: "left"
                        }}
                    >
                        {trimmedTitle}
                    </span>
                    {trimmedGame && (
                        <span
                            style={{
                                fontSize: `${metrics.subSize}px`,
                                opacity: 0.7,
                                whiteSpace: "normal",
                                overflowWrap: "break-word",
                                wordBreak: "break-word",
                                textAlign: "left"
                            }}
                        >
                            {trimmedGame}
                        </span>
                    )}
                </div>
            </div>
        </PanelSectionRow>
    );
}

