import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LanguageCode } from "../locales";
import type {
    GameGuidesRecord,
    GuidesMapping,
    GuidesSubView,
    GuideUserData,
} from "../types";
import {
    GuidesBrowserSession,
    type GuideContent,
    type GuideListEntry,
    type GuideReaderError,
    type GuideSearchResult,
    type GuideTocEntry,
} from "../utils/guidesFetch";
import { guideBelongsToMapping, normalizeRaTitle, resolveCandidates } from "../utils/guidesResolve";
import { urlSections } from "../utils/guidesToc";
import { loadGuidePage } from "../utils/guidesCache";
import { extractGuideLines } from "../utils/guidesRender";
import {
    chunkGuideLines,
    findChunkForLine,
    fractionWithinChunk,
} from "../utils/guidesChunk";
import { chunkFormattedHtml, joinFormattedPages, type GuidePage } from "../utils/guidesBlocks";
import { clampGuideZoom, getCurrentGuideZoom, setCurrentGuideZoom, GUIDE_ZOOM_STEP } from "../utils/scale";
import {
    addGuideBookmark,
    clearGuideMapping,
    debugLoggingEnabled,
    getCachedGuideList,
    getCachedGuidePage,
    getOfflineGuides,
    loadGameGuides,
    logGuidesDebug,
    removeGuideBookmark,
    renameGuideBookmark,
    pruneGuideCacheTo,
    saveCachedGuideList,
    saveCachedGuidePage,
    saveGuideMapping,
    saveGuidePosition,
    saveGuideTypeFilter,
    saveGuideZoom,
    upsertGuideMeta,
} from "../api";

export type GuidesStatus =
    | "idle"
    | "resolving"
    | "resolved"
    | "picker"
    | "noguides"
    | "error"
    | "network"
    | "unavailable";

export interface GuidesResumeTarget {
    subView: GuidesSubView;
    faqId: string | null;
}

export interface UseGuidesControllerArgs {
    isActive: boolean;
    gameId: number | null;
    title: string | null;
    consoleName: string | null;
    language: LanguageCode;
    resumeTarget: GuidesResumeTarget | null;
    onResumeConsumed: () => void;
    onRequestFocus: (focusKey: string) => void;
}

