import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";

import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { useEffect, useMemo, useRef, useState } from "react";

import { FADE_IN_KEYFRAMES } from "../../utils/style";
import { t, type LanguageCode } from "../../locales";
import {
    modalSize,
    clampGuideZoom,
    getCurrentGuideModalZoom,
    setCurrentGuideModalZoom,
    GUIDE_ZOOM_STEP,
} from "../../utils/scale";
import { BUMPER_LEFT, BUMPER_RIGHT, GuidesReaderBody, legendGlyph } from "./GuidesReaderBody";
import { GuidesBookmarksModal } from "./GuidesBookmarksModal";
import { MODAL_ECHO_WINDOW_MS, showManagedModal } from "../../utils/modalRegistry";
import { scanGuideHtml, SEARCH_MATCH_LIMIT, SEARCH_MIN_TERM } from "../../utils/guidesSearch";
import type { GuideBookmark } from "../../types";
import { FadeImage } from "../ui/FadeImage";
import { InlineSpinner } from "../ui/InlineSpinner";
import { ErrorText } from "../ui/ErrorText";
import { NETWORK_WAIT_MS, SLOW_WAIT_MS, useSlowWait } from "../../hooks/useSlowWait";
import { useGameIcon } from "../../hooks/useGameIcon";
import { extractGuideLines } from "../../utils/guidesRender";
import { chunkAnchorHtml, chunkGuideLines, spotTarget, type GuideSpot } from "../../utils/guidesChunk";
import { chunkFormattedHtml, joinFormattedPages, type GuidePage } from "../../utils/guidesBlocks";
import {
    guideFailureText,
    GuidesBrowserSession,
    type GuideContent,
    type GuidePageFetch,
    type GuideReaderError,
    type GuideTocEntry,
} from "../../utils/guidesFetch";
import { loadGuidePage } from "../../utils/guidesCache";
import { urlSections } from "../../utils/guidesToc";
import { fireArmedGuideRevalidate } from "../../utils/guidesRevalidate";
import {
    addGuideBookmark,
    removeGuideBookmark,
    loadGameGuides,
    logGuidesDebug,
    saveGuidePosition,
    saveGuideModalZoom,
} from "../../api";

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function BookmarkIcon({ size = 14 }: { size?: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 384 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M0 48V487.7C0 501.1 10.9 512 24.3 512c5 0 9.9-1.5 14-4.4L192 400 345.7 507.6c4.1 2.9 9 4.4 14 4.4c13.4 0 24.3-10.9 24.3-24.3V48c0-26.5-21.5-48-48-48H48C21.5 0 0 21.5 0 48z" />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function SearchIcon({ size = 14 }: { size?: number | string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M505 442.7L405.3 343c-4.5-4.5-10.6-7-17-7H372c27.6-35.3 44-79.7 44-128C416 93.1 322.9 0 208 0S0 93.1 0 208s93.1 208 208 208c48.3 0 92.7-16.4 128-44v16.3c0 6.4 2.5 12.5 7 17l99.7 99.7c9.4 9.4 24.6 9.4 33.9 0l28.3-28.3c9.4-9.4 9.4-24.6.1-34zM208 336c-70.7 0-128-57.2-128-128 0-70.7 57.2-128 128-128 70.7 0 128 57.2 128 128 0 70.7-57.2 128-128 128z" />
        </svg>
    );
}

const SEARCH_DEBOUNCE_MS = 200;

const SEARCH_ROW_PX = 44;

const MODAL_STEP_BUTTON_STYLE = {
    minWidth: 0,
    width: "34px",
    height: "26px",
    padding: "0",
    flex: "0 0 auto",
};

type GuidesReaderModalProps = {
    language: LanguageCode;
    title: string;
    gameId: number | null;
    imageIcon: string | null;
    showIcons: boolean;
    faqId: string | null;
    gameUrl: string | null;
    initialContent: GuideContent | null;
    mouseKeyboardMode: boolean;
    close: () => void;
    initialLine?: number | null;
    initialInto?: number;
    initialSection?: string | null;
    onClosed?: () => void;
};

type AnchoredGuide = { content: GuideContent; pages: GuidePage[] };

function anchoredContent(content: GuideContent): AnchoredGuide {
    if (content.kind === "formatted") {
        const pages = chunkFormattedHtml(content.html);
        if (pages.length === 0) {
            return { content, pages: [] };
        }
        return {
            content: { html: joinFormattedPages(pages), kind: content.kind, toc: content.toc },
            pages,
        };
    }
    const chunks = chunkGuideLines(extractGuideLines(content.html));
    if (chunks.length === 0) {
        return { content, pages: [] };
    }
    return {
        content: { html: chunkAnchorHtml(chunks), kind: content.kind, toc: content.toc },
        pages: chunks,
    };
}

