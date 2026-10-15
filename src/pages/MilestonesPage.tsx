import { useMemo, useState } from "react";
import { DialogButton, Focusable, PanelSectionRow } from "@decky/ui";
import { BackButton } from "../components/ui/BackButton";
import { CollapsibleTitle } from "../components/ui/CollapsibleTitle";
import { FocusableItem } from "../components/ui/FocusableItem";
import { FocusTarget } from "../components/ui/FocusTarget";
import { LabeledRow } from "../components/ui/LabeledRow";
import { PageHelpButton, PageNavStrip } from "../components/ui/PageNavStrip";
import { PanelSection } from "../components/ui/PanelSection";
import { ProgressBar } from "../components/ui/ProgressBar";
import { SectionHeaderRow } from "../components/ui/SectionHeaderRow";
import { SlidingWindowRows } from "../components/ui/SlidingWindowRows";
import { SubTabButton } from "../components/ui/SubTabButton";
import { MilestoneCard, type MilestoneCardList } from "../components/milestones/MilestoneCard";
import { QuestCard } from "../components/milestones/QuestCard";
import { RankEmblem } from "../components/milestones/RankEmblem";
import { RankTableModal, rankName } from "../components/milestones/RankTableModal";
import { usePageLanding, pendingLandingKey } from "../focusRecords";
import { useMilestonesController } from "../hooks/useMilestonesController";
import { useSlidingWindow } from "../hooks/useSlidingWindow";
import { t, type LanguageCode } from "../locales";
import type {
    ButtonSpacing,
    MilestoneCategory,
    HeaderStyle,
    MilestoneDef,
    MilestonesSort,
    MilestonesState,
    MilestonesTab,
    ShortcutAction,
    ShortcutButton,
    UiSize,
    ViewKey
} from "../types";
import { showManagedModal } from "../utils/modalRegistry";
import { BUTTON_OK } from "../utils/gamepadButtons";
import { openExternalUrl } from "../utils/navigation";
import { playOkSound } from "../utils/navSound";
import { achievementUiMetrics, bodyTextStyle, smallTextStyle } from "../utils/style";

const GUIDE_URL = "https://github.com/FAILINATOR5000/decky-cheevodeck/blob/main/docs/tutorials/milestones.md";

const TABS: { value: MilestonesTab; labelKey: string; focusKey: string }[] = [
    { value: "milestones", labelKey: "Milestones", focusKey: "milestones:tab:milestones" },
    { value: "quests", labelKey: "Quests", focusKey: "milestones:tab:quests" }
];

const CATEGORY_LABELS: Record<string, string> = {
    getting_started: "Getting Started",
    navigation: "Navigation",
    unlocking: "Unlocking",
    organize: "Organize",
    social: "Social",
    community: "Community",
    memories: "Memories",
    explore: "Explore",
    global_buttons: "Global Buttons",
    dedication: "Dedication",
    easter_eggs: "Easter Eggs"
};

const SORT_FALLBACK = ["milestones:sort"];

const SORT_ROW_STYLE = `[data-focus-key="milestones:sort"] > div { padding-top: 0 !important; }`;

type MilestonesPageState = {
    view: ViewKey;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    uiSize: UiSize;
    tab: MilestonesTab;
    sort: MilestonesSort;
    headerStyle: HeaderStyle;
    shortcutBindings: Record<ShortcutButton, ShortcutAction>;
    globalButtonsOn: boolean;
    dynamicLoading: boolean;
    dynamicInitialRows: number;
    dynamicRowStep: number;
    dynamicPrefetchDistance: number;
    dynamicSentinelRootMargin: number;
    notifyEnabled: boolean;
    notifyToast: boolean;
};

type MilestonesPageActions = {
    onBack: () => void | Promise<void>;
    onHome: () => void | Promise<void>;
    onChangeTab: (tab: MilestonesTab) => void;
    onChangeSort: (sort: MilestonesSort) => void;
    onToggleNotify: (next: boolean) => void | Promise<void>;
    onToggleToast: (next: boolean) => void | Promise<void>;
};

type Entry =
    | { kind: "heading"; category: MilestoneCategory; collapsed: boolean; done: number; total: number }
    | { kind: "card"; milestone: MilestoneDef }
    | { kind: "unsupported"; category: MilestoneCategory };

function entryKey(entry: Entry): string {
    if (entry.kind === "heading") {
        return `heading:${entry.category.id}`;
    }
    return entry.kind === "card" ? entry.milestone.id : `unsupported:${entry.category.id}`;
}

