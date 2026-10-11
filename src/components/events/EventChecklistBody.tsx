import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { PanelSectionRow } from "@decky/ui";
import { BottomFocusAnchor } from "../ui/BottomFocusAnchor";
import { ButtonHints } from "../ui/ButtonHints";
import { ErrorText } from "../ui/ErrorText";
import { InfoText } from "../ui/InfoText";
import { InlineSpinner } from "../ui/InlineSpinner";
import { LabeledRow } from "../ui/LabeledRow";
import { SystemHeader } from "../mastery/SystemHeader";
import { SetGameCard, type SetGameCardListProps } from "../mastery/SetGameCard";
import { groupGamesByConsole } from "../mastery/setGameGrouping";
import { useEvents } from "./EventsContext";
import { prefetchGameIcons } from "../../api";
import { useConsoleIcons } from "../../hooks/useConsoleIcons";
import { useSlidingWindow } from "../../hooks/useSlidingWindow";
import { SlidingWindowRows } from "../ui/SlidingWindowRows";
import type { LandingWindows } from "../../focusRecords";
import { localizeRuntimeText, t, type LanguageCode } from "../../locales";
import type {
    ChecklistFilter,
    ChecklistGameProgress,
    ChecklistTick,
    ChecklistView,
    EventChecklistGame,
    TrackedSetGame,
    TrackedSetViewMode
} from "../../types";
import { checklistTickFor, type ChecklistCard, type ChecklistLevel } from "../../utils/events";
import { playToggleSound } from "../../utils/navSound";
import { achievementGreen, achievementUiMetrics, regularButtonSpacingStyle, smallTextStyle } from "../../utils/style";
import { textSize } from "../../utils/scale";

type ChecklistClick = "open" | "tick" | "master";

const TICK_MARK = <span style={{ color: achievementGreen, fontSize: "20px", fontWeight: 800 }}>{"✔"}</span>;
const MASTERED_MARK = <span style={{ color: "#fbbf24", fontSize: "20px", fontWeight: 800 }}>{"✔"}</span>;

type Group = { key: string; label: string; consoleName: string | null; games: TrackedSetGame[] };

type ChecklistEntry = { group: Group } | TrackedSetGame;

function entryKey(entry: ChecklistEntry): string {
    return "group" in entry ? `group:${entry.group.key}` : String(entry.gameId);
}

function entryFocusKey(entry: ChecklistEntry): string {
    return "group" in entry ? `eventchecklistgroup:${entry.group.key}` : `eventchecklist:${entry.gameId}`;
}

const CARD_FALLBACK = ["eventchecklist:view"];

type EventChecklistBodyProps = {
    language: LanguageCode;
    eventGameId: number;
    cards: ChecklistCard[];
    games: Record<string, EventChecklistGame>;
    progress: Record<string, ChecklistGameProgress> | null;
    progressLoading: boolean;
    progressError: string | null;
    ruleText: string;
    masteryMarkable: boolean;
    undated: boolean;
    onOpenGame: (gameId: number) => void;
    onSetTick: (gameId: number, value: ChecklistTick | null) => void;
    landingWindowsRef: MutableRefObject<LandingWindows | null>;
};

function cardGame(card: ChecklistCard, index: number, games: Record<string, EventChecklistGame>, progress: Record<string, ChecklistGameProgress> | null): TrackedSetGame {
    const info = games[String(card.gameId)];
    const played = progress?.[String(card.gameId)];
    const award = played?.highestAwardKind;
    return {
        gameId: card.gameId,
        title: info?.title || `#${card.gameId}`,
        imageIcon: info?.imageIcon ?? "",
        consoleName: info?.consoleName ?? "",
        note: "",
        color: "default",
        manualOrder: index,
        systemOrder: index,
        systemYearOrder: index,
        retroOrder: index,
        retroAlphaOrder: index,
        numAwarded: played ? played.numAwardedHardcore : null,
        maxPossible: played && played.maxPossible > 0 ? played.maxPossible : null,
        highestAward: award === "mastered" || award === "completed" || award === "beaten-hardcore" || award === "beaten-softcore"
            ? award
            : null,
        lastCheckedAt: null
    };
}