export function useGuidesController(args: UseGuidesControllerArgs) {
    const {
        isActive,
        gameId,
        title,
        consoleName,
        language,
        resumeTarget,
        onResumeConsumed,
        onRequestFocus,
    } = args;

    const [subView, setSubView] = useState<GuidesSubView>("list");
    const [status, setStatus] = useState<GuidesStatus>("idle");
    const [mapping, setMapping] = useState<GuidesMapping | null>(null);
    const [candidates, setCandidates] = useState<GuideSearchResult[]>([]);
    const [guideList, setGuideList] = useState<GuideListEntry[]>([]);
    const [record, setRecord] = useState<GameGuidesRecord | null>(null);
    const [listLoading, setListLoading] = useState(false);
    const [searching, setSearching] = useState(false);
    const [manualSearchTerm, setManualSearchTerm] = useState("");
    const [searchNoResults, setSearchNoResults] = useState(false);
    const [searchFailed, setSearchFailed] = useState(false);
    const [cfWaiting, setCfWaiting] = useState(false);

    const [openFaqId, setOpenFaqId] = useState<string | null>(null);
    const [content, setContent] = useState<GuideContent | null>(null);
    const [lines, setLines] = useState<string[]>([]);
    const [chunks, setChunks] = useState<GuidePage[]>([]);
    const [chunkIndex, setChunkIndex] = useState(0);
    const [formattedPages, setFormattedPages] = useState<GuidePage[]>([]);
    const [restoreLine, setRestoreLine] = useState<number | null>(null);
    const [restoreInto, setRestoreInto] = useState(0);
    const [chunkFraction, setChunkFraction] = useState(0);
    const [restoreToken, setRestoreToken] = useState(0);
    const [readerLoading, setReaderLoading] = useState(false);
    const [readerError, setReaderError] = useState<GuideReaderError | null>(null);
    const [readerFetching, setReaderFetching] = useState(false);
    const [sections, setSections] = useState<GuideTocEntry[]>([]);
    const [sectionIndex, setSectionIndex] = useState(0);

    const [guideZoom, setGuideZoom] = useState<number>(() => getCurrentGuideZoom());

    const sessionRef = useRef<GuidesBrowserSession | null>(null);
    const loadedForGameIdRef = useRef<number | null>(null);
    const recordRef = useRef<GameGuidesRecord | null>(null);
    const activeGenerationRef = useRef(0);
    const sectionsRef = useRef<{ faqId: string | null; list: GuideTocEntry[] }>({ faqId: null, list: [] });
    const [loadEpoch, setLoadEpoch] = useState(0);

    useEffect(() => {
        if (!isActive) {
            return;
        }
        const session = new GuidesBrowserSession({ onChallenge: setCfWaiting });
        sessionRef.current = session;
        return () => {
            sessionRef.current = null;
            setCfWaiting(false);
            void session.destroy();
        };
    }, [isActive]);

    const resolveAndLoad = useCallback(
        async (targetGameId: number) => {
            const generation = ++activeGenerationRef.current;
            const mySession = sessionRef.current;
            const stillCurrent = () =>
                activeGenerationRef.current === generation &&
                sessionRef.current === mySession &&
                mySession !== null;
            const abandon = () => {
                if (activeGenerationRef.current !== generation) return;
                loadedForGameIdRef.current = null;
                setStatus("idle");
                setLoadEpoch((n) => n + 1);
            };

            setStatus("resolving");
            setCandidates([]);
            setGuideList([]);

            const rec = await loadGameGuides(targetGameId);
            if (!stillCurrent()) {
                abandon();
                return;
            }
            setRecord(rec);

            if (rec.gamefaqs && rec.gamefaqs.gameUrl) {
                logGuidesDebug("resolve", String(targetGameId), "stored-mapping " + rec.gamefaqs.gameUrl);
                setMapping(rec.gamefaqs);
                await loadList(targetGameId, rec.gamefaqs.gameUrl);
                return;
            }

            if (!GuidesBrowserSession.isAvailable()) {
                logGuidesDebug("resolve", String(targetGameId), "browser-view-unavailable");
                setStatus("unavailable");
                return;
            }

            const session = sessionRef.current;
            if (!session) {
                abandon();
                return;
            }

            const searchTerm = normalizeRaTitle(title);
            logGuidesDebug("resolve", String(targetGameId), "search " + searchTerm);
            const results = await session.searchGames(searchTerm);
            if (!stillCurrent()) {
                abandon();
                return;
            }
            if (results === null) {
                logGuidesDebug("resolve", String(targetGameId), "search-fetch-failed");
                loadedForGameIdRef.current = null;
                setStatus("network");
                return;
            }

            const outcome = resolveCandidates(results, consoleName, title);
            logGuidesDebug(
                "resolve",
                String(targetGameId),
                `candidates=${outcome.candidates.length} match=${outcome.match ? outcome.match.url : "none"}`
            );

            if (outcome.match) {
                const picked = outcome.match;
                await saveGuideMapping(targetGameId, picked.platformSlug, picked.url, picked.productName);
                if (!stillCurrent()) {
                    abandon();
                    return;
                }
                const newMapping: GuidesMapping = {
                    platformSlug: picked.platformSlug,
                    gameUrl: picked.url,
                    productName: picked.productName,
                };
                setMapping(newMapping);
                await loadList(targetGameId, picked.url);
                return;
            }

            if (outcome.candidates.length > 0) {
                setCandidates(outcome.candidates);
                setStatus("picker");
                setSubView("search");
                return;
            }
            if (outcome.guidelessOnly) {
                setStatus("noguides");
                return;
            }
            setStatus("error");
        },
        [title, consoleName]
    );

    const withOfflineGuides = useCallback(
        async (targetGameId: number, gameUrl: string, entries: GuideListEntry[]) => {
            const offline = await getOfflineGuides(targetGameId);
            const rows = offline?.guides ?? [];
            if (rows.length === 0) {
                return entries;
            }
            const listed = new Set(entries.map((entry) => entry.faqId));
            const extras: GuideListEntry[] = rows
                .filter((row) => !listed.has(row.faqId))
                .map((row) => ({
                    faqId: row.faqId,
                    title: row.title,
                    author: row.author,
                    url: `${gameUrl}/faqs/${row.faqId}`,
                    type: row.type,
                    flair: [],
                    offlineOnly: true,
                }));
            if (extras.length === 0) {
                return entries;
            }
            logGuidesDebug("list", gameUrl, `kept ${extras.length} saved guide(s) the site no longer lists`);
            return [...entries, ...extras];
        },
        []
    );

    const loadList = useCallback(
        async (targetGameId: number, gameUrl: string, force = false) => {
            const generation = activeGenerationRef.current;
            const mySession = sessionRef.current;
            const stillCurrent = () =>
                activeGenerationRef.current === generation &&
                sessionRef.current === mySession &&
                mySession !== null;
            const releaseClaim = () => {
                if (activeGenerationRef.current !== generation) return;
                loadedForGameIdRef.current = null;
                setLoadEpoch((n) => n + 1);
            };

            setListLoading(true);

            if (!force) {
                const cached = await getCachedGuideList(targetGameId);
                if (!stillCurrent()) {
                    setListLoading(false);
                    releaseClaim();
                    return;
                }
                if (cached.cached && cached.entries && cached.entries.length > 0) {
                    setGuideList(await withOfflineGuides(targetGameId, gameUrl, cached.entries));
                    setStatus("resolved");
                    setListLoading(false);
                    return;
                }
            }

            const session = sessionRef.current;
            if (!session) {
                setListLoading(false);
                releaseClaim();
                return;
            }
            const entries = await session.fetchGuideList(gameUrl);
            if (!stillCurrent()) {
                setListLoading(false);
                releaseClaim();
                return;
            }
            if (entries === null) {
                const stale = await getCachedGuideList(targetGameId, true);
                if (!stillCurrent()) {
                    setListLoading(false);
                    releaseClaim();
                    return;
                }
                if (stale.cached && stale.entries && stale.entries.length > 0) {
                    logGuidesDebug("list", gameUrl, `fetch-failed, served ${stale.entries.length} from expired cache`);
                    setGuideList(await withOfflineGuides(targetGameId, gameUrl, stale.entries));
                    setListLoading(false);
                    setStatus("resolved");
                    return;
                }
                logGuidesDebug("list", gameUrl, `fetch-failed force=${force}`);
                setListLoading(false);
                loadedForGameIdRef.current = null;
                setStatus("network");
                return;
            }
            logGuidesDebug("list", gameUrl, `fetched=${entries.length} force=${force}`);
            if (entries.length > 0) {
                void saveCachedGuideList(targetGameId, entries);
            }
            const merged = await withOfflineGuides(targetGameId, gameUrl, entries);
            setGuideList(merged);
            setListLoading(false);
            if (merged.length === 0) {
                setStatus("noguides");
                return;
            }
            setStatus("resolved");
        },
        [withOfflineGuides]
    );

    useEffect(() => {
        if (!isActive || gameId == null) {
            return;
        }
        if (loadedForGameIdRef.current === gameId) {
            return;
        }
        loadedForGameIdRef.current = gameId;
        void resolveAndLoad(gameId);
    }, [isActive, gameId, resolveAndLoad, loadEpoch]);

    const loadContent = useCallback(
        async (
            faqId: string,
            sectionSlug: string | null,
            listEntry: GuideListEntry | null,
            restoreTo?: number | null,
            intoTo?: number
        ) => {
            const generation = activeGenerationRef.current;
            const mySession = sessionRef.current;
            const stillCurrent = () =>
                activeGenerationRef.current === generation && sessionRef.current === mySession;
            const targetGameId = gameId;
            if (targetGameId == null) return;

            setReaderLoading(true);
            setReaderError(null);
            setReaderFetching(false);

            const pageKey = sectionSlug || "0";
            const fetched = await loadGuidePage(
                targetGameId,
                faqId,
                pageKey,
                mySession,
                mapping?.gameUrl ?? null,
                () => {
                    if (stillCurrent()) setReaderFetching(true);
                }
            );
            const loaded = fetched.content;

            if (!stillCurrent()) {
                setReaderLoading(false);
                setReaderFetching(false);
                return;
            }
            if (!loaded) {
                setReaderError(fetched.failure ?? "unknown");
                setReaderLoading(false);
                setReaderFetching(false);
                return;
            }

            setContent(loaded);
            const formatted = loaded.kind === "formatted";

            let sectionList: GuideTocEntry[] = [];
            if (formatted) {
                const incoming = urlSections(loaded.toc);
                const held = sectionsRef.current.faqId === faqId ? sectionsRef.current.list : [];
                sectionList = incoming.length >= held.length ? incoming : held;
            }
            sectionsRef.current = { faqId, list: sectionList };
            setSections(sectionList);
            const sectionPaged = sectionList.length > 1;
            const at = sectionSlug ? sectionList.findIndex((entry) => entry.slug === sectionSlug) : 0;
            setSectionIndex(at < 0 ? 0 : at);

            const guideLines = formatted ? [] : extractGuideLines(loaded.html);
            const blocks = formatted
                ? chunkFormattedHtml(loaded.html)
                : guideLines.length > 0 ? chunkGuideLines(guideLines) : [];
            const built: GuidePage[] = sectionPaged && blocks.length > 0
                ? [{
                    ...blocks[0],
                    endLine: blocks[blocks.length - 1].endLine,
                    reason: "end",
                    html: joinFormattedPages(blocks),
                }]
                : blocks;
            setLines(guideLines);
            setChunks(built);
            setFormattedPages(sectionPaged ? blocks : []);
            const saved = recordRef.current?.guides[faqId] ?? null;
            const savedLine = restoreTo ?? saved?.lastPage ?? 0;
            const index = built.length > 0 ? findChunkForLine(built, savedLine) : 0;
            setChunkIndex(index);
            setRestoreLine(savedLine);
            setRestoreInto(restoreTo != null ? (intoTo ?? 0) : (saved?.lastScroll ?? 0));
            setRestoreToken((token) => token + 1);
            setChunkFraction(built.length > 0 ? fractionWithinChunk(built[index], savedLine) : 0);
            if (built.length > 0 && debugLoggingEnabled()) {
                logGuidesDebug(
                    "chunk",
                    faqId,
                    sectionPaged
                        ? `section=${(at < 0 ? 0 : at) + 1}/${sectionList.length} blocks=${blocks.length} slug=${sectionSlug ?? "(base)"}`
                        : `pages=${built.length} reasons=${built.map((c: GuidePage) => c.reason).join(",")}`
                );
            }
            setReaderLoading(false);
            setReaderFetching(false);

            if (listEntry) {
                void upsertGuideMeta(
                    targetGameId,
                    faqId,
                    listEntry.title,
                    listEntry.author,
                    listEntry.type,
                    "",
                    loaded.kind
                );
            }
            else {
                void upsertGuideMeta(targetGameId, faqId, "", "", "", "", loaded.kind);
            }
        },
        [gameId, mapping]
    );

    const openGuide = useCallback(
        (faqId: string, sectionSlug?: string | null) => {
            if (gameId == null) return;
            setOpenFaqId(faqId);
            setSubView("reader");
            setContent(null);
            setLines([]);
            setChunks([]);
            setChunkIndex(0);
            setChunkFraction(0);
            sectionsRef.current = { faqId: null, list: [] };
            setSections([]);
            setSectionIndex(0);
            onRequestFocus("guides:back");
            const listEntry = guideList.find((g) => g.faqId === faqId) || null;
            const saved = recordRef.current?.guides[faqId] ?? null;
            const target = sectionSlug
                ?? (saved && saved.kind === "formatted" && saved.lastAnchor ? saved.lastAnchor : null);
            void loadContent(faqId, target, listEntry);
        },
        [gameId, guideList, loadContent, onRequestFocus]
    );

    const gotoChunk = (index: number) => {
        if (chunks.length === 0) return;
        const next = Math.max(0, Math.min(chunks.length - 1, index));
        setChunkIndex(next);
        setRestoreLine(chunks[next].startLine);
        setRestoreInto(0);
        setChunkFraction(0);
        setRestoreToken((token) => token + 1);
    };

    const gotoSection = (index: number) => {
        if (!openFaqId) return;
        const list = sectionsRef.current.faqId === openFaqId ? sectionsRef.current.list : [];
        if (list.length <= 1) return;
        const next = Math.max(0, Math.min(list.length - 1, index));
        if (next === sectionIndex) return;
        const listEntry = guideList.find((entry) => entry.faqId === openFaqId) || null;
        void loadContent(openFaqId, list[next].slug, listEntry, 0);
    };

    const jumpToLine = (line: number, anchor?: string, into = 0) => {
        const list = sectionsRef.current.faqId === openFaqId ? sectionsRef.current.list : [];
        if (list.length > 1 && anchor && openFaqId) {
            const at = list.findIndex((entry) => entry.slug === anchor);
            if (at >= 0 && at !== sectionIndex) {
                const listEntry = guideList.find((entry) => entry.faqId === openFaqId) || null;
                void loadContent(openFaqId, list[at].slug, listEntry, line, into);
                return;
            }
        }
        if (chunks.length > 0) {
            setChunkIndex(findChunkForLine(chunks, line));
        }
        setChunkFraction(0);
        setRestoreLine(line);
        setRestoreInto(into);
        setRestoreToken((token) => token + 1);
    };

    const syncPositionFromStore = async () => {
        if (gameId == null || !openFaqId) return;
        const rec = await loadGameGuides(gameId);
        setRecord(rec);
        recordRef.current = rec;
        const saved = rec.guides[openFaqId];
        if (!saved) return;
        const line = saved.lastPage || 0;
        const list = sectionsRef.current.faqId === openFaqId ? sectionsRef.current.list : [];
        if (list.length > 1 && saved.lastAnchor) {
            const at = list.findIndex((entry) => entry.slug === saved.lastAnchor);
            if (at >= 0 && at !== sectionIndex) {
                const listEntry = guideList.find((entry) => entry.faqId === openFaqId) || null;
                void loadContent(openFaqId, list[at].slug, listEntry, line, saved.lastScroll || 0);
                return;
            }
        }
        if (chunks.length > 0) {
            setChunkIndex(findChunkForLine(chunks, line));
        }
        setRestoreLine(line);
        setRestoreInto(saved.lastScroll || 0);
        setRestoreToken((token) => token + 1);
    };

    const sectionAnchor = (explicit: string) => {
        if (sections.length <= 1) return explicit;
        if (explicit) return explicit;
        return sections[sectionIndex]?.slug ?? "";
    };

    const savePosition = (page: number, anchor: string, scroll: number) => {
        if (gameId == null || !openFaqId) {
            return Promise.resolve();
        }
        const kind = content?.kind || "";
        const total = sections.length > 1 ? sections.length : chunks.length;
        logGuidesDebug(
            "save",
            "panel",
            `faq=${openFaqId} line=${page} into=${Number(scroll).toFixed(4)} `
            + `anchor=${sectionAnchor(anchor) || "(none)"} total=${total} kind=${kind}`
        );
        return saveGuidePosition(gameId, openFaqId, page, sectionAnchor(anchor), scroll, total, kind)
            .then(() => undefined)
            .catch(() => undefined);
    };

    const refreshRecord = useCallback(async () => {
        if (gameId == null) return;
        const rec = await loadGameGuides(gameId);
        setRecord(rec);
    }, [gameId]);

    const addBookmark = async (name: string, page: number, anchor: string, scroll: number) => {
        if (gameId == null || !openFaqId) return null;
        const res = await addGuideBookmark(gameId, openFaqId, name, page, sectionAnchor(anchor), scroll);
        await refreshRecord();
        return res?.ok && res.bookmark ? res.bookmark : null;
    };

    const removeBookmark = async (faqId: string, bookmarkId: string) => {
        if (gameId == null) return;
        await removeGuideBookmark(gameId, faqId, bookmarkId);
        await refreshRecord();
    };

    const renameBookmark = async (faqId: string, bookmarkId: string, name: string) => {
        if (gameId == null) return;
        await renameGuideBookmark(gameId, faqId, bookmarkId, name);
        await refreshRecord();
    };

    const setTypeFilter = async (value: string) => {
        if (gameId == null) return;
        await saveGuideTypeFilter(gameId, value);
        await refreshRecord();
    };

    const manualSearch = async (term: string) => {
        const session = sessionRef.current;
        if (!session) return;
        const generation = activeGenerationRef.current;
        const stillCurrent = () =>
            activeGenerationRef.current === generation && sessionRef.current === session;
        setSearching(true);
        setSearchNoResults(false);
        setSearchFailed(false);
        const results = await session.searchGames(term.trim());
        if (!stillCurrent()) {
            setSearching(false);
            return;
        }
        if (results === null) {
            setSearchFailed(true);
            setSearching(false);
            return;
        }
        const guideBearing = results.filter((r) => r.hasGuides);
        const rest = results.filter((r) => !r.hasGuides);
        const picked = [...guideBearing, ...rest];
        logGuidesDebug(
            "search",
            term.trim(),
            `parsed=${results.length} withGuides=${guideBearing.length} shown=${picked.length}`
        );
        setCandidates(picked);
        setSearchNoResults(picked.length === 0);
        setSearching(false);
    };

    const pickCandidate = useCallback(
        async (candidate: GuideSearchResult) => {
            if (gameId == null) return;
            await saveGuideMapping(gameId, candidate.platformSlug, candidate.url, candidate.productName);
            const newMapping: GuidesMapping = {
                platformSlug: candidate.platformSlug,
                gameUrl: candidate.url,
                productName: candidate.productName,
            };
            setMapping(newMapping);
            setCandidates([]);
            setSearchNoResults(false);
            setSearchFailed(false);
            setOpenFaqId(null);
            setContent(null);
            setGuideList([]);
            setSubView("list");
            onRequestFocus("guides:back");
            logGuidesDebug("pick", String(gameId), `remap -> ${candidate.url} (${candidate.productName})`);
            if (!candidate.hasGuides) {
                setStatus("noguides");
                await refreshRecord();
                return;
            }
            setStatus("resolving");
            await loadList(gameId, candidate.url, true);
            await refreshRecord();
        },
        [gameId, loadList, refreshRecord, onRequestFocus]
    );

    const retryLoad = () => {
        if (gameId == null) return;
        loadedForGameIdRef.current = gameId;
        void resolveAndLoad(gameId);
    };

    const updateGuide = async (
        faqId: string,
        fromSection: string | null = null,
        fromLine: number | null = null,
        fromInto = 0
    ): Promise<GuideUpdateOutcome> => {
        const session = sessionRef.current;
        const gameUrl = mapping?.gameUrl;
        if (gameId == null || !faqId || !session || !gameUrl) {
            return "failed";
        }

        const sectionList = sectionsRef.current.faqId === faqId ? sectionsRef.current.list : [];
        const firstSlug = sectionList[0]?.slug ?? "0";
        let currentSlug = fromSection ?? sectionList[sectionIndex]?.slug ?? firstSlug;

        let fresh = (await session.fetchGuideContent(gameUrl, faqId, currentSlug === "0" ? undefined : currentSlug)).content;
        if (!fresh && currentSlug !== firstSlug) {
            logGuidesDebug("update", faqId, `section ${currentSlug} is gone, falling back to the first`);
            currentSlug = firstSlug;
            fresh = (await session.fetchGuideContent(gameUrl, faqId, currentSlug === "0" ? undefined : currentSlug)).content;
        }
        if (!fresh) {
            return "failed";
        }
        const next = JSON.stringify(fresh);
        const before = await getCachedGuidePage(gameId, faqId, currentSlug, true);
        const changed = !before.cached || before.html !== next;
        const saved = await saveCachedGuidePage(
            gameId,
            faqId,
            next,
            currentSlug,
            urlSections(fresh.toc).map((entry) => entry.slug)
        );
        if (!saved?.cached) {
            logGuidesDebug("update", faqId, `reset abandoned, page=${currentSlug} would not save`);
            return "failed";
        }

        await pruneGuideCacheTo(gameId, faqId, [currentSlug]);

        if (openFaqId === faqId) {
            const listEntry = guideList.find((entry) => entry.faqId === faqId) || null;
            const landedElsewhere = fromSection !== null && currentSlug !== fromSection;
            await loadContent(
                faqId,
                currentSlug === "0" ? null : currentSlug,
                listEntry,
                landedElsewhere ? 0 : fromLine,
                landedElsewhere ? 0 : fromInto
            );
        }
        logGuidesDebug("update", faqId, `reset to page=${currentSlug} changed=${changed}`);
        return changed ? "updated" : "current";
    };

    const refreshList = async () => {
        if (gameId == null || !mapping?.gameUrl) return;
        await loadList(gameId, mapping.gameUrl, true);
    };

    const applyZoom = (next: number) => {
        const value = clampGuideZoom(next);
        setCurrentGuideZoom(value);
        setGuideZoom(value);
        void saveGuideZoom(value);
    };

    const zoomIn = () => applyZoom(getCurrentGuideZoom() + GUIDE_ZOOM_STEP);
    const zoomOut = () => applyZoom(getCurrentGuideZoom() - GUIDE_ZOOM_STEP);

    const goToList = useCallback(() => {
        setSubView("list");
        void refreshRecord();
        setStatus((current) => {
            if (current !== "picker") {
                return current;
            }
            return guideList.length > 0 ? "resolved" : "error";
        });
        onRequestFocus("guides:back");
    }, [onRequestFocus, guideList.length, refreshRecord]);

    const goToSearch = useCallback(() => {
        setSubView("search");
        onRequestFocus("guides:back");
    }, [onRequestFocus]);

    const handleBack = useCallback((): boolean => {
        if (subView === "reader" || subView === "search") {
            setSubView("list");
            onRequestFocus("guides:back");
            return true;
        }
        return false;
    }, [subView, onRequestFocus]);

    const enterFromResume = (target: GuidesSubView, faqId: string | null) => {
        if (target === "reader" && faqId) {
            setSubView("reader");
            setOpenFaqId(faqId);
            return;
        }
        setSubView(target === "search" ? "search" : "list");
    };

    useEffect(() => {
        if (!isActive || !resumeTarget) {
            return;
        }
        enterFromResume(resumeTarget.subView, resumeTarget.faqId);
        onResumeConsumed();
    }, [isActive, resumeTarget, onResumeConsumed]);

    useEffect(() => {
        if (!isActive || subView !== "reader" || !openFaqId || content || readerLoading || readerError) return;
        if (!mapping?.gameUrl) return;
        const saved = recordRef.current?.guides[openFaqId] ?? null;
        const target = saved && saved.kind === "formatted" && saved.lastAnchor ? saved.lastAnchor : null;
        void loadContent(openFaqId, target, guideList.find((g) => g.faqId === openFaqId) || null);
    }, [isActive, subView, openFaqId, content, readerLoading, readerError, mapping, guideList, loadContent]);

    const prevGameIdRef = useRef<number | null>(null);
    const hadGameRef = useRef(false);
    useEffect(() => {
        if (hadGameRef.current && prevGameIdRef.current !== gameId) {
            setSubView("list");
            setOpenFaqId(null);
            setContent(null);
            setLines([]);
            setMapping(null);
            setGuideList([]);
            setCandidates([]);
            setStatus("idle");
        }
        prevGameIdRef.current = gameId;
        if (gameId != null) {
            hadGameRef.current = true;
        }
    }, [gameId]);

    recordRef.current = record;

    const currentGuide: GuideUserData | null = useMemo(() => {
        if (!record || !openFaqId) return null;
        return record.guides[openFaqId] ?? null;
    }, [record, openFaqId]);

    const continueGuide = useMemo(() => {
        if (!record) return null;
        let best: { faqId: string; guide: GuideUserData } | null = null;
        for (const faqId of Object.keys(record.guides)) {
            const g = record.guides[faqId];
            if (!guideBelongsToMapping(g, record.gamefaqs?.gameUrl ?? null)) continue;
            const hasPos = g.lastPage > 0 || g.lastAnchor.length > 0;
            if (!hasPos) continue;
            if (!best || g.updatedAt > best.guide.updatedAt) {
                best = { faqId, guide: g };
            }
        }
        return best;
    }, [record]);

    const clearMapping = async () => {
        if (gameId == null) return;
        await clearGuideMapping(gameId);
        setMapping(null);
        loadedForGameIdRef.current = null;
        void resolveAndLoad(gameId);
    };

    const state = {
        subView,
        status,
        mapping,
        candidates,
        guideList,
        record,
        listLoading,
        searching,
        manualSearchTerm,
        searchNoResults,
        searchFailed,
        cfWaiting,
        openFaqId,
        content,
        lines,
        chunks,
        chunkIndex,
        formattedPages,
        restoreLine,
        restoreInto,
        chunkFraction,
        restoreToken,
        readerLoading,
        readerError,
        readerFetching,
        sections,
        sectionIndex,
        guideZoom,
        currentGuide,
        continueGuide,
        language,
    };

    const actions = {
        openGuide,
        gotoChunk,
        gotoSection,
        jumpToLine,
        syncPositionFromStore,
        savePosition,
        refreshRecord,
        addBookmark,
        removeBookmark,
        renameBookmark,
        setTypeFilter,
        manualSearch,
        setManualSearchTerm,
        pickCandidate,
        updateGuide,
        refreshList,
        retryLoad,
        clearMapping,
        zoomIn,
        zoomOut,
        goToList,
        goToSearch,
        handleBack,
        enterFromResume,
    };

    return { state, actions };
}

export type GuidesControllerState = ReturnType<typeof useGuidesController>["state"];
export type GuideUpdateOutcome = "updated" | "current" | "failed";

export type GuidesControllerActions = ReturnType<typeof useGuidesController>["actions"];
