import { Fragment, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
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
import { ClaimedRow } from "./ClaimedRow";
import { useEvents } from "./EventsContext";
import { prefetchGameIcons } from "../../api";
import { useConsoleIcons } from "../../hooks/useConsoleIcons";
import { useFocusClaim } from "../../hooks/useFocusClaim";
import { useWindowedList } from "../../hooks/useWindowedList";
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

const RESTORE_SEED_CEILING = 300;

const TICK_MARK = <span style={{ color: achievementGreen, fontSize: "20px", fontWeight: 800 }}>{"✔"}</span>;
const MASTERED_MARK = <span style={{ color: "#fbbf24", fontSize: "20px", fontWeight: 800 }}>{"✔"}</span>;

type Group = { key: string; label: string; consoleName: string | null; games: TrackedSetGame[] };

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
    restoreGameId: number | null;
    onRestoreSettled: () => void;
    onOpenGame: (gameId: number) => void;
    onSetTick: (gameId: number, value: ChecklistTick | null) => void;
    onRequestFocus: (focusKey: string) => void;
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

    const claim = useFocusClaim();
    const firedRef = useRef(false);
    const [seedRows, setSeedRows] = useState<number | undefined>(undefined);
    useEffect(() => {
        if (props.restoreGameId === null || firedRef.current || progress === null) {
            return;
        }
        firedRef.current = true;
        const index = flat.findIndex((game) => game.gameId === props.restoreGameId);
        if (index < 0 || index >= RESTORE_SEED_CEILING) {
            props.onRestoreSettled();
            props.onRequestFocus("eventviewer:back");
            return;
        }
        setSeedRows(index + 1 + settings.dynamicRowStep);
        claim.claimSlot(index);
        props.onRequestFocus(`eventchecklist:${props.restoreGameId}`);
    }, [progress, flat, props.restoreGameId]);
    const spent = firedRef.current && (claim.claim?.token ?? 0) > 0 && !claim.claim?.armed;
    useEffect(() => {
        if (spent) {
            props.onRestoreSettled();
            setSeedRows(undefined);
        }
    }, [spent]);

    const { mountedItems, markerRef, onItemFocus } = useWindowedList({
        items: flat,
        dynamicLoading: settings.dynamicLoading,
        initialRows: settings.dynamicInitialRows,
        rowStep: settings.dynamicRowStep,
        prefetchDistance: settings.dynamicPrefetchDistance,
        sentinelRootMargin: `${settings.dynamicSentinelRootMargin}px 0px`,
        resetKey: `${props.eventGameId}|${view}|${filter}`,
        seedRows
    });

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
    const focusRef = useRef(onItemFocus);
    focusRef.current = onItemFocus;

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

    const rendered: ReactElement[] = [];
    let slot = 0;
    for (const group of groups) {
        if (slot >= mountedItems.length) {
            break;
        }
        rendered.push(
            <Fragment key={group.key}>
                {group.consoleName !== null ? (
                    <SystemHeader
                        viewMode={view as TrackedSetViewMode}
                        consoleName={group.consoleName}
                        count={group.games.length}
                        iconUrl={consoleIconFor(group.consoleName)}
                        language={language}
                        showIcons={settings.showIcons}
                        metrics={metrics}
                    />
                ) : (
                    <PanelSectionRow>
                        <div style={{ fontSize: `${textSize(15)}px`, fontWeight: 800, margin: "8px 0 2px 0" }}>
                            {`${group.label} (${group.games.length})`}
                        </div>
                    </PanelSectionRow>
                )}
            </Fragment>
        );
        for (const game of group.games) {
            if (slot >= mountedItems.length) {
                break;
            }
            const card = byId.get(game.gameId);
            const index = slot;
            rendered.push(
                <ClaimedRow key={`eventchecklist:slot:${index}`} claim={claim} slotIndex={index}>
                    <SetGameCard
                        game={game}
                        done={Boolean(card?.ticked)}
                        slotIndex={index}
                        isReorderTarget={false}
                        trashArmed={false}
                        claimToken={0}
                        corner={card?.level === 2 ? MASTERED_MARK : card?.ticked ? TICK_MARK : undefined}
                        extraLine={card?.beforeEvent && !card.ticked ? t(language, "Before event") : undefined}
                        list={list}
                    />
                </ClaimedRow>
            );
            slot += 1;
        }
    }

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
                    {rendered}
                    {mountedItems.length < flat.length && <div ref={markerRef} style={{ height: "1px" }} />}
                </>
            )}
        </>
    );
}