function entryFocusKey(entry: Entry): string {
    if (entry.kind === "heading") {
        return `milestones:cat:${entry.category.id}`;
    }
    return entry.kind === "card" ? `milestone:${entry.milestone.id}` : "milestones:gb:unsupported";
}

function buildEntries(state: MilestonesState, sort: MilestonesSort): Entry[] {
    const available = new Set(state.available);
    const collapsed = new Set(state.collapsed);
    const out: Entry[] = [];
    for (const category of state.categories) {
        const members = state.milestones.filter((m) => m.category === category.id);
        const countable = members.filter((m) => available.has(m.id));
        const done = countable.filter((m) => state.claims[m.id]).length;
        const heading: Entry = { kind: "heading", category, collapsed: collapsed.has(category.id), done, total: countable.length };
        if (countable.length === 0 && members.some((m) => m.needsGlobalButtons)) {
            out.push(heading);
            if (!heading.collapsed) {
                out.push({ kind: "unsupported", category });
            }
            continue;
        }
        const listed = members.filter((m) => available.has(m.id) || state.claims[m.id]);
        const shown = sort === "list"
            ? listed
            : [...listed.filter((m) => !state.claims[m.id]), ...listed.filter((m) => state.claims[m.id])];
        out.push(heading);
        if (!heading.collapsed) {
            for (const milestone of shown) {
                out.push({ kind: "card", milestone });
            }
        }
    }
    return out;
}

