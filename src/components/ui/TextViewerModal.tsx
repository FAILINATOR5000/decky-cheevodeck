import { DialogButton, Focusable, ModalRoot, ScrollPanelGroup } from "@decky/ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { InlineSpinner } from "./InlineSpinner";
import { withInlineTags } from "./inlineTags";
import { loadHelpDocument, saveTextViewerZoom } from "../../api";
import { logError } from "../../utils/errors";
import { t, type LanguageCode } from "../../locales";
import { BUTTON_TRIGGER_LEFT, BUTTON_TRIGGER_RIGHT } from "../../utils/gamepadButtons";
import { legendGlyph, PROGRESS_MARK_PX, PROGRESS_TRACK_PX } from "../guides/GuidesReaderBody";
import { findScroller } from "../../utils/guidesAnchors";
import { FADE_IN_KEYFRAMES } from "../../utils/style";
import {
    clampGuideZoom,
    getCurrentTextViewerZoom,
    modalSize,
    setCurrentTextViewerZoom,
    GUIDE_ZOOM_STEP,
} from "../../utils/scale";
import { SnapshotHotkey } from "./SnapshotHotkey";

type TextViewerModalProps = {
    language: LanguageCode;
    mouseKeyboardMode: boolean;
    title: string;
    documentName?: string;
    text?: string;
    close: () => void;
};

const BODY_BASE_PX = 10;

const SHOW_TEXT = 4;
const CARET_PROBE_INSET_PX = 2;

const MODAL_WIDTH_CSS = `
.cheevo-text-dialog.DialogContent, .cheevo-text-dialog {
    width: min(86vw, 900px);
}`;

function offsetAtTopOfView(host: HTMLElement, scroller: HTMLElement): number | null {
    const doc = host.ownerDocument;
    const box = scroller.getBoundingClientRect();
    const caret = doc.caretRangeFromPoint?.(box.left + CARET_PROBE_INSET_PX, box.top + CARET_PROBE_INSET_PX);
    if (!caret) {
        return null;
    }

    const walk = doc.createTreeWalker(host, SHOW_TEXT);
    let seen = 0;
    while (walk.nextNode()) {
        const node = walk.currentNode;
        if (node === caret.startContainer) {
            return seen + caret.startOffset;
        }
        seen += node.textContent?.length ?? 0;
    }
    return null;
}

function scrollOffsetIntoView(host: HTMLElement, scroller: HTMLElement, offset: number): boolean {
    const doc = host.ownerDocument;
    const walk = doc.createTreeWalker(host, SHOW_TEXT);
    let seen = 0;
    while (walk.nextNode()) {
        const node = walk.currentNode;
        const length = node.textContent?.length ?? 0;
        if (seen + length >= offset) {
            const at = doc.createRange();
            const into = offset - seen;
            at.setStart(node, into);
            at.setEnd(node, Math.min(into + 1, length));
            scroller.scrollTop += at.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
            return true;
        }
        seen += length;
    }
    return false;
}

