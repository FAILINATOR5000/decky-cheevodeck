import { useEffect, useRef, useState, type CSSProperties } from "react";
import { formatClipLength, formatClipTenths } from "../../utils/memories";
import { modalSize } from "../../utils/scale";
import { achievementGreen, errorRed } from "../../utils/style";

export type SharePartBarProps = {
    clipStart: number;
    clipEnd: number;
    playhead: number;
    green: number;
    red: number;
    onSeek?: (mediaTime: number) => void;
};

const WINDOW_SECONDS = 90;

const DIGIT_WIDTH = 0.62;

function labelWidth(text: string, fontSize: number): number {
    return text.length * fontSize * DIGIT_WIDTH + 6;
}

export function SharePartBar(props: SharePartBarProps) {
    const { clipStart, clipEnd, playhead, green, red, onSeek } = props;
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [width, setWidth] = useState(0);
    const windowRef = useRef<number | null>(null);

    useEffect(() => {
        const node = rootRef.current;
        const win = node?.ownerDocument?.defaultView as any;
        if (!node) {
            return;
        }
        setWidth(node.clientWidth);
        if (!win?.ResizeObserver) {
            return;
        }
        const observer = new win.ResizeObserver(() => setWidth(node.clientWidth));
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    const long = clipEnd - clipStart > WINDOW_SECONDS;
    const latestWindow = clipEnd - WINDOW_SECONDS;
    const placeWindow = (center: number) => Math.min(Math.max(center - WINDOW_SECONDS / 2, clipStart), latestWindow);
    let viewStart = clipStart;
    let viewEnd = clipEnd;
    if (long) {
        let windowStart = windowRef.current ?? placeWindow((green + red) / 2);
        if (playhead < windowStart || playhead > windowStart + WINDOW_SECONDS) {
            windowStart = placeWindow(playhead);
        }
        windowRef.current = windowStart;
        viewStart = windowStart;
        viewEnd = windowStart + WINDOW_SECONDS;
    }
    const span = Math.max(viewEnd - viewStart, 0.001);
    const at = (time: number) => (Math.min(Math.max(time, viewStart), viewEnd) - viewStart) / span * width;

    const start = green;
    const end = red;
    const startX = at(start);
    const endX = at(end);
    const startEdge = start < viewStart ? -1 : start > viewEnd ? 1 : 0;
    const endEdge = end < viewStart ? -1 : end > viewEnd ? 1 : 0;
    const bothOff = startEdge !== 0 && startEdge === endEdge;
    const partVisible = end > viewStart && start < viewEnd;
    const moreBefore = viewStart > clipStart + 0.05;
    const moreAfter = viewEnd < clipEnd - 0.05;

    const pinSize = modalSize(14);
    const trackHeight = modalSize(16);
    const timeFont = modalSize(11);
    const lengthFont = modalSize(11);
    const lengthRow = lengthFont + 4;
    const overviewHeight = modalSize(4);
    const overviewRow = long ? overviewHeight + modalSize(10) : 0;
    const overviewTop = modalSize(2);
    const whole = Math.max(clipEnd - clipStart, 0.001);
    const overviewAt = (time: number) => (Math.min(Math.max(time, clipStart), clipEnd) - clipStart) / whole * width;

    const startText = formatClipTenths(start - clipStart);
    const endText = formatClipTenths(end - clipStart);
    const pointLeft = "\u25C2 ";
    const pointRight = " \u25B8";
    const arrowed = (text: string, edge: number) =>
        (edge < 0 ? pointLeft : "") + text + (edge > 0 ? pointRight : "");
    const chipExtra = 8;
    const startWidth = labelWidth(arrowed(startText, startEdge), timeFont) + (startEdge !== 0 ? chipExtra : 0);
    const endWidth = labelWidth(arrowed(endText, endEdge), timeFont) + (endEdge !== 0 ? chipExtra : 0);
    const bothText = `${startText}\u2013${endText}`;
    const bothWidth = labelWidth(arrowed(bothText, startEdge), timeFont) + chipExtra;
    const bothLabel = startEdge < 0 ? bothWidth / 2 : width - bothWidth / 2;

    const inside = (x: number, labelWidthPx: number) =>
        Math.min(Math.max(x, labelWidthPx / 2), Math.max(width - labelWidthPx / 2, labelWidthPx / 2));
    let startLabel = inside(startX, startWidth);
    let endLabel = inside(endX, endWidth);
    const needed = (startWidth + endWidth) / 2 + 4;
    if (endLabel - startLabel < needed) {
        const middle = (startLabel + endLabel) / 2;
        startLabel = middle - needed / 2;
        endLabel = middle + needed / 2;
        if (startLabel - startWidth / 2 < 0) {
            const shift = startWidth / 2 - startLabel;
            startLabel += shift;
            endLabel += shift;
        }
        if (endLabel + endWidth / 2 > width) {
            const shift = endLabel + endWidth / 2 - width;
            startLabel -= shift;
            endLabel -= shift;
        }
    }

    const lengthText = formatClipLength(end - start);
    const lengthWidth = labelWidth(lengthText, lengthFont);
    const lengthInside = endX - startX >= lengthWidth + 8;
    const lengthCenter = Math.min(
        Math.max((startX + endX) / 2, lengthWidth / 2),
        Math.max(width - lengthWidth / 2, lengthWidth / 2)
    );

    const trackTop = overviewRow + lengthRow;
    const labelTop = trackTop + trackHeight + 3;

    function pin(x: number, color: string): CSSProperties {
        return {
            position: "absolute",
            left: `${x - pinSize / 2}px`,
            top: `${trackTop + (trackHeight - pinSize) / 2}px`,
            width: `${pinSize}px`,
            height: `${pinSize}px`,
            borderRadius: "50%",
            boxSizing: "border-box",
            background: color,
            border: `2px solid ${color}`,
            pointerEvents: "none"
        };
    }

    function timeLabel(x: number, labelWidthPx: number, color: string, chip: boolean): CSSProperties {
        return {
            position: "absolute",
            left: `${x - labelWidthPx / 2}px`,
            top: `${labelTop}px`,
            width: `${labelWidthPx}px`,
            textAlign: "center",
            fontSize: `${timeFont}px`,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            color,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            boxSizing: "border-box",
            border: chip ? `1px solid ${color}` : undefined,
            borderRadius: chip ? "4px" : undefined,
            background: chip ? "rgba(0, 0, 0, 0.35)" : undefined
        };
    }

    function seekFromClick(event: { clientX: number; currentTarget: HTMLDivElement }) {
        if (!onSeek || width <= 0) {
            return;
        }
        const box = event.currentTarget.getBoundingClientRect();
        const fraction = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1);
        onSeek(viewStart + fraction * span);
    }

    return (
        <div
            ref={rootRef}
            style={{
                position: "relative",
                width: "100%",
                height: `${labelTop + timeFont + 4}px`,
                marginTop: "6px"
            }}
        >
            <div
                onClick={onSeek ? seekFromClick : undefined}
                style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: `${trackTop}px`,
                    height: `${trackHeight}px`,
                    borderRadius: `${trackHeight / 2}px`,
                    background: `linear-gradient(to right, ${
                        moreBefore ? "rgba(255, 255, 255, 0.03)" : "rgba(255, 255, 255, 0.16)"
                    }, rgba(255, 255, 255, 0.16) ${modalSize(28)}px, rgba(255, 255, 255, 0.16) calc(100% - ${modalSize(28)}px), ${
                        moreAfter ? "rgba(255, 255, 255, 0.03)" : "rgba(255, 255, 255, 0.16)"
                    })`,
                    cursor: onSeek ? "pointer" : undefined
                }}
            />
            {long ? (
                <>
                    <div
                        style={{
                            position: "absolute",
                            left: 0,
                            right: 0,
                            top: `${overviewTop}px`,
                            height: `${overviewHeight}px`,
                            borderRadius: `${overviewHeight / 2}px`,
                            background: "rgba(255, 255, 255, 0.16)",
                            pointerEvents: "none"
                        }}
                    />
                    <div
                        style={{
                            position: "absolute",
                            left: `${overviewAt(start)}px`,
                            width: `${Math.max(overviewAt(end) - overviewAt(start), 3)}px`,
                            top: `${overviewTop}px`,
                            height: `${overviewHeight}px`,
                            background: `linear-gradient(to right, ${achievementGreen}, ${errorRed})`,
                            pointerEvents: "none"
                        }}
                    />
                    <div
                        style={{
                            position: "absolute",
                            left: `${overviewAt(playhead) - 1}px`,
                            top: 0,
                            width: "2px",
                            height: `${overviewHeight + 2 * overviewTop}px`,
                            background: "#ffffff",
                            boxShadow: "0 0 2px rgba(0, 0, 0, 0.8)",
                            pointerEvents: "none"
                        }}
                    />
                </>
            ) : null}
            <div
                style={{
                    position: "absolute",
                    display: partVisible ? undefined : "none",
                    left: `${startX}px`,
                    width: `${Math.max(endX - startX, 0)}px`,
                    top: `${trackTop}px`,
                    height: `${trackHeight}px`,
                    background: "rgba(255, 255, 255, 0.38)",
                    pointerEvents: "none"
                }}
            />
            <div
                style={{
                    position: "absolute",
                    left: `${lengthCenter - lengthWidth / 2}px`,
                    width: `${lengthWidth}px`,
                    top: lengthInside ? `${trackTop + (trackHeight - lengthFont) / 2 - 1}px` : `${overviewRow}px`,
                    textAlign: "center",
                    fontSize: `${lengthFont}px`,
                    lineHeight: `${lengthFont + 2}px`,
                    fontWeight: 800,
                    fontVariantNumeric: "tabular-nums",
                    color: "#ffffff",
                    whiteSpace: "nowrap",
                    pointerEvents: "none",
                    visibility: partVisible ? "visible" : "hidden"
                }}
            >
                {lengthText}
            </div>
            <div
                style={{
                    position: "absolute",
                    left: `${at(playhead) - 1}px`,
                    top: `${trackTop - 3}px`,
                    width: "2px",
                    height: `${trackHeight + 6}px`,
                    background: "#ffffff",
                    boxShadow: "0 0 2px rgba(0, 0, 0, 0.8)",
                    pointerEvents: "none"
                }}
            />
            {startEdge === 0 ? <div style={pin(startX, achievementGreen)} /> : null}
            {endEdge === 0 ? <div style={pin(endX, errorRed)} /> : null}
            {bothOff ? (
                <div style={timeLabel(bothLabel, bothWidth, "#ffffff", true)}>
                    {startEdge < 0 ? pointLeft : null}
                    <span style={{ color: achievementGreen }}>{startText}</span>
                    {"\u2013"}
                    <span style={{ color: errorRed }}>{endText}</span>
                    {startEdge > 0 ? pointRight : null}
                </div>
            ) : (
                <>
                    <div style={timeLabel(startLabel, startWidth, achievementGreen, startEdge !== 0)}>
                        {arrowed(startText, startEdge)}
                    </div>
                    <div style={timeLabel(endLabel, endWidth, errorRed, endEdge !== 0)}>
                        {arrowed(endText, endEdge)}
                    </div>
                </>
            )}
        </div>
    );
}