const MODAL_WIDTH_CSS = `
.cheevo-guide-dialog.DialogContent, .cheevo-guide-dialog {
    width: 86vw;
}`;

export function GuidesReaderModal(props: GuidesReaderModalProps) {
    const { language, title, gameId, faqId, gameUrl, initialContent, initialLine, initialSection, close } = props;

    const { iconDataUri, cold } = useGameIcon(
        props.showIcons ? gameId : null,
        props.imageIcon,
        "GuidesReaderModal useGameIcon"
    );

    const seededRef = useRef(initialContent != null && initialLine != null);
    const [doc, setDoc] = useState<AnchoredGuide | null>(
        () => (initialContent ? anchoredContent(initialContent) : null)
    );
    const content = doc?.content ?? null;
    const [loading, setLoading] = useState(false);
    const [cfWaiting, setCfWaiting] = useState(false);
    const [waitIsSlow, setWaitIsSlow] = useState(false);
    const [zoom, setZoom] = useState<number>(() => getCurrentGuideModalZoom());
    const [positionLoaded, setPositionLoaded] = useState(seededRef.current);
    const [loadFailure, setLoadFailure] = useState<GuideReaderError | null>(null);
    const [networkFetch, setNetworkFetch] = useState(false);
    const failIsSlow = useSlowWait(loadFailure !== null);
    const showingPlaceholder = !positionLoaded || (loading && !content);
    useEffect(() => {
        if (!showingPlaceholder) {
            setWaitIsSlow(false);
            return;
        }
        const timer = setTimeout(() => setWaitIsSlow(true), SLOW_WAIT_MS);
        return () => clearTimeout(timer);
    }, [showingPlaceholder]);
    const [sections, setSections] = useState<GuideTocEntry[]>(
        () => (initialContent?.kind === "formatted" ? urlSections(initialContent.toc) : [])
    );
    const [sectionSlug, setSectionSlug] = useState<string | null>(initialSection ?? null);
    const [turning, setTurning] = useState(false);
    const turnIsSlow = useSlowWait(turning && networkFetch, NETWORK_WAIT_MS);
    const [bookmarks, setBookmarks] = useState<GuideBookmark[]>([]);
    const [jumpToken, setJumpToken] = useState(0);

    const restoreLineRef = useRef<number | null>(initialLine ?? null);
    const lineRef = useRef<number | null>(null);
    const restoreIntoRef = useRef(props.initialInto ?? 0);
    const intoRef = useRef(0);
    const autoFocusedRef = useRef(false);

    const [searchOpen, setSearchOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [matchAt, setMatchAt] = useState(0);
    const searchBoxRef = useRef<HTMLDivElement | null>(null);
    const [searchFocusToken, setSearchFocusToken] = useState(0);
    const jumpedForRef = useRef("");
    const escapeAtRef = useRef(0);
    const [searchJump, setSearchJump] = useState(0);

    useEffect(() => {
        const timer = setTimeout(() => setSearchQuery(searchTerm), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    const liveTerm = searchQuery.trim().length >= SEARCH_MIN_TERM ? searchQuery : "";

    const matches = useMemo(
        () => scanGuideHtml(content?.html ?? "", liveTerm),
        [content, liveTerm]
    );
    const currentMatch = matches[matchAt] ?? null;

    const writePosition = (target: GuideContent | null) => {
        if (!target || gameId == null || !faqId) {
            logGuidesDebug("save", "modal", `skipped: content=${target ? 1 : 0} game=${gameId ?? -1} faq=${faqId ?? ""}`);
            return Promise.resolve();
        }
        const line = lineRef.current;
        if (line === null) {
            logGuidesDebug("save", "modal", `skipped: no line, faq=${faqId} restore=${restoreLineRef.current ?? -1}`);
            return Promise.resolve();
        }
        const anchor = sections.length > 1 ? (sectionSlug ?? sections[0]?.slug ?? "") : "";
        const total = sections.length > 1 ? sections.length : 0;
        logGuidesDebug(
            "save",
            "modal",
            `faq=${faqId} line=${line} into=${intoRef.current.toFixed(4)} `
            + `anchor=${anchor || "(none)"} total=${total} kind=${target.kind}`
        );
        return saveGuidePosition(gameId, faqId, line, anchor, intoRef.current, total, target.kind)
            .then(() => undefined)
            .catch(() => undefined);
    };

    const persistRef = useRef<() => Promise<void>>(() => Promise.resolve());
    persistRef.current = () => writePosition(content);
    const onClosedRef = useRef(props.onClosed);
    onClosedRef.current = props.onClosed;

    useEffect(() => {
        return () => {
            void persistRef.current().then(() => onClosedRef.current?.());
        };
    }, []);

    const rootRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const doc = rootRef.current?.ownerDocument;
        const view = doc?.defaultView;
        if (!doc || !view) {
            return;
        }
        const persistNow = () => {
            void persistRef.current();
        };
        const onVisibilityChange = () => {
            if (doc.visibilityState === "hidden") {
                persistNow();
            }
        };
        doc.addEventListener("visibilitychange", onVisibilityChange);
        view.addEventListener("blur", persistNow);
        return () => {
            doc.removeEventListener("visibilitychange", onVisibilityChange);
            view.removeEventListener("blur", persistNow);
        };
    }, []);

    const fetchPage = async (session: GuidesBrowserSession, slug: string): Promise<GuidePageFetch> => {
        if (gameId == null || !faqId || !gameUrl) return { content: null, failure: null };
        setNetworkFetch(false);
        try {
            return await loadGuidePage(gameId, faqId, slug, session, gameUrl, () => setNetworkFetch(true));
        }
        finally {
            setNetworkFetch(false);
        }
    };

    const sessionRef = useRef<GuidesBrowserSession | null>(null);
    useEffect(() => {
        const session = new GuidesBrowserSession({ onChallenge: setCfWaiting });
        sessionRef.current = session;
        let cancelled = false;

        void (async () => {
            let savedLine = 0;
            if (gameId != null && faqId) {
                try {
                    const record = await loadGameGuides(gameId);
                    const saved = record?.guides?.[faqId];
                    if (saved) {
                        savedLine = saved.lastPage || 0;
                        if (!seededRef.current && initialLine == null) {
                            restoreIntoRef.current = saved.lastScroll || 0;
                        }
                        setBookmarks(Array.isArray(saved.bookmarks) ? saved.bookmarks : []);
                    }
                }
                catch {
                }
            }
            if (cancelled) return;

            let loaded = initialContent;
            if (!loaded) {
                setLoading(true);
                setLoadFailure(null);
                const fetched = await fetchPage(session, initialSection || "0");
                if (cancelled) return;
                loaded = fetched.content;
                if (!loaded) {
                    setLoadFailure(fetched.failure ?? "unknown");
                }
            }

            if (loaded && !seededRef.current) {
                restoreLineRef.current = initialLine ?? savedLine;
                if (initialLine != null) {
                    restoreIntoRef.current = props.initialInto ?? 0;
                }
                setSections(loaded.kind === "formatted" ? urlSections(loaded.toc) : []);
                setDoc(anchoredContent(loaded));
            }
            setLoading(false);
            setPositionLoaded(true);
        })();

        return () => {
            cancelled = true;
            sessionRef.current = null;
            void session.destroy();
            fireArmedGuideRevalidate();
        };
    }, []);

    const sectionIndex = useMemo(() => {
        if (sections.length === 0) return 0;
        if (!sectionSlug) return 0;
        const at = sections.findIndex((entry) => entry.slug === sectionSlug);
        return at < 0 ? 0 : at;
    }, [sections, sectionSlug]);

    const sectionPaged = sections.length > 1;
    const currentSection = sectionPaged ? (sections[sectionIndex] ?? null) : null;

    function turnSection(delta: number) {
        if (!sectionPaged || turning) return;
        const next = sectionIndex + delta;
        if (next < 0 || next >= sections.length) return;
        const session = sessionRef.current;
        if (!session) return;
        const target = sections[next];
        setTurning(true);
        void (async () => {
            try {
                await writePosition(content);
                setLoadFailure(null);
                const fetched = await fetchPage(session, target.slug);
                const loaded = fetched.content;
                if (!loaded) {
                    setLoadFailure(fetched.failure ?? "unknown");
                    return;
                }
                lineRef.current = null;
                restoreLineRef.current = null;
                intoRef.current = 0;
                restoreIntoRef.current = 0;
                setSectionSlug(target.slug);
                if (loaded.kind === "formatted") {
                    const incoming = urlSections(loaded.toc);
                    if (incoming.length >= sections.length) setSections(incoming);
                }
                setDoc(anchoredContent(loaded));
            }
            finally {
                setTurning(false);
            }
        })();
    }

    function bookmarkHere(line: number, fraction: number) {
        if (gameId == null || !faqId) {
            return;
        }
        const anchor = sections.length > 1 ? (sectionSlug ?? sections[0]?.slug ?? "") : "";
        showManagedModal((close) => (
            <GuidesBookmarksModal
                language={language}
                rows={bookmarks.map((bookmark) => ({ bookmark, label: bookmark.name }))}
                onPick={(bookmark) => {
                    close();
                    jumpToBookmark(bookmark);
                }}
                onSave={(name) => addGuideBookmark(gameId, faqId, name, line, anchor, fraction)
                    .then((res) => {
                        if (res?.ok && res.bookmark) {
                            setBookmarks((prior) => [...prior, res.bookmark as GuideBookmark]);
                            return res.bookmark;
                        }
                        return null;
                    })
                    .catch(() => null)}
                onDelete={(bookmark) => {
                    setBookmarks((prior) => prior.filter((entry) => entry.id !== bookmark.id));
                    void removeGuideBookmark(gameId, faqId, bookmark.id).catch(() => undefined);
                }}
                onJump={jumpToSpot}
                groupOf={bookmarkGroup}
                close={close}
            />
        ));
    }

    function bookmarkGroup(bookmark: GuideBookmark) {
        if (!sectionPaged) {
            return 0;
        }
        const at = sections.findIndex((entry) => entry.slug === bookmark.anchor);
        return at >= 0 ? at : sections.length;
    }

    function jumpToSpot(spot: GuideSpot) {
        const target = spotTarget(doc?.pages ?? [], spot);
        lineRef.current = null;
        intoRef.current = target.into;
        restoreIntoRef.current = target.into;
        restoreLineRef.current = target.line;
        setJumpToken((n) => n + 1);
    }

    function jumpToBookmark(bookmark: GuideBookmark) {
        const target = bookmark.anchor || null;
        const current = sectionSlug ?? sections[0]?.slug ?? null;
        if (!sectionPaged || !target || target === current) {
            lineRef.current = null;
            intoRef.current = bookmark.scroll || 0;
            restoreIntoRef.current = bookmark.scroll || 0;
            restoreLineRef.current = bookmark.page;
            setJumpToken((n) => n + 1);
            return;
        }
        const session = sessionRef.current;
        if (!session || turning) {
            return;
        }
        setTurning(true);
        void (async () => {
            try {
                await writePosition(content);
                setLoadFailure(null);
                const fetched = await fetchPage(session, target);
                const loaded = fetched.content;
                if (!loaded) {
                    setLoadFailure(fetched.failure ?? "unknown");
                    return;
                }
                lineRef.current = null;
                intoRef.current = bookmark.scroll || 0;
                restoreIntoRef.current = bookmark.scroll || 0;
                restoreLineRef.current = bookmark.page;
                setSectionSlug(target);
                setDoc(anchoredContent(loaded));
            }
            finally {
                setTurning(false);
            }
        })();
    }

    function stepZoom(delta: number) {
        const next = clampGuideZoom(getCurrentGuideModalZoom() + delta * GUIDE_ZOOM_STEP);
        setCurrentGuideModalZoom(next);
        setZoom(next);
        void saveGuideModalZoom(next);
    }

    function goToMatch(index: number) {
        if (!matches[index]) {
            return;
        }
        setMatchAt(index);
        setSearchJump((n) => n + 1);
    }

    function stepMatch(delta: number) {
        if (matches.length === 0) {
            return;
        }
        goToMatch((matchAt + delta + matches.length) % matches.length);
    }

    useEffect(() => {
        if (liveTerm.length === 0) {
            jumpedForRef.current = "";
            return;
        }
        if (jumpedForRef.current === liveTerm) {
            return;
        }
        jumpedForRef.current = liveTerm;
        goToMatch(0);
    }, [liveTerm, matches]);

    useEffect(() => {
        setMatchAt(0);
    }, [content]);

    useEffect(() => {
        if (searchFocusToken === 0) {
            return;
        }
        searchBoxRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    }, [searchFocusToken]);

    function revealSearch() {
        setSearchOpen(true);
        setSearchFocusToken((n) => n + 1);
    }

    function exitSearch() {
        setSearchTerm("");
        setSearchQuery("");
        setMatchAt(0);
        setSearchOpen(false);
    }

    const searching = searchOpen;

    function handleCancel() {
        const now = Date.now();
        if (now - escapeAtRef.current < MODAL_ECHO_WINDOW_MS) {
            return;
        }
        escapeAtRef.current = now;
        if (searching) {
            exitSearch();
            return;
        }
        close();
    }

    function searchStatusLabel(): string {
        const total = matches.length;
        const at = total === 0 ? 0 : matchAt + 1;
        return `${at}/${total}${total >= SEARCH_MATCH_LIMIT ? "+" : ""}`;
    }

    return (
        <ModalRoot onCancel={handleCancel} onEscKeypress={handleCancel} className="cheevo-guide-dialog">
            <SnapshotHotkey language={language} />
            <div
                ref={rootRef}
                style={{
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    minHeight: "70vh",
                    padding: "0 3px"
                }}
            >
                <style>{FADE_IN_KEYFRAMES}{MODAL_WIDTH_CSS}</style>

                <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                    {props.mouseKeyboardMode && (
                        <>
                            <DialogButton
                                onClick={() => stepZoom(-1)}
                                focusable={false}
                                style={MODAL_STEP_BUTTON_STYLE}
                            >
                                −
                            </DialogButton>
                            <DialogButton
                                onClick={() => stepZoom(1)}
                                focusable={false}
                                style={MODAL_STEP_BUTTON_STYLE}
                            >
                                +
                            </DialogButton>
                            {sectionPaged && (
                                <>
                                    <DialogButton
                                        onClick={() => turnSection(-1)}
                                        disabled={turning || sectionIndex <= 0}
                                        focusable={false}
                                        style={MODAL_STEP_BUTTON_STYLE}
                                    >
                                        ‹
                                    </DialogButton>
                                    <DialogButton
                                        onClick={() => turnSection(1)}
                                        disabled={turning || sectionIndex >= sections.length - 1}
                                        focusable={false}
                                        style={MODAL_STEP_BUTTON_STYLE}
                                    >
                                        ›
                                    </DialogButton>
                                </>
                            )}
                            {
}
                            <DialogButton
                                onClick={() => bookmarkHere(
                                    lineRef.current ?? restoreLineRef.current ?? 0,
                                    intoRef.current
                                )}
                                focusable={false}
                                style={MODAL_STEP_BUTTON_STYLE}
                            >
                                <BookmarkIcon />
                            </DialogButton>
                            <DialogButton
                                onClick={() => (searchOpen ? exitSearch() : setSearchOpen(true))}
                                focusable={false}
                                style={{
                                    ...MODAL_STEP_BUTTON_STYLE,
                                    ...(searchOpen ? { background: "rgba(255, 255, 255, 0.25)" } : {}),
                                }}
                            >
                                <SearchIcon />
                            </DialogButton>
                            <div
                                style={{
                                    width: "1px",
                                    alignSelf: "stretch",
                                    background: "rgba(255, 255, 255, 0.22)",
                                    margin: "0 2px",
                                    flexShrink: 0
                                }}
                            />
                        </>
                    )}
                    <div
                        style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: `${modalSize(15)}px`,
                            fontWeight: 700,
                            textAlign: "left",
                            minHeight: `${modalSize(18)}px`,
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical" as const,
                            overflow: "hidden",
                            overflowWrap: "anywhere"
                        }}
                    >
                        {currentSection ? currentSection.label : (positionLoaded ? title : "")}
                        {failIsSlow && (
                            <span
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    verticalAlign: "middle",
                                    gap: "4px",
                                    marginLeft: "6px",
                                    fontWeight: 400
                                }}
                            >
                                {"("}
                                <ErrorText>{guideFailureText(language, loadFailure)}</ErrorText>
                                {")"}
                            </span>
                        )}
                        {!failIsSlow && turnIsSlow && (
                            <span
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    verticalAlign: "middle",
                                    gap: "4px",
                                    marginLeft: "6px",
                                    fontWeight: 400,
                                    opacity: 0.75
                                }}
                            >
                                {"("}
                                <InlineSpinner
                                    size={11}
                                    label={cfWaiting
                                        ? t(language, "Waiting for GameFAQs security check…")
                                        : t(language, "Loading guide…")}
                                />
                                {")"}
                            </span>
                        )}
                    </div>
                    {sectionPaged && (
                        <div
                            style={{
                                flexShrink: 0,
                                opacity: 0.85,
                                fontSize: `${modalSize(13)}px`,
                                whiteSpace: "nowrap",
                            }}
                        >
                            {t(language, "Page {{n}} of {{m}}", {
                                n: sectionIndex + 1,
                                m: sections.length,
                            })}
                        </div>
                    )}
                    {props.showIcons && (
                        <div
                            style={{
                                width: `${modalSize(22)}px`,
                                height: `${modalSize(22)}px`,
                                borderRadius: "6px",
                                overflow: "hidden",
                                flexShrink: 0,
                                background: "rgba(255,255,255,0.10)",
                                border: "1px solid rgba(255,255,255,0.12)"
                            }}
                        >
                            {iconDataUri ? (
                                <FadeImage
                                    src={iconDataUri}
                                    fadeOnLoad={cold}
                                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                />
                            ) : null}
                        </div>
                    )}
                </div>

                {searchOpen && (
                    <Focusable
                        style={{
                            display: "flex",
                            gap: "6px",
                            alignItems: "center",
                            minHeight: `${SEARCH_ROW_PX}px`,
                        }}
                        flow-children="row"
                        actionDescriptionMap={{
                            [BUMPER_LEFT]: legendGlyph("‹"),
                            [BUMPER_RIGHT]: legendGlyph("›"),
                        }}
                        onButtonDown={(evt: { detail?: { button?: number } }) => {
                            const button = evt?.detail?.button;
                            if (button === BUMPER_LEFT) {
                                stepMatch(-1);
                            }
                            else if (button === BUMPER_RIGHT) {
                                stepMatch(1);
                            }
                        }}
                    >
                        <div style={{ flexShrink: 0, opacity: 0.75, display: "flex" }}>
                            <SearchIcon size={modalSize(15)} />
                        </div>
                        {
}
                        <div ref={searchBoxRef} style={{ flex: 1, minWidth: 0 }}>
                            <TextField
                                value={searchTerm}
                                onChange={(e: { target: { value: string } }) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div
                            style={{
                                flexShrink: 0,
                                opacity: 0.85,
                                fontSize: `${modalSize(13)}px`,
                                whiteSpace: "nowrap",
                            }}
                        >
                            {searchStatusLabel()}
                        </div>
                        <DialogButton
                            onClick={() => stepMatch(-1)}
                            style={MODAL_STEP_BUTTON_STYLE}
                        >
                            ‹
                        </DialogButton>
                        <DialogButton
                            onClick={() => stepMatch(1)}
                            style={MODAL_STEP_BUTTON_STYLE}
                        >
                            ›
                        </DialogButton>
                    </Focusable>
                )}

                {showingPlaceholder ? (
                    <div
                        style={{
                            flex: 1,
                            minHeight: 0,
                            maxHeight: "62vh",
                            width: "100%",
                        }}
                    >
                        {waitIsSlow && (
                            <InlineSpinner
                                label={cfWaiting
                                    ? t(language, "Waiting for GameFAQs security check…")
                                    : t(language, "Loading guide…")}
                            />
                        )}
                    </div>
                ) : (
                    <GuidesReaderBody
                        key={`modal-${faqId ?? "guide"}`}
                        restoreToken={jumpToken}
                        content={content}
                        pages={doc?.pages}
                        language={language}
                        surface="modal"
                        zoom={zoom}
                        fullHeight={true}
                        showProgress={true}
                        autoFocus={!autoFocusedRef.current}
                        onAutoFocused={() => { autoFocusedRef.current = true; }}
                        onActivate={revealSearch}
                        onEscape={handleCancel}
                        activateLabel={<SearchIcon size="1.25em" />}
                        escapeLabel={searching ? undefined : legendGlyph("✕")}
                        searchTerm={liveTerm}
                        searchAnchor={currentMatch?.anchor ?? null}
                        searchOccurrence={currentMatch?.occurrence ?? -1}
                        searchJumpToken={searchJump}
                        maxHeightCss={searchOpen ? `calc(62vh - ${SEARCH_ROW_PX + 8}px)` : undefined}
                        onBookmark={bookmarkHere}
                        onZoom={stepZoom}
                        onPageTurn={sectionPaged ? turnSection : undefined}
                        onSearchStep={searchOpen ? stepMatch : undefined}
                        restoreLine={lineRef.current ?? restoreLineRef.current}
                        restoreInto={restoreIntoRef.current}
                        onLineChange={(line, into) => {
                            if (turning) {
                                return;
                            }
                            lineRef.current = line;
                            intoRef.current = into;
                        }}
                    />
                )}

            </div>
        </ModalRoot>
    );
}
