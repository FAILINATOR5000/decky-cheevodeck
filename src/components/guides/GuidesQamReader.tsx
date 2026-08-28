import { DialogButton, Focusable, PanelSectionRow } from "@decky/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { FaSyncAlt } from "react-icons/fa";

import { BackButton } from "../ui/BackButton";
import { ErrorText } from "../ui/ErrorText";
import { FocusableItem } from "../ui/FocusableItem";
import { GuidesReaderBody, legendGlyph } from "./GuidesReaderBody";
import { GuidesBookmarksModal } from "./GuidesBookmarksModal";
import { ButtonHints } from "../ui/ButtonHints";
import { showManagedModal } from "../../utils/modalRegistry";
import { fireArmedGuideRevalidate } from "../../utils/guidesRevalidate";
import { playOkSound } from "../../utils/navSound";
import { t, type LanguageCode } from "../../locales";
import type { ButtonSpacing, ControllerGlyphStyle, GuideBookmark } from "../../types";
import { guideFailureText, type GuideContent } from "../../utils/guidesFetch";
import type { GuideUpdateOutcome, GuidesControllerActions, GuidesControllerState } from "../../hooks/useGuidesController";
import { chunkAnchorHtml, findChunkForLine, spotTarget, type GuideSpot } from "../../utils/guidesChunk";
import { getCachedGuidePages, logGuidesDebug } from "../../api";
import { achievementGreen, bodyTextStyle, regularButtonSpacingStyle, warnAmber } from "../../utils/style";
import { NETWORK_WAIT_MS, useSlowWait } from "../../hooks/useSlowWait";
import { InlineSpinner } from "../ui/InlineSpinner";

type GuidesQamReaderProps = {
    state: GuidesControllerState;
    actions: GuidesControllerActions;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    mouseKeyboardMode: boolean;
    controllerGlyphStyle: ControllerGlyphStyle;
    keepGuidesOffline: boolean;
    gameId: number | null;
    onOpenModal: (startLine: number, sectionSlug: string | null, startInto: number) => void;
};

const STEP_BUTTON_STYLE = {
    minWidth: 0,
    width: "54px",
    flex: "0 0 auto",
};

