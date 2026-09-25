import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { DialogButton } from "@decky/ui";
// Font Awesome Free icons, CC BY 4.0. See ATTRIBUTIONS.md.
import { FaChevronDown, FaChevronUp } from "react-icons/fa";
import { logFocusDebug } from "../../api";
import { modalSize } from "../../utils/scale";
import { useBrowserPress } from "../../hooks/useBrowserPress";

const PAGE_FRACTION = 0.85;

const MIN_THUMB_PX = 24;

type Metrics = { top: number; view: number; full: number };

type BrowserScrollAreaProps = {
    railPx: number;
    gapPx: number;
    rowGap: string;
    unmountedPx: number;
    header: ReactNode;
    children: ReactNode;
};

export function BrowserScrollArea({ railPx, gapPx, rowGap, unmountedPx, header, children }: BrowserScrollAreaProps) {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const trackRef = useRef<HTMLDivElement | null>(null);
    const dragEndRef = useRef<(() => void) | null>(null);
    const [metrics, setMetrics] = useState<Metrics>({ top: 0, view: 0, full: 0 });

    const act = useBrowserPress();

    const measure = useCallback(() => {
        const node = scrollRef.current;
        if (!node) {
            return;
        }
        const next = { top: node.scrollTop, view: node.clientHeight, full: node.scrollHeight };
        setMetrics((current) => (
            current.top === next.top && current.view === next.view && current.full === next.full ? current : next
        ));
    }, []);

    useEffect(() => {
        const node = scrollRef.current;
        const content = contentRef.current;
        const win = node?.ownerDocument?.defaultView as any;
        if (!node || !content || !win?.ResizeObserver) {
            return;
        }
        const observer = new win.ResizeObserver(measure);
        observer.observe(node);
        observer.observe(content);
        measure();
        return () => observer.disconnect();
    }, [measure]);

    useEffect(() => () => dragEndRef.current?.(), []);

    const scrollBy = (pages: number) => {
        const node = scrollRef.current;
        if (!node) {
            return;
        }
        node.scrollTop += pages * node.clientHeight * PAGE_FRACTION;
        measure();
    };

    const full = metrics.full + Math.max(0, unmountedPx);
    const range = Math.max(0, full - metrics.view);
    const scrollable = range > 1;
    const atTop = metrics.top <= 1;
    const atBottom = metrics.top >= range - 1;

    const trackPx = trackRef.current?.clientHeight ?? 0;
    const thumbPx = scrollable && full > 0
        ? Math.min(trackPx, Math.max(MIN_THUMB_PX, trackPx * (metrics.view / full)))
        : 0;
    const thumbTop = scrollable ? (metrics.top / range) * (trackPx - thumbPx) : 0;

    const startDrag = (event: { clientY: number; preventDefault?: () => void; stopPropagation?: () => void }) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        const node = scrollRef.current;
        const doc = node?.ownerDocument;
        if (!node || !doc || trackPx <= thumbPx) {
            return;
        }
        dragEndRef.current?.();
        const startY = event.clientY;
        const startTop = node.scrollTop;
        const perPixel = range / (trackPx - thumbPx);
        const move = (ev: MouseEvent) => {
            node.scrollTop = startTop + (ev.clientY - startY) * perPixel;
            measure();
        };
        const end = () => {
            doc.removeEventListener("mousemove", move);
            doc.removeEventListener("mouseup", end);
            dragEndRef.current = null;
        };
        doc.addEventListener("mousemove", move);
        doc.addEventListener("mouseup", end);
        dragEndRef.current = end;
    };

    const pageFromTrack = (event: { clientY: number; preventDefault?: () => void }) => {
        event.preventDefault?.();
        const track = trackRef.current;
        if (!track || !scrollable) {
            return;
        }
        const y = event.clientY - track.getBoundingClientRect().top;
        const direction = y < thumbTop ? -1 : 1;
        logFocusDebug("browser-scroll", "track", `y=${Math.round(y)} direction=${direction}`);
        scrollBy(direction);
    };

    const buttonStyle = (dimmed: boolean): Record<string, string> => ({
        minWidth: "0",
        width: "100%",
        height: `${modalSize(railPx)}px`,
        padding: "0",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: dimmed ? "0.35" : "1"
    });

    return (
        <div style={{ flex: "1 1 auto", minHeight: "0", display: "flex", gap: `${modalSize(gapPx)}px` }}>
            <div
                style={{
                    flex: "1 1 auto",
                    minWidth: "0",
                    minHeight: "0",
                    display: "flex",
                    flexDirection: "column",
                    gap: `${modalSize(gapPx)}px`
                }}
            >
                {header}
                <div
                    ref={scrollRef}
                    className="cd-browser-scroll"
                    onScroll={measure}
                    style={{ flex: "1 1 auto", minWidth: "0", minHeight: "0", overflowY: "auto" }}
                >
                    <div ref={contentRef} style={{ display: "flex", flexDirection: "column", gap: rowGap }}>
                        {children}
                    </div>
                </div>
            </div>
            <div
                style={{
                    flex: "0 0 auto",
                    width: `${modalSize(railPx)}px`,
                    display: "flex",
                    flexDirection: "column",
                    gap: `${modalSize(gapPx)}px`
                }}
            >
                <div style={{ flex: "0 0 auto" }}>
                    <DialogButton {...act("scroll:up", () => scrollBy(-1))} style={buttonStyle(!scrollable || atTop)}>
                        <FaChevronUp size={modalSize(11)} />
                    </DialogButton>
                </div>
                <div
                    ref={trackRef}
                    onMouseDown={pageFromTrack}
                    style={{
                        position: "relative",
                        flex: "1 1 auto",
                        minHeight: "0",
                        borderRadius: `${modalSize(4)}px`,
                        background: "rgba(255, 255, 255, 0.06)"
                    }}
                >
                    {scrollable && (
                        <div
                            onMouseDown={startDrag}
                            style={{
                                position: "absolute",
                                left: "0",
                                right: "0",
                                top: `${thumbTop}px`,
                                height: `${thumbPx}px`,
                                borderRadius: `${modalSize(4)}px`,
                                background: "rgba(255, 255, 255, 0.35)"
                            }}
                        />
                    )}
                </div>
                <div style={{ flex: "0 0 auto" }}>
                    <DialogButton {...act("scroll:down", () => scrollBy(1))} style={buttonStyle(!scrollable || atBottom)}>
                        <FaChevronDown size={modalSize(11)} />
                    </DialogButton>
                </div>
            </div>
        </div>
    );
}
