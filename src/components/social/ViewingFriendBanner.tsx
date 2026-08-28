import { type CSSProperties } from "react";
import { PanelSectionRow } from "@decky/ui";
import { UserAvatar } from "../ui/UserAvatar";
import type { LanguageCode } from "../../locales";
import { t } from "../../locales";
import { bannerSize } from "../../utils/scale";

export type ViewingFriendBannerProps = {
    username: string | null;
    kind: "achievement" | "game";
    language: LanguageCode;
};

function bannerMetrics(): { avatarSize: number; fontSize: number; labelSize: number } {
    return {
        avatarSize: bannerSize(24),
        fontSize: bannerSize(13),
        labelSize: bannerSize(13)
    };
}

export function ViewingFriendBanner(props: ViewingFriendBannerProps) {
    const { username, kind, language } = props;

    const trimmed = String(username || "").trim();
    if (!trimmed) {
        return null;
    }

    const metrics = bannerMetrics();
    const labelKey = kind === "game"
        ? "Viewing {{username}}'s game"
        : "Viewing {{username}}'s achievement";

    const wrapperStyle: CSSProperties = {
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: "8px",
        padding: "10px 0 4px"
    };

    const labelStyle: CSSProperties = {
        flex: 1,
        minWidth: 0,
        fontSize: `${metrics.labelSize}px`,
        opacity: 0.9,
        whiteSpace: "normal",
        overflowWrap: "break-word",
        wordBreak: "break-word",
        textAlign: "left"
    };

    return (
        <PanelSectionRow>
            <div style={wrapperStyle}>
                <UserAvatar
                    username={trimmed}
                    size={metrics.avatarSize}
                    fontSize={metrics.fontSize}
                    wrapperStyle={{ flexShrink: 0 }}
                />
                <span style={labelStyle}>
                    {t(language, labelKey, { username: trimmed })}
                </span>
            </div>
        </PanelSectionRow>
    );
}

