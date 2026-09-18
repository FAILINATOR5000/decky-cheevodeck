import React from "react";
import { Focusable } from "@decky/ui";
import { FadeImage } from "../ui/FadeImage";
import { noteBodyColor } from "../../utils/achievements";
import { formatClipLength } from "../../utils/memories";
import { textSize } from "../../utils/scale";
import type { MemoryRecord } from "../../types";

const DENSE_COLUMN_THRESHOLD = 3;

const ARMED_BORDER_COLOR = "#ef4444";

const CLIP_LENGTH_SIZE_BY_COLUMNS: Record<number, number> = { 1: 13, 2: 11, 3: 9 };

const CLIP_MARK_BACKDROP = "rgba(0, 0, 0, 0.35)";
const CLIP_MARK_COLOR = "rgba(255, 255, 255, 0.88)";

const FOCUS_RING = "0 0 0 2px rgba(120, 200, 255, 0.85), 0 2px 8px rgba(0, 0, 0, 0.35)";

export type MemoryCardListProps = {
    columns: number;
    dateFormatter: Intl.DateTimeFormat;
    onFocused: (memoryId: string) => void;
    onBlurred: (memoryId: string) => void;
    onOpen: (memoryId: string) => void;
};

type MemoryCardProps = {
    memory: MemoryRecord;
    thumbDataUri: string | null;
    cold: boolean;
    armed: boolean;
    focused: boolean;
    list: MemoryCardListProps;
};

export const MemoryCard = React.memo(function MemoryCard(props: MemoryCardProps) {
    const { memory, thumbDataUri, cold, armed, focused, list } = props;
    const dense = list.columns >= DENSE_COLUMN_THRESHOLD;
    const rule = noteBodyColor(memory.color);

    function reportFocus() {
        list.onFocused(memory.id);
    }

    function reportBlur() {
        list.onBlurred(memory.id);
    }

    const dateLabel = list.dateFormatter.format(new Date(memory.capturedAt * 1000));

    return (
        <div
            data-focus-key={`memories:tile:${memory.id}`}
            onFocusCapture={reportFocus}
            onBlurCapture={reportBlur}
            style={{ minWidth: 0 }}
        >
            <Focusable
                onActivate={() => list.onOpen(memory.id)}
                onGamepadFocus={reportFocus}
                onGamepadBlur={reportBlur}
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "3px",
                    padding: "3px",
                    borderRadius: "6px",
                    boxShadow: focused && !armed ? FOCUS_RING : undefined,
                    border: `2px solid ${armed ? ARMED_BORDER_COLOR : "transparent"}`
                }}
            >
                <div style={{ fontSize: `${textSize(11)}px`, opacity: 0.7, fontWeight: 600 }}>
                    {dateLabel}
                </div>
                <div
                    style={{
                        position: "relative",
                        width: "100%",
                        aspectRatio: "16 / 10",
                        borderRadius: "4px",
                        overflow: "hidden",
                        background: "rgba(255,255,255,0.08)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                    }}
                >
                    {thumbDataUri ? (
                        <FadeImage
                            src={thumbDataUri}
                            fadeOnLoad={cold}
                            decoding="async"
                            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                        />
                    ) : null}
                    {memory.video ? (
                        <div
                            style={{
                                position: "absolute",
                                bottom: "3px",
                                right: "3px",
                                padding: "1px 4px",
                                borderRadius: "3px",
                                background: CLIP_MARK_BACKDROP,
                                color: CLIP_MARK_COLOR,
                                fontSize: `${textSize(CLIP_LENGTH_SIZE_BY_COLUMNS[list.columns] ?? 11)}px`,
                                fontWeight: 600,
                                fontVariantNumeric: "tabular-nums",
                                lineHeight: 1.3
                            }}
                        >
                            {formatClipLength(memory.video.durationMs / 1000)}
                        </div>
                    ) : null}
                </div>
                {rule ? (
                    <div style={{ height: "2px", borderRadius: "1px", background: rule }} />
                ) : null}
                {!dense && memory.caption ? (
                    <div
                        style={{
                            fontSize: `${textSize(12)}px`,
                            lineHeight: 1.25,
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            wordBreak: "break-word"
                        }}
                    >
                        {memory.caption}
                    </div>
                ) : null}
            </Focusable>
        </div>
    );
});
