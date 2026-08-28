import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DialogButton, Focusable, ModalRoot, ScrollPanelGroup } from "@decky/ui";
import type { AotwComment, ControllerGlyphStyle, GameComment, SaveCommentResponse } from "../../types";
import type { LanguageCode } from "../../locales";
import { t } from "../../locales";
import { ButtonGlyph } from "../ui/ButtonGlyph";
import { ExternalLink } from "../ui/ExternalLink";
import { UserAvatar } from "../ui/UserAvatar";
import { formatUnlockDate } from "../../utils/achievements";
import { BUTTON_OPTIONS, BUTTON_SECONDARY } from "../../utils/gamepadButtons";
import { glyphAsset, probeGlyphPath, resolveGlyphStyle } from "../../utils/controllerGlyphs";
import { findLinks, MAX_LINKS } from "../../utils/links";
import { playOkSound, playToggleSound } from "../../utils/navSound";
import { modalSize } from "../../utils/scale";
import { FADE_IN_KEYFRAMES, modalBodyStyle } from "../../utils/style";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

export type CommentSaveControl = {
    saved: boolean;
    onSave: () => Promise<SaveCommentResponse>;
    onUnsave: (id?: string) => Promise<boolean>;
};

export type CommentViewModalProps = {
    comment: AotwComment | GameComment;
    language: LanguageCode;
    close: () => void;
    onOpenExternal?: () => void | Promise<void>;
    saveControl?: CommentSaveControl;
    controllerGlyphStyle: ControllerGlyphStyle;
    mouseKeyboardMode: boolean;
};

const SAVED_COMMENTS_CAP = 500;

type StatusKind = "none" | "saved" | "unsaved" | "full";

const MODAL_WIDTH_CSS = `
.cheevo-comment-dialog.DialogContent, .cheevo-comment-dialog {
    width: 78vw;
    max-width: 1000px;
}`;

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function LinkIcon({ size }: { size: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 640 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M579.8 267.7c56.5-56.5 56.5-148 0-204.5c-50-50-128.8-56.5-186.3-15.4l-1.6 1.1c-14.4 10.3-17.7 30.3-7.4 44.6s30.3 17.7 44.6 7.4l1.6-1.1c32.1-22.9 76-19.3 103.8 8.6c31.5 31.5 31.5 82.5 0 114L422.3 334.8c-31.5 31.5-82.5 31.5-114 0c-27.9-27.9-31.5-71.8-8.6-103.8l1.1-1.6c10.3-14.4 6.9-34.4-7.4-44.6s-34.4-6.9-44.6 7.4l-1.1 1.6C206.5 251.2 213 330 263 380c56.5 56.5 148 56.5 204.5 0L579.8 267.7zM60.2 244.3c-56.5 56.5-56.5 148 0 204.5c50 50 128.8 56.5 186.3 15.4l1.6-1.1c14.4-10.3 17.7-30.3 7.4-44.6s-30.3-17.7-44.6-7.4l-1.6 1.1c-32.1 22.9-76 19.3-103.8-8.6C74 372 74 321 105.5 289.5L217.7 177.2c31.5-31.5 82.5-31.5 114 0c27.9 27.9 31.5 71.8 8.6 103.9l-1.1 1.6c-10.3 14.4-6.9 34.4 7.4 44.6s34.4 6.9 44.6-7.4l1.1-1.6C433.5 260.8 427 182 377 132c-56.5-56.5-148-56.5-204.5 0L60.2 244.3z" />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function ArrowRightIcon({ size }: { size: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M502.6 278.6c12.5-12.5 12.5-32.8 0-45.3l-128-128c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L402.7 224 32 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l370.7 0-73.4 73.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l128-128z" />
        </svg>
    );
}

function cornerButtonStyle(focused: boolean, gold: boolean): CSSProperties {
    return {
        minWidth: 0,
        width: `${modalSize(38)}px`,
        height: `${modalSize(38)}px`,
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: `${modalSize(22)}px`,
        lineHeight: 1,
        borderRadius: "8px",
        color: gold
            ? "#fbbf24"
            : focused
                ? "rgba(24,24,24,0.98)"
                : "rgba(255,255,255,0.92)",
        background: focused ? "rgba(255,255,255,0.96)" : "rgba(24,24,24,0.82)",
        border: focused ? "1px solid rgba(255,255,255,1)" : "1px solid rgba(255,255,255,0.4)",
        boxShadow: focused
            ? "0 0 0 2px rgba(255,255,255,0.85), 0 2px 8px rgba(0,0,0,0.5)"
            : "0 2px 6px rgba(0,0,0,0.35)"
    };
}

