import { type CSSProperties } from "react";
import { PanelSectionRow } from "@decky/ui";
import { FadeImage } from "../ui/FadeImage";
import { useGameIcon } from "../../hooks/useGameIcon";
import { bannerSize } from "../../utils/scale";
import { FADE_IN_KEYFRAMES } from "../../utils/style";

export type GuideContextBannerProps = {
    gameId: number | null;
    imageIcon: string | null;
    title: string | null | undefined;
    subtitle: string | null | undefined;
    showIcons: boolean;
    titleLines?: number;
};

function bannerMetrics(): { iconSize: number; titleSize: number; subSize: number } {
    return {
        iconSize: bannerSize(30),
        titleSize: bannerSize(16),
        subSize: bannerSize(13)
    };
}

export function GuideContextBanner(props: GuideContextBannerProps) {
    const { gameId, imageIcon, title, subtitle, showIcons, titleLines } = props;

    const trimmedTitle = String(title || "").trim();
    const trimmedSubtitle = String(subtitle || "").trim();

    const { iconDataUri, cold } = useGameIcon(
        showIcons ? gameId : null,
        imageIcon,
        "GuideContextBanner useGameIcon"
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

    const lineHeight = 1.25;
    const columnStyle: CSSProperties = {
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "1px",
        ...(titleLines
            ? {
                minHeight: `${metrics.titleSize * lineHeight * titleLines
                    + metrics.subSize * lineHeight + 1}px`,
            }
            : {}),
    };
    const titleClamp: CSSProperties = titleLines
        ? {
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: titleLines,
            overflow: "hidden",
        }
        : {};

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
                        {iconDataUri ? (
                            <FadeImage
                                src={iconDataUri}
                                fadeOnLoad={cold}
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
                <div style={columnStyle}>
                    <span
                        style={{
                            fontSize: `${metrics.titleSize}px`,
                            fontWeight: 700,
                            opacity: 0.95,
                            whiteSpace: "normal",
                            overflowWrap: "break-word",
                            wordBreak: "break-word",
                            textAlign: "left",
                            ...(titleLines ? { lineHeight } : {}),
                            ...titleClamp
                        }}
                    >
                        {trimmedTitle}
                    </span>
                    {trimmedSubtitle && (
                        <span
                            style={{
                                fontSize: `${metrics.subSize}px`,
                                opacity: 0.7,
                                whiteSpace: "normal",
                                overflowWrap: "break-word",
                                wordBreak: "break-word",
                                textAlign: "left",
                                ...(titleLines ? { lineHeight } : {})
                            }}
                        >
                            {trimmedSubtitle}
                        </span>
                    )}
                </div>
            </div>
        </PanelSectionRow>
    );
}

