import { Focusable, PanelSection, PanelSectionRow, TextField } from "@decky/ui";
import React, { useMemo, useRef } from "react";

import { BackButton } from "../components/ui/BackButton";
import { BottomFocusAnchor } from "../components/ui/BottomFocusAnchor";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { FadeImage } from "../components/ui/FadeImage";
import { FocusableItem } from "../components/ui/FocusableItem";
import { useGameIcon } from "../hooks/useGameIcon";
import { LabeledRow } from "../components/ui/LabeledRow";
import { InfoText } from "../components/ui/InfoText";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { ToggleRow } from "../components/ui/ToggleRow";
import { ErrorText } from "../components/ui/ErrorText";
import { GuidesReaderModal } from "../components/guides/GuidesReaderModal";
import { GuidesQamReader } from "../components/guides/GuidesQamReader";
import { GuideContextBanner } from "../components/guides/GuideContextBanner";
import { showManagedModal } from "../utils/modalRegistry";
import { playOkSound } from "../utils/navSound";
import { t, type LanguageCode } from "../locales";
import type { ButtonSpacing, ControllerGlyphStyle, ViewKey } from "../types";
import type { GuidesControllerActions, GuidesControllerState } from "../hooks/useGuidesController";
import { useWindowedList } from "../hooks/useWindowedList";
import { bodyTextStyle, regularButtonSpacingStyle } from "../utils/style";

type GuidesPageState = {
    view: ViewKey;
    focusScopeResetToken: number;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    showIcons: boolean;
    gameId: number | null;
    title: string | null;
    imageIcon: string | null;
    consoleName: string | null;
    mouseKeyboardMode: boolean;
    controllerGlyphStyle: ControllerGlyphStyle;
    dynamicLoading: boolean;
    dynamicInitialRows: number;
    dynamicRowStep: number;
    dynamicPrefetchDistance: number;
    dynamicSentinelRootMargin: number;
    pinLatestGuides: boolean;
    keepGuidesOffline: boolean;
    guides: GuidesControllerState;
};

type GuidesPageActions = {
    onBack: () => void | Promise<void>;
    onHome: () => void | Promise<void>;
    onTogglePinLatestGuides: (nextValue: boolean) => void | Promise<void>;
    onToggleKeepGuidesOffline: (nextValue: boolean) => void | Promise<void>;
    guides: GuidesControllerActions;
};

type GuidesPageProps = {
    state: GuidesPageState;
    actions: GuidesPageActions;
};

const GUIDE_TYPE_SHORT_LABELS: Record<string, string> = {
    "Foreign Language Guides": "Foreign Guides",
};

function guideTypeDisplay(type: string): string {
    return GUIDE_TYPE_SHORT_LABELS[type] ?? type;
}

function guideTypeLabel(value: string, language: LanguageCode): string {
    if (value === "all") return t(language, "All");
    return guideTypeDisplay(value);
}

function nextGuideType(current: string, availableTypes: string[]): string {
    const order = ["all", ...availableTypes];
    const index = order.indexOf(current);
    return order[(index < 0 ? 0 : index + 1) % order.length];
}