export function CommentViewModal(props: CommentViewModalProps) {
    const { comment, language, close, onOpenExternal, saveControl, controllerGlyphStyle, mouseKeyboardMode } = props;

    const username = String(comment.user || "").trim() || t(language, "Someone");
    const body = String(comment.commentText || "").trim();
    const dateText = formatUnlockDate(comment.submitted, { includeYear: true }, language);

    const [saved, setSaved] = useState<boolean>(saveControl?.saved ?? false);
    const [savedId, setSavedId] = useState<string | null>(null);
    const [statusKind, setStatusKind] = useState<StatusKind>("none");
    const [busy, setBusy] = useState(false);
    const [starFocused, setStarFocused] = useState(false);
    const [linkFocused, setLinkFocused] = useState(false);
    const [view, setView] = useState<"comment" | "links">("comment");
    const [bodyFocused, setBodyFocused] = useState(false);
    const [bodyDomFocused, setBodyDomFocused] = useState(false);

    const rootRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const root = rootRef.current;
        if (!root) {
            return;
        }
        const body = root.querySelector(
            '[data-focus-key="commentview:body"] [tabindex]'
        ) as HTMLElement | null;
        if (body) {
            body.focus();
        }
    }, []);

    async function handleOpenExternal() {
        if (!onOpenExternal) {
            return;
        }
        close();
        await onOpenExternal();
    }

    const links = useMemo(() => findLinks(body), [body]);
    const showLinkButton = links.length > 0 && view === "comment";
    const showStar = Boolean(saveControl) && view === "comment";
    const reservedCorners = (links.length > 0 ? 1 : 0) + (saveControl ? 1 : 0);

    function goToLinks() {
        setStarFocused(false);
        setLinkFocused(false);
        setView("links");
    }

    function handleCancel() {
        if (view === "links") {
            setView("comment");
            return;
        }
        close();
    }

    async function handleToggleSave() {
        if (!saveControl || busy) {
            return;
        }
        setBusy(true);
        try {
            if (saved) {
                const ok = await saveControl.onUnsave(savedId ?? undefined);
                if (ok) {
                    setSaved(false);
                    setSavedId(null);
                    setStatusKind("unsaved");
                }
            }
            else {
                const result = await saveControl.onSave();
                if (result?.ok) {
                    setSaved(true);
                    setSavedId(result.record?.id ?? null);
                    setStatusKind("saved");
                }
                else if (result?.error === "saved_full") {
                    setStatusKind("full");
                }
            }
        }
        finally {
            setBusy(false);
        }
    }

    const bodyHighlighted = bodyFocused || bodyDomFocused;

    const viewFocusArmed = useRef(false);
    useLayoutEffect(() => {
        if (!viewFocusArmed.current) {
            viewFocusArmed.current = true;
            return;
        }
        const doc = rootRef.current?.ownerDocument;
        if (!doc) {
            return;
        }
        const key = view === "links" ? "commentview:back" : "commentview:body";
        const container = doc.querySelector(`[data-focus-key="${key}"]`);
        const target = (container?.querySelector("button, [tabindex]") ?? container) as HTMLElement | null;
        target?.focus();
    }, [view]);

    function handleModalButtons(evt: { detail?: { button?: number } }) {
        const button = evt?.detail?.button;

        if (button === BUTTON_SECONDARY && showStar && !busy) {
            playToggleSound(!saved);
            void handleToggleSave();
            return;
        }

        if (button === BUTTON_OPTIONS && showLinkButton) {
            playOkSound();
            goToLinks();
        }
    }

    const modalLegend: Record<number, string> = {};
    if (showStar) {
        modalLegend[BUTTON_SECONDARY] = saved ? t(language, "Unsave") : t(language, "Save");
    }
    if (showLinkButton) {
        modalLegend[BUTTON_OPTIONS] = t(language, "View Links");
    }

    const helpSize = modalSize(11);
    const glyphs = resolveGlyphStyle(controllerGlyphStyle);

    function withGlyph(template: string, button: "x" | "y"): ReactNode {
        const [before, after = ""] = template.split("{{button}}");
        if (before === template) {
            return template;
        }
        probeGlyphPath(glyphAsset(button, glyphs).url);
        return (
            <>
                {before}
                <ButtonGlyph button={button} style={glyphs} size={Math.round(helpSize * 1.5)} />
                {after}
            </>
        );
    }

    let helpBody: ReactNode = null;
    let helpArrow = false;
    let helpTone: string | undefined;
    let helpBold = false;
    if (view === "links") {
        helpBody = t(language, "Select a link below to visit it externally.");
        helpBold = true;
    }
    else if (statusKind === "full") {
        helpBody = t(language, "Saved comments are full ({{max}}). Remove some to save more.", { max: SAVED_COMMENTS_CAP });
        helpTone = "#f87171";
        helpBold = true;
    }
    else if (statusKind === "unsaved") {
        helpBody = t(language, "Comment Unsaved.");
        helpTone = "#f87171";
        helpBold = true;
    }
    else if (statusKind === "saved") {
        helpBody = t(language, "Saved. View it in Social Hub or Quick Menu → Saved Comments.");
        helpTone = "#4ade80";
        helpBold = true;
    }
    else if (showLinkButton) {
        helpBody = withGlyph(mouseKeyboardMode
            ? t(language, "This comment contains links. View them here")
            : t(language, "This comment contains links. Press {{button}} or view them here"), "y");
        helpArrow = true;
        helpBold = true;
    }
    else if (saveControl && !saved) {
        helpBody = withGlyph(mouseKeyboardMode
            ? t(language, "Want to save this comment? Select this button")
            : t(language, "Want to save this comment? Press {{button}} or select this button"), "x");
        helpArrow = true;
        helpBold = true;
    }
    else if (saved) {
        helpBody = t(language, "View this in Social Hub or Quick Menu → Saved Comments.");
        helpBold = true;
    }

    return (
        <ModalRoot onCancel={handleCancel} onEscKeypress={handleCancel} onButtonDown={handleModalButtons} actionDescriptionMap={modalLegend} className="cheevo-comment-dialog">
            <SnapshotHotkey language={language} />
            <style>{MODAL_WIDTH_CSS}</style>
            <div ref={rootRef} style={{ position: "relative" }}>
                <style>{FADE_IN_KEYFRAMES}</style>
                {(showLinkButton || showStar) && (
                    <Focusable
                        flow-children="row"
                        style={{
                            position: "absolute",
                            top: 0,
                            right: 0,
                            zIndex: 2,
                            display: "flex",
                            gap: "6px"
                        }}
                        onButtonDown={handleModalButtons}
                        actionDescriptionMap={modalLegend}
                    >
                        {showLinkButton && (
                            <DialogButton
                                onClick={goToLinks}
                                onGamepadFocus={() => setLinkFocused(true)}
                                onGamepadBlur={() => setLinkFocused(false)}
                                style={cornerButtonStyle(linkFocused, false)}
                            >
                                <LinkIcon size={modalSize(19)} />
                            </DialogButton>
                        )}
                        {showStar && (
                            <DialogButton
                                onClick={handleToggleSave}
                                onGamepadFocus={() => setStarFocused(true)}
                                onGamepadBlur={() => setStarFocused(false)}
                                style={cornerButtonStyle(starFocused, saved)}
                            >
                                {saved ? "★" : "☆"}
                            </DialogButton>
                        )}
                    </Focusable>
                )}
                {
}
                <div
                    style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "12px",
                        marginBottom: "14px",
                        paddingRight: reservedCorners > 0 ? `${modalSize(44) * reservedCorners}px` : 0
                    }}
                >
                    <UserAvatar
                        username={username}
                        size={48}
                        fontSize={22}
                    />
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
                        <div
                            style={{
                                fontSize: `${modalSize(20)}px`,
                                fontWeight: 800,
                                lineHeight: 1.1,
                                wordBreak: "break-word"
                            }}
                        >
                            {username}
                        </div>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "5px",
                                minWidth: 0,
                                fontSize: `${helpSize}px`,
                                lineHeight: 1.2,
                                color: helpTone,
                                opacity: helpTone ? 1 : 0.75,
                                fontWeight: helpBold ? 700 : 400
                            }}
                        >
                            <span
                                style={{
                                    minWidth: 0,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap"
                                }}
                            >
                                {helpBody}
                            </span>
                            {helpArrow && (
                                <span style={{ display: "inline-flex", flexShrink: 0 }}>
                                    <ArrowRightIcon size={Math.round(helpSize * 1.15)} />
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {view === "comment" ? (
                    <div
                        data-focus-key="commentview:body"
                        onFocusCapture={() => setBodyDomFocused(true)}
                        onBlurCapture={() => setBodyDomFocused(false)}
                        style={{
                            maxHeight: "55vh",
                            minHeight: "60px",
                            background: "rgba(255,255,255,0.04)",
                            border: bodyHighlighted ? "1px solid #4a9eff" : "1px solid rgba(255,255,255,0.10)",
                            borderRadius: "6px",
                            boxShadow: bodyHighlighted ? "0 0 0 2px rgba(74,158,255,0.55)" : "none",
                            overflow: "hidden",
                            display: "flex",
                            flexDirection: "column"
                        }}
                    >
                        {ScrollPanelGroup ? (
                            <ScrollPanelGroup
                                focusable={false}
                                style={{ flex: 1, minHeight: 0 }}
                            >
                                <Focusable
                                    onActivate={() => { }}
                                    noFocusRing={true}
                                    onGamepadFocus={() => setBodyFocused(true)}
                                    onGamepadBlur={() => setBodyFocused(false)}
                                    onButtonDown={handleModalButtons}
                                    actionDescriptionMap={modalLegend}
                                >
                                    <div
                                        style={{
                                            padding: "10px 12px",
                                            fontSize: `${modalSize(15)}px`,
                                            lineHeight: 1.45,
                                            whiteSpace: "pre-wrap",
                                            wordBreak: "break-word"
                                        }}
                                    >
                                        {body || (
                                            <span style={{ opacity: 0.6, fontStyle: "italic" }}>
                                                {t(language, "No comment text.")}
                                            </span>
                                        )}
                                    </div>
                                </Focusable>
                            </ScrollPanelGroup>
                        ) : (
                            <div
                                style={{
                                    maxHeight: "55vh",
                                    overflowY: "auto",
                                    padding: "10px 12px",
                                    fontSize: `${modalSize(15)}px`,
                                    lineHeight: 1.45,
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-word"
                                }}
                            >
                                {body || (
                                    <span style={{ opacity: 0.6, fontStyle: "italic" }}>
                                        {t(language, "No comment text.")}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <Focusable
                        key="links"
                        style={{ width: "100%" }}
                        onButtonDown={handleModalButtons}
                        actionDescriptionMap={modalLegend}
                    >
                        <div data-focus-key="commentview:back" style={{ display: "flex", marginBottom: "10px" }}>
                            <DialogButton onClick={() => setView("comment")}>
                                {t(language, "← Back")}
                            </DialogButton>
                        </div>
                        <div
                            style={{
                                ...modalBodyStyle(15),
                                opacity: 1,
                                maxHeight: "55vh",
                                overflowY: "auto",
                                display: "flex",
                                flexDirection: "column",
                                gap: "6px"
                            }}
                        >
                            {links.slice(0, MAX_LINKS).map((link) => (
                                <ExternalLink key={link.url} url={link.url} onBeforeNavigate={close} block>
                                    <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
                                        <span style={{ fontWeight: 700, wordBreak: "break-word" }}>
                                            {link.label || link.url}
                                        </span>
                                        {link.label ? (
                                            <span style={{ opacity: 0.75, fontSize: "0.85em", wordBreak: "break-word" }}>
                                                {link.url}
                                            </span>
                                        ) : null}
                                    </div>
                                </ExternalLink>
                            ))}
                            {links.length > MAX_LINKS && (
                                <div style={{ opacity: 0.75, paddingTop: "4px" }}>
                                    {t(language, "Only the first {{count}} links are shown.", { count: MAX_LINKS })}
                                </div>
                            )}
                        </div>
                    </Focusable>
                )}

                {
}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "12px",
                        marginTop: "14px"
                    }}
                >
                    <div
                        style={{
                            fontSize: `${modalSize(13)}px`,
                            opacity: 0.75,
                            fontWeight: 700
                        }}
                    >
                        {dateText}
                    </div>
                    <Focusable
                        flow-children="row"
                        style={{
                            display: "flex",
                            gap: "8px"
                        }}
                        onButtonDown={handleModalButtons}
                        actionDescriptionMap={modalLegend}
                    >
                        {onOpenExternal && (
                            <DialogButton onClick={handleOpenExternal}>
                                {t(language, "Open/Post")}
                            </DialogButton>
                        )}
                        <DialogButton onClick={close}>
                            {t(language, "Close")}
                        </DialogButton>
                    </Focusable>
                </div>

            </div>
        </ModalRoot>
    );
}