const COMPACT_BUTTON_STYLE = {
    minWidth: 0,
    width: "34px",
    height: "26px",
    padding: "0",
    flex: "0 0 auto",
};

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function BookmarkIcon({ size = 13 }: { size?: number }) {
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

export function GuidesQamReader(props: GuidesQamReaderProps) {
    const { state: g, actions: ga, language: lang } = props;

    const chunk = g.chunks[g.chunkIndex] ?? null;
    const knownKind = g.content?.kind || g.currentGuide?.kind || "";
    const wholeGuide = knownKind !== "" && knownKind !== "formatted";
    const [savedSections, setSavedSections] = useState<number | null>(null);
    useEffect(() => {
        const gameId = props.gameId;
        const faqId = g.openFaqId;
        const slugs = g.sections.map((entry) => entry.slug);
        if (!props.keepGuidesOffline || gameId == null || !faqId || slugs.length < 2) {
            setSavedSections(null);
            return;
        }
        let cancelled = false;
        void (async () => {
            const held = await getCachedGuidePages(gameId, faqId, slugs);
            if (!cancelled) {
                setSavedSections(held?.pages?.length ?? 0);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [props.keepGuidesOffline, props.gameId, g.openFaqId, g.sections, g.content]);

    const sectionPaged = g.sections.length > 1;
    const currentSection = sectionPaged ? (g.sections[g.sectionIndex] ?? null) : null;
    const pageCount = sectionPaged ? g.sections.length : g.chunks.length;
    const pageNumber = (sectionPaged ? g.sectionIndex : g.chunkIndex) + 1;

    const pageContent: GuideContent | null = useMemo(() => {
        if (!g.content) {
            return null;
        }
        if (wholeGuide) {
            return {
                html: chunkAnchorHtml(g.chunks),
                kind: g.content.kind,
                toc: [],
            };
        }
        if (!chunk) {
            return g.content;
        }
        return {
            html: chunk.html ?? chunkAnchorHtml([chunk]),
            kind: g.content.kind,
            toc: [],
        };
    }, [g.content, chunk, wholeGuide, g.chunks]);

    const lineRef = useRef<number | null>(null);
    const intoRef = useRef(0);
    const fractionRef = useRef<number | null>(null);
    const suppressUnmountPersistRef = useRef(false);

    const lastWrittenRef = useRef<string | null>(null);

    const persistRef = useRef<() => Promise<void>>(() => Promise.resolve());
    persistRef.current = () => {
        const line = lineRef.current;
        if (line === null) {
            return Promise.resolve();
        }
        const stamp = `${currentSection?.slug ?? ""}:${line}:${intoRef.current.toFixed(4)}`;
        if (lastWrittenRef.current === stamp) {
            return Promise.resolve();
        }
        lastWrittenRef.current = stamp;
        return ga.savePosition(line, "", intoRef.current);
    };

    useEffect(() => {
        return () => {
            fireArmedGuideRevalidate();
            if (suppressUnmountPersistRef.current) {
                return;
            }
            void persistRef.current();
        };
    }, []);

    useEffect(() => {
        function persistNow() {
            if (suppressUnmountPersistRef.current) {
                return;
            }
            void persistRef.current();
        }
        function onVisibilityChange() {
            if (document.visibilityState === "hidden") {
                persistNow();
            }
        }
        document.addEventListener("visibilitychange", onVisibilityChange);
        window.addEventListener("blur", persistNow);
        return () => {
            document.removeEventListener("visibilitychange", onVisibilityChange);
            window.removeEventListener("blur", persistNow);
        };
    }, []);

    function turnPage(delta: number) {
        if (g.readerLoading || updating) {
            return;
        }
        void persistRef.current();
        lineRef.current = null;
        intoRef.current = 0;
        fractionRef.current = null;
        if (sectionPaged) {
            ga.gotoSection(g.sectionIndex + delta);
            return;
        }
        const target = g.chunks[Math.max(0, Math.min(g.chunks.length - 1, g.chunkIndex + delta))];
        if (target) {
            void ga.savePosition(target.startLine, "", 0);
        }
        ga.gotoChunk(g.chunkIndex + delta);
    }

    function leave() {
        void persistRef.current();
        ga.goToList();
    }

    function escapeFromText() {
        playOkSound();
        leave();
    }

    function expand() {
        const startLine = lineRef.current ?? g.restoreLine ?? (wholeGuide ? 0 : (chunk ? chunk.startLine : 0));
        const startInto = lineRef.current !== null ? intoRef.current : (g.restoreInto ?? 0);
        logGuidesDebug(
            "expand",
            g.openFaqId ?? "",
            `page=${g.chunkIndex + 1}/${g.chunks.length} startLine=${startLine} `
            + `into=${startInto.toFixed(4)} kind=${g.content?.kind ?? ""}`
        );
        void persistRef.current().then(() => props.onOpenModal(startLine, currentSection?.slug ?? null, startInto));
    }

    const [updateOutcome, setUpdateOutcome] = useState<GuideUpdateOutcome | null>(null);
    const [updating, setUpdating] = useState(false);

    const loadIsSlow = useSlowWait(updating || (g.readerLoading && g.readerFetching), NETWORK_WAIT_MS);
    const controlsBusy = loadIsSlow || updating;
    const atStart = pageNumber <= 1;
    const atEnd = pageNumber >= pageCount;

    const bookmarks = g.currentGuide?.bookmarks ?? [];


    function bookmarkGroup(bookmark: GuideBookmark) {
        if (!sectionPaged) {
            return 0;
        }
        const at = g.sections.findIndex((entry) => entry.slug === bookmark.anchor);
        return at >= 0 ? at : g.sections.length;
    }

    const bookmarkRows = useMemo(() => {
        const rows = bookmarks.map((bookmark) => {
            if (sectionPaged) {
                const at = g.sections.findIndex((entry) => entry.slug === bookmark.anchor);
                return {
                    bookmark,
                    order: at >= 0 ? at : g.sections.length,
                    label: bookmark.name,
                };
            }
            const page = wholeGuide
                ? bookmark.page
                : (g.chunks.length > 0 ? findChunkForLine(g.chunks, bookmark.page) + 1 : 1);
            return {
                bookmark,
                order: page,
                label: bookmark.name,
            };
        });
        rows.sort((a, b) => a.order - b.order);
        return rows.map(({ bookmark, label }) => ({ bookmark, label }));
    }, [bookmarks, g.chunks, g.sections, sectionPaged, lang]);



    function bookmarkHere(line: number, fraction: number) {
        if (!g.openFaqId) {
            return;
        }
        suppressUnmountPersistRef.current = true;
        void ga.savePosition(line, "", fraction);
        openBookmarksAt(line, fraction);
    }

    function jumpToBookmark(bookmark: GuideBookmark) {
        lineRef.current = null;
        intoRef.current = bookmark.scroll || 0;
        fractionRef.current = null;
        void ga.savePosition(bookmark.page, bookmark.anchor, bookmark.scroll || 0);
        ga.jumpToLine(bookmark.page, bookmark.anchor, bookmark.scroll || 0);
    }

    function jumpToSpot(spot: GuideSpot) {
        const target = spotTarget(g.chunks, spot);
        const anchor = currentSection?.slug ?? "";
        lineRef.current = null;
        intoRef.current = target.into;
        fractionRef.current = null;
        void ga.savePosition(target.line, anchor, target.into);
        ga.jumpToLine(target.line, anchor, target.into);
    }

    async function handleUpdateGuide() {
        if (updating || !g.openFaqId) {
            return;
        }
        setUpdating(true);
        setUpdateOutcome(null);
        const line = lineRef.current ?? g.restoreLine ?? 0;
        const into = lineRef.current !== null ? intoRef.current : (g.restoreInto ?? 0);
        await persistRef.current();
        const outcome = await ga.updateGuide(g.openFaqId, currentSection?.slug ?? null, line, into);
        setUpdateOutcome(outcome);
        setUpdating(false);
    }

    function openBookmarksAt(line: number, fraction: number) {
        showManagedModal((close) => (
            <GuidesBookmarksModal
                language={lang}
                rows={bookmarkRows}
                onPick={(bookmark) => {
                    close();
                    jumpToBookmark(bookmark);
                }}
                onSave={(name) => ga.addBookmark(name, line, "", fraction)}
                onDelete={(bookmark) => {
                    if (g.openFaqId) {
                        void ga.removeBookmark(g.openFaqId, bookmark.id);
                    }
                }}
                onJump={jumpToSpot}
                groupOf={bookmarkGroup}
                close={close}
            />
        ));
    }


    const hintLine = (
        <PanelSectionRow>
            <ButtonHints
                style={props.controllerGlyphStyle}
                hints={[
                    { button: "a" as const, label: t(lang, "legend_expand") },
                    { button: "y" as const, label: t(lang, "Bookmark") },
                    { button: "x" as const, label: t(lang, "Exit Text") },
                    ...(wholeGuide
                        ? []
                        : [{ button: ["l1", "r1"] as const, label: t(lang, "legend_page") }]),
                    { button: ["l2", "r2"] as const, label: t(lang, "legend_zoom") }
                ]}
            />
        </PanelSectionRow>
    );

    const updateOutcomeRows = (
        <>
            {updateOutcome === "updated" && (
                <PanelSectionRow>
                    <div style={{ ...bodyTextStyle(), color: achievementGreen }}>
                        {t(lang, "Updated Successfully")}
                    </div>
                </PanelSectionRow>
            )}
            {updateOutcome === "current" && (
                <PanelSectionRow>
                    <div style={{ ...bodyTextStyle(), color: warnAmber }}>
                        {t(lang, "No updates available")}
                    </div>
                </PanelSectionRow>
            )}
            {updateOutcome === "failed" && (
                <PanelSectionRow>
                    <ErrorText>{t(lang, "GameFAQs didn't respond. Check your connection and try again.")}</ErrorText>
                </PanelSectionRow>
            )}
        </>
    );

    const compactControls = (
        <>
            <PanelSectionRow>
                <Focusable
                    flow-children="row"
                    style={{
                        display: "flex",
                        gap: "6px",
                        alignItems: "center",
                        width: "100%",
                        ...regularButtonSpacingStyle(props.buttonSpacing),
                    }}
                >
                    {knownKind === "formatted" && (
                        <>
                            <DialogButton
                                onClick={() => turnPage(-1)}
                                disabled={atStart || controlsBusy}
                                style={COMPACT_BUTTON_STYLE}
                            >
                                ‹
                            </DialogButton>
                            <DialogButton
                                onClick={() => turnPage(1)}
                                disabled={atEnd || controlsBusy}
                                style={COMPACT_BUTTON_STYLE}
                            >
                                ›
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
                    {
}
                    <DialogButton
                        onClick={() => bookmarkHere(
                            lineRef.current ?? g.restoreLine ?? 0,
                            intoRef.current
                        )}
                        disabled={!g.openFaqId}
                        style={COMPACT_BUTTON_STYLE}
                    >
                        <BookmarkIcon />
                    </DialogButton>
                    <DialogButton
                        onClick={handleUpdateGuide}
                        disabled={updating || !g.openFaqId}
                        style={COMPACT_BUTTON_STYLE}
                    >
                        <FaSyncAlt size={12} />
                    </DialogButton>
                    {knownKind === "formatted" && (
                        <div style={{ ...bodyTextStyle(), flex: 1, textAlign: "right", opacity: 0.85 }}>
                            {!g.content
                                ? ""
                                : t(lang, "Page {{n}} of {{m}}", { n: Math.max(1, pageNumber), m: Math.max(1, pageCount) })}
                        </div>
                    )}
                </Focusable>
            </PanelSectionRow>
            {updateOutcomeRows}
        </>
    );

    const readerControls = (
        <>
            {knownKind === "formatted" && (
                <PanelSectionRow>
                    <Focusable
                        flow-children="row"
                        style={{
                            display: "flex",
                            gap: "6px",
                            alignItems: "center",
                            width: "100%",
                            ...regularButtonSpacingStyle(props.buttonSpacing),
                        }}
                    >
                        <DialogButton
                            focusKey="guides:reader:prev"
                            disabled={atStart || controlsBusy}
                            focusable={!(atStart || controlsBusy)}
                            onClick={() => turnPage(-1)}
                            style={STEP_BUTTON_STYLE}
                        >
                            ‹
                        </DialogButton>
                        <div style={{ ...bodyTextStyle(), flex: 1, textAlign: "center", opacity: 0.85 }}>
                            {!g.content
                                ? ""
                                : t(lang, "Page {{n}} of {{m}}", { n: Math.max(1, pageNumber), m: Math.max(1, pageCount) })}
                        </div>
                        <DialogButton
                            focusKey="guides:reader:next"
                            disabled={atEnd || controlsBusy}
                            focusable={!(atEnd || controlsBusy)}
                            onClick={() => turnPage(1)}
                            style={STEP_BUTTON_STYLE}
                        >
                            ›
                        </DialogButton>
                    </Focusable>
                </PanelSectionRow>
            )}

            {
}
            {savedSections !== null && (
                <PanelSectionRow>
                    <div style={{ ...bodyTextStyle(), textAlign: "center", opacity: 0.7 }}>
                        {t(lang, "Saved {{n}} of {{m}} sections", {
                            n: savedSections,
                            m: g.sections.length,
                        })}
                    </div>
                </PanelSectionRow>
            )}

            <PanelSectionRow>
                <FocusableItem
                    focusKey="guides:reader:update"
                    outerStyle={regularButtonSpacingStyle(props.buttonSpacing)}
                    disabled={updating || !g.openFaqId}
                    onClick={handleUpdateGuide}
                    help={t(lang, "help_update_guide")}
                    bottomSeparator="none"
                >
                    {updating ? t(lang, "Refreshing…") : t(lang, "Update Guide")}
                </FocusableItem>
            </PanelSectionRow>
            {updateOutcomeRows}
        </>
    );

    const readerChrome = props.mouseKeyboardMode ? compactControls : hintLine;
    const readerFooter = props.mouseKeyboardMode ? null : readerControls;

    return (
        <>
            <BackButton
                label={t(lang, "← Back to Guides")}
                focusKey="guides:back"
                navAutoFocus
                buttonSpacing={props.buttonSpacing}
                autoFocus={true}
                onClick={leave}
                bottomSeparator="none"
            />

            {readerChrome}

            {
}
            <PanelSectionRow>
                <GuidesReaderBody
                    key={`qam-${g.openFaqId ?? ""}`}
                    content={pageContent}
                    pages={sectionPaged ? g.formattedPages : (wholeGuide ? g.chunks : undefined)}
                    language={lang}
                    surface="panel"
                    zoom={g.guideZoom}
                    fullHeight={false}
                    showProgress={true}
                    restoreLine={g.restoreLine}
                    restoreInto={g.restoreInto}
                    restoreToken={g.restoreToken}
                    onLineChange={(line, into) => { lineRef.current = line; intoRef.current = into; }}
                    onActivate={expand}
                    activateLabel={legendGlyph("⛶")}
                    onEscape={escapeFromText}
                    exitable={true}
                    onBookmark={bookmarkHere}
                    onZoom={(delta) => { if (delta < 0) { ga.zoomOut(); } else { ga.zoomIn(); } }}
                    onPageTurn={wholeGuide ? undefined : turnPage}
                    restoreFraction={wholeGuide ? 0 : g.chunkFraction}
                    onScrollFraction={(fraction) => { fractionRef.current = fraction; }}
                />
            </PanelSectionRow>

            {loadIsSlow && (
                <PanelSectionRow>
                    <div style={{ minWidth: 0, padding: "2px 0" }}>
                        <InlineSpinner
                            label={g.cfWaiting
                                ? t(lang, "Waiting for GameFAQs security check…")
                                : t(lang, "Loading guide…")}
                        />
                    </div>
                </PanelSectionRow>
            )}

            {g.readerError !== null && (
                <PanelSectionRow>
                    <ErrorText>{guideFailureText(lang, g.readerError)}</ErrorText>
                </PanelSectionRow>
            )}

            {readerFooter}
        </>
    );
}