export function TextViewerModal(props: TextViewerModalProps) {
    const { language, mouseKeyboardMode, title, documentName, text: providedText, close } = props;

    const [text, setText] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const [zoom, setZoom] = useState<number>(() => getCurrentTextViewerZoom());
    const [bodyFocused, setBodyFocused] = useState(false);

    const hostRef = useRef<HTMLDivElement | null>(null);
    const focusedRef = useRef(false);
    const railRef = useRef<HTMLDivElement | null>(null);
    const markRef = useRef<HTMLDivElement | null>(null);
    const restoreOffsetRef = useRef<number | null>(null);
    const restoreRatioRef = useRef<number | null>(null);

    useEffect(() => {
        if (providedText !== undefined) {
            if (providedText) {
                setText(providedText);
            }
            else {
                setFailed(true);
            }
            return;
        }
        if (!documentName) {
            setFailed(true);
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const result = await loadHelpDocument(documentName);
                if (cancelled) {
                    return;
                }
                if (result?.ok && result.text) {
                    setText(result.text);
                }
                else {
                    setFailed(true);
                }
            }
            catch (err) {
                logError(`TextViewerModal could not load ${documentName}`, err);
                if (!cancelled) {
                    setFailed(true);
                }
            }
        })();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (text === null || focusedRef.current) {
            return;
        }
        focusedRef.current = true;
        requestAnimationFrame(() => {
            const focusable = hostRef.current?.closest("[tabindex]") as HTMLElement | null;
            focusable?.focus({ preventScroll: true });
        });
    }, [text]);

    function paintProgress() {
        const rail = railRef.current;
        const mark = markRef.current;
        if (!rail || !mark) {
            return;
        }

        const scroller = findScroller(hostRef.current, null);
        const range = scroller ? scroller.scrollHeight - scroller.clientHeight : 0;
        if (!scroller || range <= 0) {
            rail.style.opacity = "0";
            return;
        }

        rail.style.opacity = "1";
        const pct = Math.min(1, Math.max(0, scroller.scrollTop / range)) * 100;
        mark.style.top = `${pct}%`;
        mark.style.transform = `translateY(-${pct}%)`;
    }

    useEffect(() => {
        if (text === null) {
            return;
        }

        paintProgress();
        const settle = requestAnimationFrame(paintProgress);

        const scroller = findScroller(hostRef.current, null);
        scroller?.addEventListener("scroll", paintProgress, { passive: true });
        return () => {
            cancelAnimationFrame(settle);
            scroller?.removeEventListener("scroll", paintProgress);
        };
    }, [text, zoom]);

    function stepZoom(delta: number) {
        const next = clampGuideZoom(getCurrentTextViewerZoom() + delta * GUIDE_ZOOM_STEP);
        if (next === zoom) {
            return;
        }

        const host = hostRef.current;
        const scroller = findScroller(host, null);
        if (host && scroller) {
            restoreOffsetRef.current = offsetAtTopOfView(host, scroller);
            const range = scroller.scrollHeight - scroller.clientHeight;
            restoreRatioRef.current = range > 0 ? scroller.scrollTop / range : null;
        }

        setCurrentTextViewerZoom(next);
        setZoom(next);
        void saveTextViewerZoom(next);
    }

    useLayoutEffect(() => {
        const offset = restoreOffsetRef.current;
        const ratio = restoreRatioRef.current;
        restoreOffsetRef.current = null;
        restoreRatioRef.current = null;
        if (offset === null && ratio === null) {
            return;
        }

        const host = hostRef.current;
        const scroller = findScroller(host, null);
        if (!host || !scroller) {
            return;
        }

        const put = () => {
            if (offset !== null && scrollOffsetIntoView(host, scroller, offset)) {
                return;
            }
            const range = scroller.scrollHeight - scroller.clientHeight;
            if (ratio !== null && range > 0) {
                scroller.scrollTop = ratio * range;
            }
        };

        put();
        const settle = requestAnimationFrame(put);
        return () => { cancelAnimationFrame(settle); };
    }, [zoom]);

    const bodyFont = (BODY_BASE_PX * zoom) / 100;

    const body = (
        <div
            ref={hostRef}
            style={{
                padding: "8px 10px",
                maxWidth: "100%",
                minWidth: 0,
                fontSize: `${bodyFont}px`,
                lineHeight: 1.5,
                fontFamily: "monospace",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                wordBreak: "break-word",
            }}
        >
            {text === null ? null : withInlineTags(text)}
        </div>
    );

    return (
        <ModalRoot onCancel={close} onEscKeypress={close} className="cheevo-text-dialog">
            <SnapshotHotkey language={language} />
            <div
                style={{
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    minHeight: "70vh",
                    padding: "0 3px"
                }}
            >
                <style>{FADE_IN_KEYFRAMES}</style>
                <style>{MODAL_WIDTH_CSS}</style>

                <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                    {mouseKeyboardMode && (
                        <>
                            <DialogButton onClick={() => stepZoom(-1)} focusable={false} style={{ minWidth: 0, width: `${modalSize(48)}px` }}>
                                −
                            </DialogButton>
                            <DialogButton onClick={() => stepZoom(1)} focusable={false} style={{ minWidth: 0, width: `${modalSize(48)}px` }}>
                                +
                            </DialogButton>
                        </>
                    )}
                    <div
                        style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: `${modalSize(15)}px`,
                            fontWeight: 700,
                            textAlign: "left",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical" as const,
                            overflow: "hidden",
                            overflowWrap: "anywhere"
                        }}
                    >
                        {title}
                    </div>
                </div>

                {text === null ? (
                    <div style={{ padding: "8px 2px" }}>
                        {failed
                            ? <div style={{ opacity: 0.6, fontStyle: "italic" }}>{t(language, "Nothing to show.")}</div>
                            : <InlineSpinner label={t(language, "Loading...")} />}
                    </div>
                ) : (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            flex: 1,
                            minHeight: 0,
                            maxHeight: "62vh",
                            width: "100%",
                            border: bodyFocused ? "1px solid #4a9eff" : "1px solid rgba(255,255,255,0.10)",
                            borderRadius: "6px",
                            boxShadow: bodyFocused ? "0 0 0 2px rgba(74,158,255,0.55)" : "none",
                            overflow: "hidden",
                            position: "relative"
                        }}
                    >
                        <ScrollPanelGroup
                            focusable={false}
                            style={{ flex: 1, minHeight: 0, width: "100%" }}
                        >
                            <Focusable
                                onActivate={() => { }}
                                noFocusRing={true}
                                onCancelButton={close}
                                onGamepadFocus={() => setBodyFocused(true)}
                                onGamepadBlur={() => setBodyFocused(false)}
                                onButtonDown={(evt: { detail?: { button?: number } }) => {
                                    const button = evt?.detail?.button;
                                    if (button === BUTTON_TRIGGER_LEFT) {
                                        stepZoom(-1);
                                    }
                                    else if (button === BUTTON_TRIGGER_RIGHT) {
                                        stepZoom(1);
                                    }
                                }}
                                actionDescriptionMap={{
                                    [BUTTON_TRIGGER_LEFT]: legendGlyph("−"),
                                    [BUTTON_TRIGGER_RIGHT]: legendGlyph("+")
                                }}
                            >
                                {body}
                            </Focusable>
                        </ScrollPanelGroup>
                        <div
                            ref={railRef}
                            style={{
                                position: "absolute",
                                top: "6px",
                                bottom: "6px",
                                right: "3px",
                                width: `${PROGRESS_TRACK_PX}px`,
                                borderRadius: `${PROGRESS_TRACK_PX}px`,
                                background: "rgba(255, 255, 255, 0.10)",
                                pointerEvents: "none",
                                opacity: 0
                            }}
                        >
                            <div
                                ref={markRef}
                                style={{
                                    position: "absolute",
                                    left: 0,
                                    width: `${PROGRESS_TRACK_PX}px`,
                                    height: `${PROGRESS_MARK_PX}px`,
                                    borderRadius: `${PROGRESS_TRACK_PX}px`,
                                    background: "rgba(255, 255, 255, 0.55)"
                                }}
                            />
                        </div>
                    </div>
                )}
            </div>
        </ModalRoot>
    );
}