export function GuidesPage(props: GuidesPageProps) {
    const { state, actions } = props;
    const g = state.guides;
    const ga = actions.guides;
    const lang = state.language;

    const sentinelRootMargin = `${Math.max(0, state.dynamicSentinelRootMargin ?? 600)}px 0px`;

    const openedSignature = useMemo(() => {
        const guides = g.record?.guides;
        if (!guides) {
            return "";
        }
        return Object.keys(guides)
            .map((faqId) => `${faqId}:${guides[faqId].lastOpenedAt ?? 0}`)
            .sort()
            .join(",");
    }, [g.record]);

    const guideTypes = useMemo(() => {
        const seen = new Set<string>();
        for (const entry of g.guideList) {
            if (entry.type) seen.add(entry.type);
        }
        return Array.from(seen);
    }, [g.guideList]);

    const storedTypeFilter = g.record?.typeFilter || "all";
    const typeFilter = storedTypeFilter !== "all" && !guideTypes.includes(storedTypeFilter)
        ? "all"
        : storedTypeFilter;

    const allRows = useMemo(() => {
        return g.guideList.map((entry) => ({
            entry,
            lastOpenedAt: g.record?.guides[entry.faqId]?.lastOpenedAt ?? 0,
        }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [g.guideList, openedSignature]);

    const guideRows = useMemo(() => {
        const filtered = typeFilter === "all"
            ? allRows.slice()
            : allRows.filter((r) => r.entry.type === typeFilter);
        filtered.sort((a, b) => {
            if (a.lastOpenedAt !== b.lastOpenedAt) return b.lastOpenedAt - a.lastOpenedAt;
            return a.entry.title.localeCompare(b.entry.title);
        });
        return filtered;
    }, [allRows, typeFilter]);

    const latestFaqId = useMemo(() => {
        let best: string | null = null;
        let bestOpenedAt = 0;
        for (const row of allRows) {
            if (row.lastOpenedAt > bestOpenedAt) {
                bestOpenedAt = row.lastOpenedAt;
                best = row.entry.faqId;
            }
        }
        return best;
    }, [allRows]);


    const guidesWindow = useWindowedList({
        items: guideRows,
        dynamicLoading: state.dynamicLoading,
        initialRows: Math.max(8, state.dynamicInitialRows),
        rowStep: Math.max(8, state.dynamicRowStep),
        prefetchDistance: state.dynamicPrefetchDistance,
        sentinelRootMargin,
        resetKey: `guides:list:${state.gameId ?? "none"}:${typeFilter}`,
    });

    const openGuideRef = useRef(ga.openGuide);
    openGuideRef.current = ga.openGuide;
    const cardFocusRef = useRef(guidesWindow.onItemFocus);
    cardFocusRef.current = guidesWindow.onItemFocus;

    const cardList = useMemo<GuideCardListProps>(() => ({
        gameId: state.gameId,
        imageIcon: state.imageIcon,
        showIcons: state.showIcons,
        language: lang,
        onCardFocus: (index) => {
            cardFocusRef.current(index);
        },
        onOpen: (faqId) => {
            void openGuideRef.current(faqId);
        }
    }), [state.gameId, state.imageIcon, state.showIcons, lang]);

    if (state.view !== "guides") {
        return null;
    }

    const backLabel = t(lang, "← Back to Main");

    function openGuideInModal(
        faqId: string,
        startLine: number | null,
        fromReader: boolean,
        sectionSlug: string | null = null,
        startInto = 0
    ) {
        const entry = g.guideList.find((x) => x.faqId === faqId);
        showManagedModal((close) => (
            <GuidesReaderModal
                language={lang}
                title={entry?.title || state.title || t(lang, "Guide")}
                gameId={state.gameId}
                imageIcon={state.imageIcon}
                showIcons={state.showIcons}
                faqId={faqId}
                gameUrl={g.mapping?.gameUrl ?? null}
                initialContent={fromReader ? g.content : null}
                initialLine={startLine}
                initialInto={startInto}
                initialSection={sectionSlug}
                mouseKeyboardMode={state.mouseKeyboardMode}
                close={close}
                onClosed={() => {
                    if (fromReader) {
                        void ga.syncPositionFromStore();
                        return;
                    }
                    void ga.refreshRecord();
                }}
            />
        ));
    }

    const scopeKey = `guides:${g.subView}:${g.openFaqId ?? "list"}:${state.focusScopeResetToken}`;

    function pressBack() {
        playOkSound();
        if (g.subView === "list") {
            void actions.onBack();
            return;
        }
        ga.goToList();
    }

    if (g.subView === "reader") {
        return (
            <Focusable key={scopeKey} onCancelButton={pressBack}>
                <PanelSection>
                    <PageNavStrip
                        title={t(lang, "Guides")}
                        buttonSpacing={state.buttonSpacing}
                        onHome={actions.onHome}
                    />
                    <GuidesQamReader
                        state={g}
                        actions={ga}
                        language={lang}
                        buttonSpacing={state.buttonSpacing}
                        keepGuidesOffline={state.keepGuidesOffline}
                        gameId={state.gameId}
                        mouseKeyboardMode={state.mouseKeyboardMode}
                        controllerGlyphStyle={state.controllerGlyphStyle}
                        onOpenModal={(startLine, sectionSlug, startInto) => {
                            if (g.openFaqId) openGuideInModal(g.openFaqId, startLine, true, sectionSlug, startInto);
                        }}
                    />
                </PanelSection>
            </Focusable>
        );
    }

    if (g.subView === "search") {
        return (
            <Focusable key={scopeKey} onCancelButton={pressBack}>
                <PanelSection>
                    <PageNavStrip
                        title={t(lang, "Guides")}
                        buttonSpacing={state.buttonSpacing}
                        onHome={actions.onHome}
                    />
                    <BackButton
                        label={t(lang, "← Back to Guides")}
                        focusKey="guides:back"
                        navAutoFocus
                        buttonSpacing={state.buttonSpacing}
                        autoFocus={true}
                        onClick={() => ga.goToList()}
                    />
                    <GuidesSearchBox
                            state={g}
                            actions={ga}
                            language={lang}
                            buttonSpacing={state.buttonSpacing}
                            dynamicLoading={state.dynamicLoading}
                            dynamicInitialRows={state.dynamicInitialRows}
                            dynamicRowStep={state.dynamicRowStep}
                            dynamicPrefetchDistance={state.dynamicPrefetchDistance}
                            sentinelRootMargin={sentinelRootMargin}
                    />
                </PanelSection>
            </Focusable>
        );
    }

    return (
        <Focusable key={scopeKey} onCancelButton={pressBack}>
            <PanelSection>
                <PageNavStrip
                    title={t(lang, "Guides")}
                    buttonSpacing={state.buttonSpacing}
                    onHome={actions.onHome}
                />
                <BackButton
                    label={backLabel}
                    focusKey="guides:back"
                    navAutoFocus
                    buttonSpacing={state.buttonSpacing}
                    autoFocus={true}
                    onClick={actions.onBack}
                />

                <GuideContextBanner
                    gameId={state.gameId}
                    imageIcon={state.imageIcon}
                    title={state.title}
                    subtitle={state.consoleName}
                    showIcons={state.showIcons}
                />

                <PanelSectionRow>
                    <ToggleRow
                        outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                        label={t(lang, "Pin Latest Guide")}
                        value={state.pinLatestGuides}
                        onChange={actions.onTogglePinLatestGuides}
                        help={t(lang, "help_pin_latest_guides")}
                    />
                </PanelSectionRow>
                <PanelSectionRow>
                    <ToggleRow
                        outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                        label={t(lang, "Offline Guides")}
                        value={state.keepGuidesOffline}
                        onChange={actions.onToggleKeepGuidesOffline}
                        help={t(lang, "help_truly_offline_guides")}
                    />
                </PanelSectionRow>
                {g.status !== "unavailable" && (
                    <PanelSectionRow>
                        <FocusableItem
                            focusKey="guides:correctgame"
                            outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                            onClick={() => ga.goToSearch()}
                        >
                            {t(lang, "Correct Game")}
                        </FocusableItem>
                    </PanelSectionRow>
                )}

                {g.status === "resolved" && (
                    <PanelSectionRow>
                        <FocusableItem
                            focusKey="guides:refresh"
                            outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                            disabled={g.listLoading}
                            onClick={() => void ga.refreshList()}
                        >
                            {g.listLoading ? t(lang, "Refreshing…") : t(lang, "Refresh Guides")}
                        </FocusableItem>
                    </PanelSectionRow>
                )}

                {(g.status === "resolving" || g.listLoading) && (
                    <PanelSectionRow>
                        <InlineSpinner
                            label={g.cfWaiting
                                ? t(lang, "Waiting for GameFAQs security check…")
                                : t(lang, "Loading guides…")}
                        />
                    </PanelSectionRow>
                )}

                {g.status === "unavailable" && (
                    <PanelSectionRow>
                        <ErrorText>{t(lang, "Guides need the Steam browser, which isn't available here.")}</ErrorText>
                    </PanelSectionRow>
                )}

                {
}
                {(g.status === "noguides" || g.status === "error") && (
                    <>
                        <PanelSectionRow>
                            <div style={{ marginTop: "8px" }}>
                                <InfoText>
                                    {g.status === "noguides"
                                        ? t(lang, "No guides found on GameFAQs for this game.")
                                        : t(lang, "Couldn't match this game on GameFAQs.")}
                                </InfoText>
                            </div>
                        </PanelSectionRow>
                        <BottomFocusAnchor focusKey="guides:bottom:anchor" />
                    </>
                )}

                {g.status === "network" && (
                    <>
                        <PanelSectionRow>
                            <FocusableItem
                                focusKey="guides:retry"
                                outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                onClick={() => ga.retryLoad()}
                            >
                                {t(lang, "Try Again")}
                            </FocusableItem>
                        </PanelSectionRow>
                        <PanelSectionRow>
                            <ErrorText>{t(lang, "GameFAQs didn't respond. Check your connection and try again.")}</ErrorText>
                        </PanelSectionRow>
                    </>
                )}

                {g.status === "resolved" && (
                    <>
                        {guideTypes.length > 0 && (
                            <LabeledRow
                                outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                focusKey="guides:typefilter"
                                onClick={() => void ga.setTypeFilter(nextGuideType(typeFilter, guideTypes))}
                                label={t(lang, "Guide")}
                                value={guideTypeLabel(typeFilter, lang)}
                            />
                        )}

                        {guideRows.length === 0 ? (
                            <>
                                <PanelSectionRow>
                                    <div style={{ marginTop: "8px" }}>
                                        <InfoText>{t(lang, "No guides match this filter.")}</InfoText>
                                    </div>
                                </PanelSectionRow>
                                <BottomFocusAnchor focusKey="guides:bottom:anchor" />
                            </>
                        ) : (
                            <>
                                {guidesWindow.mountedItems.map((row, index) => (
                                    <GuideCard
                                        key={row.entry.faqId}
                                        faqId={row.entry.faqId}
                                        title={row.entry.title}
                                        author={row.entry.author}
                                        type={guideTypeDisplay(row.entry.type)}
                                        formatted={(row.entry.flair ?? []).includes("HTML")}
                                        offlineOnly={row.entry.offlineOnly === true}
                                        hasPosition={row.entry.faqId === latestFaqId}
                                        index={index}
                                        list={cardList}
                                    />
                                ))}
                                {state.dynamicLoading && guidesWindow.mountedItems.length < guideRows.length && (
                                    <div ref={guidesWindow.markerRef} style={{ height: "1px" }} />
                                )}
                            </>
                        )}
                    </>
                )}
            </PanelSection>
        </Focusable>
    );
}

type GuideCardListProps = {
    gameId: number | null;
    imageIcon: string | null;
    showIcons: boolean;
    language: LanguageCode;
    onCardFocus: (index: number) => void;
    onOpen: (faqId: string) => void;
};

type GuideCardProps = {
    faqId: string;
    title: string;
    author: string;
    type: string;
    formatted: boolean;
    offlineOnly: boolean;
    hasPosition: boolean;
    index: number;
    list: GuideCardListProps;
};

const GuideCard = React.memo(function GuideCard(props: GuideCardProps) {
    const { list } = props;
    const { iconDataUri } = useGameIcon(list.showIcons ? list.gameId : null, list.imageIcon, "GuideCard useGameIcon");
    const authorLine = props.author ? t(list.language, "by {{author}}", { author: props.author }) : "";
    const formattedLine = props.formatted ? t(list.language, "Formatted") : "";
    const savedLine = props.offlineOnly ? t(list.language, "Saved copy") : "";
    const subtitle = [props.type, authorLine, formattedLine, savedLine].filter(Boolean).join(" · ");

    function handleFocus() {
        list.onCardFocus(props.index);
    }

    function handleOpen() {
        list.onOpen(props.faqId);
    }

    return (
        <FocusableItem
            focusKey="guides:card:open"
            onFocus={handleFocus}
            onClick={handleOpen}
            outerStyle={{ width: "100%", minWidth: 0 }}
        >
            <div style={{ width: "100%", display: "flex", gap: "10px", alignItems: "flex-start", minWidth: 0 }}>
                {list.showIcons && (
                    <div style={{ width: "44px", height: "44px", borderRadius: "7px", overflow: "hidden", flexShrink: 0, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                        {iconDataUri ? (
                            <FadeImage src={iconDataUri} fadeOnLoad={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        ) : null}
                    </div>
                )}
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "1px", textAlign: "left" }}>
                    <span style={{ fontWeight: 700, wordBreak: "break-word", display: "flex", alignItems: "center", gap: "6px" }}>
                        {props.hasPosition && <span style={{ color: "#4ade80", fontSize: "10px" }}>●</span>}
                        {props.title}
                    </span>
                    {subtitle && <span style={{ opacity: 0.7, fontSize: "0.85em", wordBreak: "break-word" }}>{subtitle}</span>}
                </div>
            </div>
        </FocusableItem>
    );
});


type GuideCandidate = GuidesControllerState["candidates"][number];

type GuideCandidateListProps = {
    language: LanguageCode;
    outerStyle: ReturnType<typeof regularButtonSpacingStyle>;
    onCandidateFocus: (index: number) => void;
    onPick: (candidate: GuideCandidate) => void;
};

type GuideCandidateRowProps = {
    candidate: GuideCandidate;
    index: number;
    list: GuideCandidateListProps;
};

const GuideCandidateRow = React.memo(function GuideCandidateRow(props: GuideCandidateRowProps) {
    const { candidate, list } = props;

    const label = candidate.gameName || candidate.productName;
    const plats = candidate.platforms || candidate.platformSlug;

    function handleFocus() {
        list.onCandidateFocus(props.index);
    }

    function handlePick() {
        list.onPick(candidate);
    }

    return (
        <FocusableItem
            focusKey={`guides:candidate:${candidate.url}`}
            onFocus={handleFocus}
            onClick={handlePick}
            outerStyle={list.outerStyle}
        >
            {label}{plats ? ` (${plats})` : ""}
            {!candidate.hasGuides ? ` — ${t(list.language, "no guides")}` : ""}
        </FocusableItem>
    );
});


function GuidesSearchBox(props: {
    state: GuidesControllerState;
    actions: GuidesControllerActions;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    dynamicLoading: boolean;
    dynamicInitialRows: number;
    dynamicRowStep: number;
    dynamicPrefetchDistance: number;
    sentinelRootMargin: string;
}) {
    const { state, actions, language } = props;
    const term = state.manualSearchTerm;

    const candidateWindow = useWindowedList({
        items: state.candidates,
        dynamicLoading: props.dynamicLoading,
        initialRows: Math.max(8, props.dynamicInitialRows),
        rowStep: Math.max(8, props.dynamicRowStep),
        prefetchDistance: props.dynamicPrefetchDistance,
        sentinelRootMargin: props.sentinelRootMargin,
        resetKey: `guides:candidates:${state.candidates.length}:${state.candidates[0]?.url ?? "none"}`,
    });

    const pickCandidateRef = useRef(actions.pickCandidate);
    pickCandidateRef.current = actions.pickCandidate;
    const candidateFocusRef = useRef(candidateWindow.onItemFocus);
    candidateFocusRef.current = candidateWindow.onItemFocus;

    const candidateList = useMemo<GuideCandidateListProps>(() => ({
        language,
        outerStyle: regularButtonSpacingStyle(props.buttonSpacing),
        onCandidateFocus: (index) => {
            candidateFocusRef.current(index);
        },
        onPick: (candidate) => {
            void pickCandidateRef.current(candidate);
        }
    }), [language, props.buttonSpacing]);

    function runSearch() {
        if (state.searching || term.trim().length === 0) {
            return;
        }
        void actions.manualSearch(term);
    }

    return (
        <>
            <PanelSectionRow>
                <TextField
                    label={t(language, "Search GameFAQs")}
                    value={term}
                    onChange={(e: { target: { value: string } }) => actions.setManualSearchTerm(e.target.value)}
                />
            </PanelSectionRow>
            <PanelSectionRow>
                <InfoText>{t(language, "Not the right game? Search manually.")}</InfoText>
            </PanelSectionRow>
            <PanelSectionRow>
                <FocusableItem
                    focusKey="guides:manualsearch:go"
                    outerStyle={regularButtonSpacingStyle(props.buttonSpacing)}
                    onClick={runSearch}
                >
                    {state.searching ? t(language, "Searching…") : t(language, "Search")}
                </FocusableItem>
            </PanelSectionRow>
            {state.searchNoResults && (
                <PanelSectionRow>
                    <ErrorText>{t(language, "Couldn't find any results for your search.")}</ErrorText>
                </PanelSectionRow>
            )}
            {state.searchFailed && (
                <PanelSectionRow>
                    <ErrorText>{t(language, "GameFAQs didn't respond. Check your connection and try again.")}</ErrorText>
                </PanelSectionRow>
            )}
            {state.candidates.length > 0 && (
                <>
                    <PanelSectionRow>
                        <div style={{ ...bodyTextStyle(), fontWeight: 700 }}>{t(language, "Choose a game:")}</div>
                    </PanelSectionRow>
                    {candidateWindow.mountedItems.map((candidate, index) => (
                        <GuideCandidateRow
                            key={candidate.url}
                            candidate={candidate}
                            index={index}
                            list={candidateList}
                        />
                    ))}
                    {props.dynamicLoading && candidateWindow.mountedItems.length < state.candidates.length && (
                        <div ref={candidateWindow.markerRef} style={{ height: "1px" }} />
                    )}
                </>
            )}
        </>
    );
}