export function EventChecklistBody(props: EventChecklistBodyProps) {
    const { language, cards, games, progress } = props;
    const { state, actions, settings } = useEvents();
    const saved = state.user?.checklistViews?.[String(props.eventGameId)];
    const view: ChecklistView = saved?.view ?? "sections";
    const filter: ChecklistFilter = saved?.filter ?? "all";
    const [clickAction, setClickAction] = useState<ChecklistClick>("open");

    const consoleIconFor = useConsoleIcons(view !== "sections" && settings.showIcons);

    const byId = useMemo(() => new Map(cards.map((card) => [card.gameId, card])), [cards]);

    const groups = useMemo<Group[]>(() => {
        const kept = cards.filter((card) =>
            filter === "all" || (filter === "ticked" ? card.ticked : !card.ticked)
        );
        const tracked = kept.map((card, index) => cardGame(card, index, games, progress));
        if (view === "sections") {
            const bySection = new Map<string, TrackedSetGame[]>();
            kept.forEach((card, index) => {
                const list = bySection.get(card.sectionLabel) ?? [];
                list.push(tracked[index]);
                bySection.set(card.sectionLabel, list);
            });
            return [...bySection.entries()].map(([label, list]) => ({
                key: `section:${label}`,
                label,
                consoleName: null,
                games: list
            }));
        }
        return groupGamesByConsole(tracked, view as TrackedSetViewMode, "manual").map((group) => ({
            key: `console:${group.consoleName}`,
            label: group.consoleName,
            consoleName: group.consoleName,
            games: group.games
        }));
    }, [cards, games, progress, view, filter]);

    const flat = useMemo(() => groups.flatMap((group) => group.games), [groups]);
    const entries = useMemo<ChecklistEntry[]>(() => groups.flatMap((group) => [{ group }, ...group.games]), [groups]);

    const checklistWindow = useSlidingWindow({
        items: entries,
        itemKey: entryKey,
        focusKeyFor: entryFocusKey,
        windowId: "eventchecklist:games",
        heightScope: ["eventchecklist:games", settings.uiSize, settings.showIcons, language, view].join("|"),
        dynamicLoading: settings.dynamicLoading,
        initialRows: settings.dynamicInitialRows,
        rowStep: settings.dynamicRowStep,
        prefetchDistance: settings.dynamicPrefetchDistance,
        sentinelRootMarginPx: settings.dynamicSentinelRootMargin,
        resetKey: `${props.eventGameId}|${view}|${filter}`,
        debugLabel: "eventchecklist:games"
    });
    const mountedItems = useMemo(
        () => checklistWindow.mountedItems.filter((entry): entry is TrackedSetGame => !("group" in entry)),
        [checklistWindow.mountedItems]
    );
    props.landingWindowsRef.current = {
        holds: (key) => flat.some((game) => `eventchecklist:${game.gameId}` === key),
        open: (key) => checklistWindow.openAt(key)
    };

    useEffect(function prefetchChecklistIcons() {
        if (!settings.showIcons || mountedItems.length === 0) {
            return;
        }
        void prefetchGameIcons(mountedItems.map((game) => ({ gameId: game.gameId, imageIcon: game.imageIcon })));
    }, [mountedItems, settings.showIcons]);

    function mark(gameId: number, press: "tick" | "master") {
        const card = byId.get(gameId);
        if (!card) {
            return;
        }
        const own: ChecklistLevel = press === "master" ? 2 : 1;
        const level: ChecklistLevel = card.level === own ? 0 : own;
        playToggleSound(level > 0);
        props.onSetTick(gameId, checklistTickFor(card, level));
    }

    const gamepad = !settings.mouseKeyboardMode;
    const openRef = useRef(props.onOpenGame);
    openRef.current = props.onOpenGame;
    const markRef = useRef(mark);
    markRef.current = mark;
    const clickRef = useRef(clickAction);
    clickRef.current = gamepad ? "open" : clickAction;
    const focusRef = useRef(checklistWindow.onItemFocus);
    focusRef.current = checklistWindow.onItemFocus;

    const metrics = useMemo(() => achievementUiMetrics(settings.uiSize), [settings.uiSize]);
    const buttonOuterStyle = useMemo(() => regularButtonSpacingStyle(settings.buttonSpacing), [settings.buttonSpacing]);
    const list = useMemo<SetGameCardListProps>(() => ({
        aButtonMode: "info",
        reorderMode: false,
        language,
        showIcons: settings.showIcons,
        metrics,
        buttonOuterStyle,
        focusKeyPrefix: "eventchecklist",
        focusFallback: CARD_FALLBACK,
        onOpenGameOverview: (gameId) => {
            if (clickRef.current !== "open") {
                markRef.current(gameId, clickRef.current);
                return;
            }
            openRef.current(gameId);
        },
        onCardFocus: (slotIndex) => focusRef.current(slotIndex),
        onCardSecondary: gamepad ? (game) => markRef.current(game.gameId, "tick") : undefined,
        onCardOptions: gamepad && props.masteryMarkable ? (game) => markRef.current(game.gameId, "master") : undefined
    }), [language, settings.showIcons, metrics, buttonOuterStyle, gamepad, props.masteryMarkable]);

    const viewLabel = view === "sections"
        ? t(language, "Checklist")
        : view === "system"
            ? t(language, "System")
            : t(language, "System (Year)");
    const filterLabel = filter === "all"
        ? t(language, "All")
        : filter === "todo" ? t(language, "To Do") : t(language, "Checked");

    let guardSlot = checklistWindow.start;
    if (checklistWindow.mountedItems.length > 0 && "group" in checklistWindow.mountedItems[0]) {
        guardSlot += 1;
    }
    const rendered = checklistWindow.mountedItems.map((entry, offset) => {
        const index = checklistWindow.start + offset;
        if ("group" in entry) {
            const group = entry.group;
            return group.consoleName !== null ? (
                <SystemHeader
                    key={group.key}
                    viewMode={view as TrackedSetViewMode}
                    consoleName={group.consoleName}
                    count={group.games.length}
                    iconUrl={consoleIconFor(group.consoleName)}
                    language={language}
                    showIcons={settings.showIcons}
                    metrics={metrics}
                />
            ) : (
                <PanelSectionRow key={group.key}>
                    <div style={{ fontSize: `${textSize(15)}px`, fontWeight: 800, margin: "8px 0 2px 0" }}>
                        {`${group.label} (${group.games.length})`}
                    </div>
                </PanelSectionRow>
            );
        }
        const card = byId.get(entry.gameId);
        return (
            <SetGameCard
                key={entry.gameId}
                game={entry}
                done={Boolean(card?.ticked)}
                slotIndex={index}
                isReorderTarget={false}
                trashArmed={false}
                claimToken={0}
                corner={card?.level === 2 ? MASTERED_MARK : card?.ticked ? TICK_MARK : undefined}
                extraLine={card?.beforeEvent && !card.ticked ? t(language, "Before event") : undefined}
                list={list}
                onGamepadDirection={index === guardSlot ? checklistWindow.guardTopRow(index) : undefined}
            />
        );
    });

    return (
        <>
            {props.ruleText && (
                <>
                    <PanelSectionRow>
                        <div style={{ ...smallTextStyle(), padding: "4px 0" }}>{props.ruleText}</div>
                    </PanelSectionRow>
                    <BottomFocusAnchor focusKey="eventchecklist:rule" headroomPx={0} />
                </>
            )}
            <PanelSectionRow>
                <InfoText>
                    {props.undated
                        ? t(language, "Checkmarks will be added for you for any game you have beaten or mastered in hardcore. This event has no start date, so older ones count too. Feel free to change any of them.")
                        : t(language, "Checkmarks will be added for you if you have beaten or mastered a game in hardcore since the event started. Feel free to change any of them.")}
                </InfoText>
            </PanelSectionRow>
            <LabeledRow
                focusKey="eventchecklist:view"
                bottomSeparator="none"
                label={t(language, "View")}
                value={viewLabel}
                onClick={() => actions.setChecklistView(props.eventGameId, {
                    view: view === "sections" ? "system" : view === "system" ? "systemYear" : "sections",
                    filter
                })}
            />
            <LabeledRow
                focusKey="eventchecklist:filter"
                bottomSeparator="none"
                label={t(language, "Filter")}
                value={filterLabel}
                onClick={() => actions.setChecklistView(props.eventGameId, {
                    view,
                    filter: filter === "all" ? "todo" : filter === "todo" ? "ticked" : "all"
                })}
            />
            {settings.mouseKeyboardMode ? (
                <LabeledRow
                    focusKey="eventchecklist:click"
                    bottomSeparator="none"
                    label={t(language, "Click")}
                    value={clickAction === "tick"
                        ? t(language, "Mark Beaten")
                        : clickAction === "master" ? t(language, "Mark Mastered") : t(language, "View Info")}
                    onClick={() => setClickAction((current) => {
                        if (current === "open") {
                            return "tick";
                        }
                        return current === "tick" && props.masteryMarkable ? "master" : "open";
                    })}
                />
            ) : (
                <PanelSectionRow>
                    <ButtonHints
                        style={settings.controllerGlyphStyle}
                        hints={[
                            { button: "a", label: t(language, "View Info") },
                            { button: "x", label: t(language, "Beaten") },
                            ...(props.masteryMarkable ? [{ button: "y" as const, label: t(language, "Mastered") }] : [])
                        ]}
                    />
                </PanelSectionRow>
            )}
            {props.progressError && (
                <PanelSectionRow>
                    <ErrorText>{localizeRuntimeText(language, props.progressError)}</ErrorText>
                </PanelSectionRow>
            )}
            {progress === null && props.progressLoading ? (
                <PanelSectionRow>
                    <InlineSpinner label={t(language, "Loading...")} />
                </PanelSectionRow>
            ) : (
                <>
                    {flat.length === 0 && (
                        <PanelSectionRow>
                            <div style={{ ...smallTextStyle(), width: "100%", textAlign: "center", padding: "8px 0" }}>
                                {t(language, "No games match this filter.")}
                            </div>
                        </PanelSectionRow>
                    )}
                    <SlidingWindowRows list={checklistWindow}>{rendered}</SlidingWindowRows>
                </>
            )}
        </>
    );
}
