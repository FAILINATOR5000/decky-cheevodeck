import React, { type CSSProperties } from "react";
import type { AotwComment, GameComment } from "../../types";
import type { LanguageCode } from "../../locales";
import { t } from "../../locales";
import { FocusableItem } from "../ui/FocusableItem";
import { UserAvatar } from "../ui/UserAvatar";
import { formatUnlockDate } from "../../utils/achievements";
import { BODY_LINE_CLAMP, commentBodyColumnPx, commentBodyPreview } from "../../utils/commentBody";
import { type AchievementUiMetrics, smallTextStyle } from "../../utils/style";
import { commentsTextSize } from "../../utils/scale";

export type CommentCardProps = {
    comment: AotwComment | GameComment;
    language: LanguageCode;
    metrics: AchievementUiMetrics;
    showIcons: boolean;
    focusKey: string;
    onClick: (comment: AotwComment | GameComment) => void | Promise<void>;
    index?: number;
    onGamepadFocusIndex?: (index: number) => void;
    outerStyle?: CSSProperties;
    contentPaddingRight?: number;
};

export const CommentCard = React.memo(function CommentCard(props: CommentCardProps) {
    const { comment, language, metrics, showIcons, focusKey, onClick, index, onGamepadFocusIndex, outerStyle, contentPaddingRight } = props;

    const username = String(comment.user || "").trim() || t(language, "Someone");
    const dateText = formatUnlockDate(comment.submitted, { includeYear: true }, language);
    const bodyFontSize = commentsTextSize(metrics.bodyFontSize);
    const avatarGap = Math.max(8, metrics.iconGap - 2);
    const bodyColumn = commentBodyColumnPx(showIcons ? metrics.iconSize + avatarGap : 0, contentPaddingRight ?? 0);
    const body = commentBodyPreview(String(comment.commentText || "").trim(), bodyFontSize, bodyColumn);

    function handleClick() {
        void onClick(comment);
    }

    return (
        <FocusableItem
            focusKey={focusKey}
            onClick={handleClick}
            onGamepadFocus={onGamepadFocusIndex && index != null ? () => onGamepadFocusIndex(index) : undefined}
            outerStyle={outerStyle}
        >
            <div
                style={{
                    width: "100%",
                    display: "flex",
                    gap: `${avatarGap}px`,
                    alignItems: "flex-start",
                    padding: "2px 0",
                    minWidth: 0
                }}
            >
                {showIcons && (
                    <UserAvatar
                        username={comment.user}
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
                        textAlign: "left",
                        paddingRight: contentPaddingRight ? `${contentPaddingRight}px` : undefined
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
                        {username}
                    </div>
                    {body.text && (
                        <div
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${bodyFontSize}px`,
                                lineHeight: metrics.bodyLineHeight,
                                opacity: 1,
                                minWidth: 0,
                                wordBreak: "break-word",
                                whiteSpace: "pre-wrap",
                                display: "-webkit-box",
                                WebkitBoxOrient: "vertical",
                                WebkitLineClamp: BODY_LINE_CLAMP,
                                overflow: "hidden"
                            } as CSSProperties}
                        >
                            {body.text}
                        </div>
                    )}
                    {body.truncated && (
                        <div
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${commentsTextSize(metrics.pointsFontSize)}px`,
                                lineHeight: metrics.pointsLineHeight,
                                opacity: 0.9,
                                fontWeight: 800
                            }}
                        >
                            {t(language, "Press A to view more")}
                        </div>
                    )}
                    {dateText && (
                        <div
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${commentsTextSize(metrics.pointsFontSize)}px`,
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
});