function MilestonesPage(props: { state: MilestonesPageState; actions: MilestonesPageActions }) {
    const { state, actions } = props;
    const { language, tab, sort } = state;
    const active = state.view === "milestones";
    const controller = useMilestonesController({ isActive: active });
    const data = controller.state.milestones;
    const loadError = controller.state.error;
    const metrics = useMemo(() => achievementUiMetrics(state.uiSize), [state.uiSize]);

    const [openFirst] = useState(() => pendingLandingKey("milestones") ?? undefined);
    const entries = useMemo(() => (data ? buildEntries(data, sort) : []), [data, sort]);
    const list = useSlidingWindow({
        items: entries,
        itemKey: entryKey,
        focusKeyFor: entryFocusKey,
        windowId: "milestones:list",
        heightScope: ["milestones:list", language, state.uiSize, state.globalButtonsOn, JSON.stringify(state.shortcutBindings)].join("|"),
        dynamicLoading: state.dynamicLoading,
        initialRows: state.dynamicInitialRows,
        rowStep: state.dynamicRowStep,
        prefetchDistance: state.dynamicPrefetchDistance,
        sentinelRootMarginPx: state.dynamicSentinelRootMargin,
        resetKey: sort,
        openFirst
    });

    const chains = useMemo(() => {
        const out = new Map<string, string[]>();
        let heading: string | null = null;
        entries.forEach((entry, index) => {
            if (entry.kind === "heading") {
                heading = entryFocusKey(entry);
                return;
            }
            const chain: string[] = [];
            const next = entries[index + 1];
            const previous = entries[index - 1];
            if (next && next.kind === "card") {
                chain.push(entryFocusKey(next));
            }
            if (previous && previous.kind === "card") {
                chain.push(entryFocusKey(previous));
            }
            if (heading) {
                chain.push(heading);
            }
            chain.push(...SORT_FALLBACK);
            out.set(entryFocusKey(entry), chain);
        });
        return out;
    }, [entries]);

    const pageReady = data !== null || loadError !== null;
    usePageLanding({
        view: "milestones",
        subject: null,
        tabPath: [tab],
        restoreTabPath: (tabs) => {
            const next = tabs[0] === "milestones" || tabs[0] === "quests" ? tabs[0] : null;
            if (next === null || next === tab) {
                return false;
            }
            actions.onChangeTab(next);
            return true;
        },
        defaultKey: "milestones:back",
        ready: pageReady,
        holds: (key) => entries.some((entry) => entryFocusKey(entry) === key),
        open: (key) => list.openAt(key),
        reveal: (key) => {
            if (!data || !key.startsWith("milestone:")) {
                return false;
            }
            const milestone = data.milestones.find((m) => `milestone:${m.id}` === key);
            if (!milestone || !data.collapsed.includes(milestone.category)) {
                return false;
            }
            controller.actions.toggleCategory(milestone.category);
            return true;
        }
    });

    if (!active) {
        return null;
    }

    const cardList: MilestoneCardList = {
        metrics,
        instruction: {
            language,
            fontSize: metrics.bodyFontSize,
            bindings: state.shortcutBindings,
            globalButtonsOn: state.globalButtonsOn,
            paddles: data?.paddles ?? []
        },
        countsLoaded: data?.countsLoaded ?? false
    };

    function openRanks() {
        if (!data) {
            return;
        }
        const { ranks, rank } = data;
        playOkSound();
        showManagedModal((close) => <RankTableModal language={language} ranks={ranks} current={rank} close={close} />);
    }

    function renderEntry(entry: Entry, slot: number) {
        if (entry.kind === "heading") {
            const label = `${t(language, CATEGORY_LABELS[entry.category.id] ?? entry.category.id)} · ${entry.done} / ${entry.total}`;
            return (
                <SectionHeaderRow key={entryKey(entry)} first={slot === 0}>
                    <CollapsibleTitle
                        label={label}
                        collapsed={entry.collapsed}
                        preserveCase={state.headerStyle === "typed"}
                        focusKey={entryFocusKey(entry)}
                        focusFallback={SORT_FALLBACK}
                        onToggle={() => controller.actions.toggleCategory(entry.category.id)}
                        onGamepadFocus={() => list.onItemFocus(slot)}
                        onGamepadDirection={list.guardTopRow(slot)}
                    />
                </SectionHeaderRow>
            );
        }
        if (entry.kind === "unsupported") {
            return (
                <FocusableItem
                    key={entryKey(entry)}
                    focusKey="milestones:gb:unsupported"
                    focusFallback={[`milestones:cat:${entry.category.id}`, ...SORT_FALLBACK]}
                    onGamepadFocus={() => list.onItemFocus(slot)}
                    onGamepadDirection={list.guardTopRow(slot)}
                    outerStyle={{ width: "100%", minWidth: 0 }}
                >
                    <div style={{ ...smallTextStyle(), fontSize: `${metrics.bodyFontSize}px`, opacity: 0.85, textAlign: "left" }}>
                        {t(language, "milestone_gb_unsupported")}
                    </div>
                </FocusableItem>
            );
        }
        const milestone = entry.milestone;
        const claim = data?.claims[milestone.id] ?? null;
        const category = data?.categories.find((c) => c.id === milestone.category);
        return (
            <MilestoneCard
                key={entryKey(entry)}
                milestone={milestone}
                icon={category?.icon ?? "flag"}
                progress={data?.progress[milestone.id] ?? 0}
                target={data?.targets[milestone.id] ?? 1}
                claimedAt={claim ? claim.at : null}
                isNew={controller.state.visitNewIds.includes(milestone.id)}
                list={cardList}
                focusFallback={chains.get(entryFocusKey(entry))}
                onGamepadFocus={() => list.onItemFocus(slot)}
                onGamepadDirection={list.guardTopRow(slot)}
            />
        );
    }

    const combo = data?.combo;
    let comboLine: string | null = null;
    if (combo) {
        comboLine = combo.activeToday
            ? t(language, "{{count}}-day Combo · +{{xp}} XP earned today", { count: combo.length, xp: combo.bonusToday })
            : combo.alive
                ? t(language, "{{count}}-day Combo · unlock an achievement today for +{{xp}} XP", { count: combo.length, xp: combo.bonusToday })
                : t(language, "Unlock an achievement to start a Combo");
    }

    const header = data ? (
        <FocusableItem
            focusKey="milestones:header"
            outerStyle={{ width: "100%", minWidth: 0 }}
            onClick={openRanks}
            actionDescriptionMap={{ [BUTTON_OK]: t(language, "View Ranks") }}
            bottomSeparator="none"
        >
            <div style={{ display: "flex", alignItems: "center", gap: "12px", width: "100%", minWidth: 0 }}>
                <RankEmblem tier={data.ranks[data.rank].tier} step={data.ranks[data.rank].step} size={Math.round(metrics.iconSize * 1.1)} />
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "4px", textAlign: "left" }}>
                    <div style={{ fontSize: `${metrics.titleFontSize + 2}px`, fontWeight: 800 }}>{rankName(language, data.ranks[data.rank])}</div>
                    <div style={{ ...smallTextStyle(), fontSize: `${metrics.bodyFontSize}px`, opacity: 0.9 }}>
                        {data.nextRankXp === null
                            ? t(language, "{{xp}} XP", { xp: data.xp.toLocaleString() })
                            : t(language, "{{xp}} / {{next}} XP", { xp: data.xp.toLocaleString(), next: data.nextRankXp.toLocaleString() })}
                    </div>
                    <ProgressBar
                        fraction={data.nextRankXp === null ? 1 : (data.xp - data.rankXp) / Math.max(1, data.nextRankXp - data.rankXp)}
                    />
                </div>
            </div>
        </FocusableItem>
    ) : null;

    function renderSwitch(key: string, labelKey: string, on: boolean, onChange: (next: boolean) => void | Promise<void>) {
        return (
            <FocusTarget focusKey={`milestones:toggle:${key}`} style={{ flex: 1, minWidth: 0 }}>
                <DialogButton
                    style={{ width: "100%", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", padding: "6px 10px" }}
                    onClick={() => void onChange(!on)}
                >
                    <span style={{ fontSize: `${metrics.bodyFontSize}px`, fontWeight: 700 }}>{t(language, labelKey)}</span>
                    <span style={{ fontSize: `${metrics.pointsFontSize}px`, fontWeight: 800, color: on ? "#22c55e" : undefined, opacity: on ? 1 : 0.6 }}>
                        {t(language, on ? "On" : "Off")}
                    </span>
                </DialogButton>
            </FocusTarget>
        );
    }

    const controls = (
        <Focusable
            flow-children="grid"
            style={{ width: "100%", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", margin: "0 0 4px 0" }}
        >
            {renderSwitch("notifyMilestoneEnabled", "Notifications", state.notifyEnabled, actions.onToggleNotify)}
            {renderSwitch("notifyMilestoneToast", "Toasts", state.notifyToast, actions.onToggleToast)}
            {TABS.map((entry) => (
                <SubTabButton
                    key={entry.value}
                    label={t(language, entry.labelKey)}
                    active={tab === entry.value}
                    onClick={() => actions.onChangeTab(entry.value)}
                    focusKey={entry.focusKey}
                />
            ))}
        </Focusable>
    );

    const milestonesBody = (
        <PanelSection>
            <style>{SORT_ROW_STYLE}</style>
            <LabeledRow
                focusKey="milestones:sort"
                bottomSeparator="none"
                label={t(language, "Sort")}
                value={sort === "list" ? t(language, "List") : t(language, "Up Next")}
                onClick={() => actions.onChangeSort(sort === "list" ? "upNext" : "list")}
            />
            <SlidingWindowRows list={list}>
                {list.mountedItems.map((entry, index) => renderEntry(entry, list.start + index))}
            </SlidingWindowRows>
        </PanelSection>
    );

    const questsBody = data ? (
        <PanelSection>
            <PanelSectionRow>
                <div style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%", minWidth: 0 }}>
                    {(["daily", "weekly"] as const).map((period) => {
                        const quest = data[period];
                        if (!quest) {
                            return null;
                        }
                        return (
                            <QuestCard
                                key={period}
                                language={language}
                                period={period}
                                quest={quest}
                                metrics={metrics}
                                countsLoaded={data.countsLoaded}
                                rerolling={controller.state.rerolling === period}
                                onReroll={() => void controller.actions.reroll(period)}
                            />
                        );
                    })}
                </div>
            </PanelSectionRow>
        </PanelSection>
    ) : null;

    let notice: string | null = null;
    if (loadError === "account") {
        notice = t(language, "Credentials are missing. Set them up under Options.");
    }
    else if (loadError !== null) {
        notice = t(language, "Milestones couldn't be loaded.");
    }

    return (
        <Focusable flow-children="column">
            <PanelSection>
                <PageNavStrip
                    title={t(language, "Milestones")}
                    buttonSpacing={state.buttonSpacing}
                    onHome={actions.onHome}
                    help={<PageHelpButton focusKey="milestones:guide" onClick={() => void openExternalUrl(GUIDE_URL)} />}
                />
                <BackButton
                    label={t(language, "← Back")}
                    focusKey="milestones:back"
                    navAutoFocus
                    buttonSpacing={state.buttonSpacing}
                    onClick={actions.onBack}
                />
                {notice !== null && (
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>{notice}</div>
                    </PanelSectionRow>
                )}
                {header && <PanelSectionRow>{header}</PanelSectionRow>}
                {comboLine !== null && (
                    <PanelSectionRow>
                        <div style={{ ...smallTextStyle(), fontSize: `${metrics.bodyFontSize}px`, opacity: 0.95, fontWeight: 700, padding: "4px 0" }}>
                            {comboLine}
                        </div>
                    </PanelSectionRow>
                )}
                {data && <PanelSectionRow>{controls}</PanelSectionRow>}
            </PanelSection>
            {data && (
                <Focusable key={`milestones:tab:${tab}`}>
                    {tab === "milestones" ? milestonesBody : questsBody}
                </Focusable>
            )}
        </Focusable>
    );
}

export default MilestonesPage;
