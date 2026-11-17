import { Focusable, PanelSectionRow } from "@decky/ui";
import { PanelSection } from "../components/ui/PanelSection";
import React, { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BackButton } from "../components/ui/BackButton";
import { ButtonHints } from "../components/ui/ButtonHints";
import { FocusClaim } from "../components/ui/FocusClaim";
import { PageHelpButton, PageNavStrip } from "../components/ui/PageNavStrip";
import { SectionTitle } from "../components/ui/SectionTitle";
import { FocusableItem } from "../components/ui/FocusableItem";
import { LabeledRow } from "../components/ui/LabeledRow";
import { ToggleRow } from "../components/ui/ToggleRow";
import { ReorderStrip } from "../components/ui/ReorderStrip";
import { InfoText } from "../components/ui/InfoText";
import { ErrorText } from "../components/ui/ErrorText";
import { CollapseChevron } from "../components/ui/CollapseChevron";
import { CollapseToggleButton } from "../components/ui/CollapseToggleButton";
import { ExternalLink } from "../components/ui/ExternalLink";
import { FocusTarget } from "../components/ui/FocusTarget";
import { SlidingWindowRows } from "../components/ui/SlidingWindowRows";
import { t, type LanguageCode } from "../locales";
import type {
    ButtonSpacing,
    ControllerGlyphStyle,
    DolphinMapperMode,
    DolphinMapping,
    DolphinMappingInput,
    DolphinSystemFilter,
    OkResult,
    ViewKey
} from "../types";
import { parseNoteTag } from "../utils/achievements";
import { orderedTagsByRecency } from "../utils/tags";
import {
    dolphinDeleteFocusPlan,
    dolphinMapperModeLabel,
    dolphinSystemFilterLabel,
    groupMappingsByTag,
    nextDolphinMapperMode,
    nextDolphinSystemFilter,
    type MappingGroup
} from "../utils/dolphin";
import {
    BUTTON_BUMPER_RIGHT,
    BUTTON_OPTIONS,
    BUTTON_SECONDARY
} from "../utils/gamepadButtons";
import { playOkSound, toastAfterPress } from "../utils/navSound";
import { regularButtonSpacingStyle, bodyTextStyle } from "../utils/style";
import { achievementGreen } from "../utils/style";
import { textSize } from "../utils/scale";
import { useFocusClaim } from "../hooks/useFocusClaim";
import { useSlidingWindow } from "../hooks/useSlidingWindow";
import { useDolphinMapper } from "../components/mapping/DolphinMapperContext";
import { DolphinMappingModal } from "../components/mapping/DolphinMappingModal";
import { MappingCardBody } from "../components/mapping/MappingCardBody";
import { showManagedModal } from "../utils/modalRegistry";
import { expectHeirClaim, settleHeirClaim } from "../focusClaims";
import { overrideRecord, pendingLandingKey, topEntryId, usePageLanding } from "../focusRecords";
import { skipWhileHidden } from "../components/panel/skipWhileHidden";
import { ControllerOrderSection, PAD_ORDER_FOCUS_KEY } from "../components/mapping/ControllerOrderSection";
import { useControllerOrder } from "../hooks/useControllerOrder";

const BACK_BUTTON_SCROLL_MARGIN_PX = 24;

const NO_CLAIM_SLOT = -1;

const CARD_FOCUS_PREFIX = "dmapcard:";

const GROUP_FALLBACK = ["dolphinMapper:filter"];

const APPLY_ERROR_SETTLE_MS = 250;

const ROWS_INITIAL = 24;
const ROWS_STEP = 12;
const PREFETCH_DISTANCE = 4;
const SENTINEL_ROOT_MARGIN_PX = 600;
const NAV_ENTER_MAINTAIN_Y = 3;

const BT_PASSTHROUGH_GUIDE_URL = "https://retrodeck.readthedocs.io/en/latest/wiki_emulator_guides/dolphin/dolphin-wii-remote/";

type DolphinMapperPageProps = {
    view: ViewKey;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    mouseKeyboardMode: boolean;
    controllerGlyphStyle: ControllerGlyphStyle;

    dolphinMapperMode: DolphinMapperMode;
    onModeChange: (next: DolphinMapperMode) => void | Promise<void>;

    dolphinSystemFilter: DolphinSystemFilter;
    onSystemFilterChange: (next: DolphinSystemFilter) => void;

    dolphinBluetoothPassthrough: boolean;
    dolphinContinuousScanning: boolean;
    dolphinBalanceBoard: boolean;
    onBluetoothPassthroughChange: (value: boolean) => void | Promise<OkResult | void>;
    onContinuousScanningChange: (value: boolean) => void | Promise<OkResult | void>;
    onBalanceBoardChange: (value: boolean) => void | Promise<OkResult | void>;

    advancedCollapsed: boolean;
    onAdvancedCollapsedChange: (collapsed: boolean) => void;

    onBack: () => void | Promise<void>;
    onHome: () => void | Promise<void>;
};

type ListRow =
    | { kind: "group"; group: MappingGroup }
    | { kind: "card"; slot: number; mapping: DolphinMapping; groupKey: string };

function rowKey(row: ListRow): string {
    return row.kind === "group" ? `group:${row.group.key}` : `card:${row.mapping.id}`;
}

function rowFocusKey(row: ListRow): string {
    return row.kind === "group" ? `dolphinMapper:group:${row.group.key}` : `${CARD_FOCUS_PREFIX}${row.mapping.id}`;
}

function DolphinMapperPage(props: DolphinMapperPageProps) {
    const {
        view,
        language,
        buttonSpacing,
        mouseKeyboardMode,
        controllerGlyphStyle,
        dolphinMapperMode,
        onModeChange,
        dolphinSystemFilter,
        onSystemFilterChange,
        dolphinBluetoothPassthrough,
        onBluetoothPassthroughChange,
        dolphinContinuousScanning,
        onContinuousScanningChange,
        dolphinBalanceBoard,
        onBalanceBoardChange,
        advancedCollapsed,
        onAdvancedCollapsedChange,
        onBack,
        onHome,
    } = props;

    const {
        mappings,
        loaded,
        loadFailed,
        collapsedTags,
        toggleCollapsedTag,
        deckControllerStatus,
        setDeckDisabled,
        reorderTargetId,
        onReorderSwap,
        onReorderMove,
        onReorderToward,
        saveMapping,
        applyMapping,
        deleteMapping,
        padOrderCollapsed,
        savePadOrderCollapsed
    } = useDolphinMapper();

    const padOrder = useControllerOrder(view === "dolphinMapper" && !padOrderCollapsed);

    const allTags = useMemo(
        () => orderedTagsByRecency(mappings.map((mapping) => ({
            tag: parseNoteTag(mapping.name).tag,
            at: mapping.updatedAt
        }))),
        [mappings]
    );

    const saveMappingAndAim = async (input: DolphinMappingInput, entryId: number | null) => {
        const result = await saveMapping(input);
        if (result?.ok && result.mapping && !input.id) {
            overrideRecord(entryId, { focusKey: `${CARD_FOCUS_PREFIX}${result.mapping.id}`, fallbacks: ["dolphinMapper:add"] });
        }
        return result;
    };

    const openMappingModal = (existing: DolphinMapping | null) => {
        const entryId = topEntryId();
        showManagedModal((close) => (
            <DolphinMappingModal
                existing={existing}
                allTags={allTags}
                language={language}
                saveMapping={(input) => saveMappingAndAim(input, entryId)}
                close={close}
            />
        ));
    };

    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [applyBlockedId, setApplyBlockedId] = useState<string | null>(null);
    const [passthroughBlocked, setPassthroughBlocked] = useState(false);
    const [realHardwareBlocked, setRealHardwareBlocked] = useState<"scanning" | "board" | null>(null);
    const rowClaim = useFocusClaim();
    const [backClaimToken, setBackClaimToken] = useState(0);
    const backClaimed = backClaimToken > 0;
    const applyErrorTimeoutRef = useRef<number | null>(null);
    useEffect(() => {
        return () => {
            if (applyErrorTimeoutRef.current !== null) {
                window.clearTimeout(applyErrorTimeoutRef.current);
            }
        };
    }, []);

    const collapsedSet = useMemo(() => new Set(collapsedTags), [collapsedTags]);

    const visibleMappings = useMemo(
        () => (dolphinSystemFilter === "all"
            ? mappings
            : mappings.filter((mapping) => mapping.system === dolphinSystemFilter)),
        [mappings, dolphinSystemFilter]
    );

    const groups = useMemo(
        () => groupMappingsByTag(visibleMappings, language),
        [visibleMappings, language]
    );

    const visualOrder = useMemo(() => {
        const painted: DolphinMapping[] = [];
        for (const group of groups) {
            if (collapsedSet.has(group.key)) {
                continue;
            }
            for (const mapping of group.mappings) {
                painted.push(mapping);
            }
        }
        return painted;
    }, [groups, collapsedSet]);

    const mode = mouseKeyboardMode ? dolphinMapperMode : "map";
    const reordering = mode === "reorder";

    const rows = useMemo(() => {
        const built: ListRow[] = [];
        if (reordering) {
            mappings.forEach((mapping, slot) => {
                built.push({ kind: "card", slot, mapping, groupKey: "" });
            });
            return built;
        }
        let slot = 0;
        for (const group of groups) {
            built.push({ kind: "group", group });
            if (collapsedSet.has(group.key)) {
                continue;
            }
            for (const mapping of group.mappings) {
                built.push({ kind: "card", slot, mapping, groupKey: group.key });
                slot += 1;
            }
        }
        return built;
    }, [reordering, mappings, groups, collapsedSet]);

    const list = useSlidingWindow({
        items: rows,
        itemKey: rowKey,
        focusKeyFor: rowFocusKey,
        windowId: "dolphinMapper:list",
        heightScope: ["dolphinMapper:list", language, textSize(12), buttonSpacing].join("|"),
        dynamicLoading: true,
        initialRows: ROWS_INITIAL,
        rowStep: ROWS_STEP,
        prefetchDistance: PREFETCH_DISTANCE,
        sentinelRootMarginPx: SENTINEL_ROOT_MARGIN_PX,
        resetKey: reordering ? "flat" : dolphinSystemFilter,
        openFirst: pendingLandingKey("dolphinMapper") ?? undefined
    });

    usePageLanding({
        view: "dolphinMapper",
        active: view === "dolphinMapper",
        defaultKey: "dolphinMapper:back",
        ready: (loaded || loadFailed) && (padOrderCollapsed || padOrder.settled),
        holds: (key) => rows.some((row) => rowFocusKey(row) === key),
        open: (key) => list.openAt(key),
        reveal: (key) => {
            if (key.startsWith(`${PAD_ORDER_FOCUS_KEY}:`)) {
                if (!padOrderCollapsed) {
                    return false;
                }
                savePadOrderCollapsed(false);
                return true;
            }
            if (!key.startsWith(CARD_FOCUS_PREFIX)) {
                return false;
            }
            const mappingId = key.slice(CARD_FOCUS_PREFIX.length);
            const group = groups.find((entry) => entry.mappings.some((mapping) => mapping.id === mappingId));
            if (!group || !collapsedSet.has(group.key)) {
                return false;
            }
            toggleCollapsedTag(group.key);
            return true;
        }
    });

    const belowDisabled = dolphinBluetoothPassthrough;

    const gamepadCardActions = !mouseKeyboardMode && !belowDisabled;

    let largestTagGroup = 0;
    for (const group of groups) {
        if (group.mappings.length > largestTagGroup) {
            largestTagGroup = group.mappings.length;
        }
    }
    const gamepadReorderAvailable = gamepadCardActions
        && dolphinSystemFilter === "all"
        && largestTagGroup >= 2;

    function clearApplyBlocked() {
        if (applyErrorTimeoutRef.current !== null) {
            window.clearTimeout(applyErrorTimeoutRef.current);
            applyErrorTimeoutRef.current = null;
        }
        setApplyBlockedId(null);
    }

    async function handleCardClick(mapping: DolphinMapping) {
        clearApplyBlocked();
        if (belowDisabled) {
            return;
        }
        if (mode === "reorder") {
            onReorderSwap(mapping.id);
            return;
        }
        if (mode === "edit") {
            openMappingModal(mapping);
            return;
        }
        if (mode === "delete") {
            handleDeletePress(mapping);
            return;
        }
        const result = await applyMapping(mapping.id);
        if (result && !result.ok && result.error === "dolphin_running") {
            if (applyErrorTimeoutRef.current !== null) {
                window.clearTimeout(applyErrorTimeoutRef.current);
            }
            applyErrorTimeoutRef.current = window.setTimeout(() => {
                setApplyBlockedId(mapping.id);
                applyErrorTimeoutRef.current = null;
            }, APPLY_ERROR_SETTLE_MS);
        }
    }

    function handleDeletePress(mapping: DolphinMapping) {
        clearApplyBlocked();
        if (pendingDeleteId !== mapping.id) {
            setPendingDeleteId(mapping.id);
            return;
        }
        setPendingDeleteId(null);
        void commitDelete(mapping.id);
    }

    async function commitDelete(mappingId: string) {
        const plan = dolphinDeleteFocusPlan(groups, visualOrder, mappingId);
        if (plan.kind === "claim") {
            expectHeirClaim();
        }
        const result = await deleteMapping(mappingId);
        if (result && !result.ok) {
            settleHeirClaim();
            return;
        }
        if (plan.kind === "back") {
            setBackClaimToken((token) => token + 1);
            return;
        }
        if (plan.kind === "none") {
            return;
        }
        rowClaim.claimSlot(plan.slotIndex);
    }

    function handleCardReorderPick(mappingId: string) {
        onReorderSwap(mappingId, false);
    }

    function reorderGroupIds(): string[] | null {
        const group = groups.find((entry) => entry.mappings.some((mapping) => mapping.id === reorderTargetId));
        return group ? group.mappings.map((mapping) => mapping.id) : null;
    }

    function handleCardReorderFollow(landedId: string) {
        if (reorderTargetId === null) {
            return;
        }
        onReorderToward(landedId, reorderGroupIds());
    }

    function handleModeClick() {
        setPendingDeleteId(null);
        clearApplyBlocked();
        void onModeChange(nextDolphinMapperMode(mode, mappings.length));
    }

    function handleFilterClick() {
        clearApplyBlocked();
        onSystemFilterChange(nextDolphinSystemFilter(dolphinSystemFilter));
    }

    function toggleGroupCollapsed(key: string) {
        clearApplyBlocked();
        toggleCollapsedTag(key);
    }

    function clearPendingDeleteFor(mappingId: string) {
        setPendingDeleteId((cur) => (cur === mappingId ? null : cur));
    }

    function toastIfNotWritten(result: OkResult | void) {
        if (result && result.error === "write_failed") {
            toastAfterPress({
                title: t(language, "Dolphin Mapper"),
                body: t(language, "Dolphin Settings Not Saved")
            });
        }
    }

    async function handlePassthroughChange(next: boolean) {
        const result = await onBluetoothPassthroughChange(next);
        setPassthroughBlocked(Boolean(result && result.error === "dolphin_running"));
        toastIfNotWritten(result);
    }

    async function handleContinuousScanningChange(next: boolean) {
        const result = await onContinuousScanningChange(next);
        setRealHardwareBlocked(result && result.error === "dolphin_running" ? "scanning" : null);
        toastIfNotWritten(result);
    }

    async function handleBalanceBoardChange(next: boolean) {
        const result = await onBalanceBoardChange(next);
        setRealHardwareBlocked(result && result.error === "dolphin_running" ? "board" : null);
        toastIfNotWritten(result);
    }

    const cardClickRef = useRef(handleCardClick);
    cardClickRef.current = handleCardClick;
    const cardBlurRef = useRef(clearPendingDeleteFor);
    cardBlurRef.current = clearPendingDeleteFor;
    const cardDeleteRef = useRef(handleDeletePress);
    cardDeleteRef.current = handleDeletePress;
    const cardEditRef = useRef(openMappingModal);
    cardEditRef.current = openMappingModal;
    const cardReorderPickRef = useRef(handleCardReorderPick);
    cardReorderPickRef.current = handleCardReorderPick;
    const cardReorderFollowRef = useRef(handleCardReorderFollow);
    cardReorderFollowRef.current = handleCardReorderFollow;
    const windowFocusRef = useRef(list.onItemFocus);
    windowFocusRef.current = list.onItemFocus;

    const cardList = useMemo<MappingCardListProps>(() => ({
        language,
        belowDisabled,
        buttonOuterStyle: regularButtonSpacingStyle(buttonSpacing),
        onCardClick: (mapping) => {
            void cardClickRef.current(mapping);
        },
        onCardBlur: (mappingId) => {
            cardBlurRef.current(mappingId);
        },
        onCardFocus: (at) => {
            windowFocusRef.current(at);
        },
        onCardDelete: gamepadCardActions
            ? (mapping: DolphinMapping) => {
                cardDeleteRef.current(mapping);
            }
            : undefined,
        onCardEdit: gamepadCardActions
            ? (mapping: DolphinMapping) => {
                cardEditRef.current(mapping);
            }
            : undefined,
        onCardReorderPick: gamepadReorderAvailable
            ? (mappingId: string) => {
                cardReorderPickRef.current(mappingId);
            }
            : undefined,
        onCardReorderFollow: gamepadReorderAvailable
            ? (landedId: string) => {
                cardReorderFollowRef.current(landedId);
            }
            : undefined
    }), [language, belowDisabled, buttonSpacing, gamepadCardActions, gamepadReorderAvailable]);

    const claim = rowClaim.claim;
    const claimOvertaken = claim !== null && claim.armed
        && !list.mountedItems.some((row) => row.kind === "card" && !reordering && row.slot === claim.slotIndex);
    useEffect(function dropOvertakenClaim() {
        if (claimOvertaken) {
            rowClaim.spend();
        }
    }, [claimOvertaken, rowClaim.spend]);

    if (view !== "dolphinMapper") {
        return null;
    }

    function renderCard(row: Extract<ListRow, { kind: "card" }>, at: number, guardAt: number) {
        const reactKey = `slot:${row.slot}`;
        const card = (
            <MappingCard
                key={reactKey}
                mapping={row.mapping}
                groupKey={row.groupKey}
                windowIndex={at}
                isReorderTarget={(reordering || gamepadReorderAvailable) && reorderTargetId === row.mapping.id}
                isPendingDelete={pendingDeleteId === row.mapping.id}
                applyBlocked={applyBlockedId === row.mapping.id}
                onGamepadDirection={at === guardAt ? list.guardTopRow(list.start) : undefined}
                list={cardList}
            />
        );

        const slotIndex = reordering ? NO_CLAIM_SLOT : row.slot;
        if (!claim || claim.slotIndex !== slotIndex) {
            return card;
        }
        return (
            <FocusClaim
                key={reactKey}
                token={claim.token}
                armed={claim.armed && !claimOvertaken}
                onSpent={rowClaim.spend}
            >
                {card}
            </FocusClaim>
        );
    }

    const headersDead = belowDisabled || reorderTargetId !== null;
    let guardAt = list.start;
    if (headersDead && list.mountedItems.length > 0 && list.mountedItems[0].kind === "group") {
        guardAt += 1;
    }

    const page = (
        <PanelSection key="dolphinMapper:view">
            <PageNavStrip
                title={t(language, "Mapper")}
                buttonSpacing={buttonSpacing}
                onHome={onHome}
                help={<PageHelpButton focusKey="dolphinMapper:guide" guide="dolphin-mapper" />}
            />

            <BackButton
                key={`back:${backClaimToken}`}
                label={t(language, "Back")}
                focusKey="dolphinMapper:back"
                navAutoFocus
                reclaim={backClaimed}
                buttonSpacing={buttonSpacing}
                onClick={onBack}
                scrollMarginTop={BACK_BUTTON_SCROLL_MARGIN_PX}
            />

            <PanelSectionRow>
                <FocusableItem
                    focusKey={PAD_ORDER_FOCUS_KEY}
                    outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                    onClick={() => savePadOrderCollapsed(!padOrderCollapsed)}
                    bottomSeparator="standard"
                >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                        {t(language, "Reorder Controllers")}
                        <CollapseChevron collapsed={padOrderCollapsed} />
                    </div>
                </FocusableItem>
            </PanelSectionRow>

            {!padOrderCollapsed && (
                <ControllerOrderSection
                    language={language}
                    pads={padOrder.pads}
                    settled={padOrder.settled}
                    inGame={padOrder.inGame}
                    onMove={padOrder.move}
                    onPing={padOrder.ping}
                />
            )}

            <PanelSectionRow>
                <FocusableItem
                    focusKey="dolphinMapper:advanced"
                    outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                    onClick={() => onAdvancedCollapsedChange(!advancedCollapsed)}
                    bottomSeparator="standard"
                >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                        {t(language, "tab_advanced")}
                        <CollapseChevron collapsed={advancedCollapsed} />
                    </div>
                </FocusableItem>
            </PanelSectionRow>

            {!advancedCollapsed && (
                <>
                    {deckControllerStatus?.present && (
                        <>
                            <PanelSectionRow>
                                <ToggleRow
                                    label={t(language, "Disable Steam Deck Controller")}
                                    value={deckControllerStatus.disabled}
                                    onChange={(next) => { void setDeckDisabled(next); }}
                                    outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                                    focusKey="dolphinMapper:toggle:deckControllerDisabled"
                                    help={t(language, "help_deck_controller_disable")}
                                />
                            </PanelSectionRow>
                            <PanelSectionRow>
                                <ErrorText>{t(language, "warn_deck_controller_crash")}</ErrorText>
                            </PanelSectionRow>
                        </>
                    )}

                    <PanelSectionRow>
                        <ToggleRow
                            label={t(language, "Bluetooth Passthrough")}
                            value={dolphinBluetoothPassthrough}
                            onChange={handlePassthroughChange}
                            outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                            focusKey="dolphinMapper:toggle:dolphinBluetoothPassthrough"
                            help={t(language, "help_dolphin_passthrough")}
                        />
                    </PanelSectionRow>
                    {passthroughBlocked && (
                        <PanelSectionRow>
                            <ErrorText>{t(language, "Close Dolphin to change Bluetooth passthrough.")}</ErrorText>
                        </PanelSectionRow>
                    )}
                    <PanelSectionRow>
                        <FocusTarget focusKey="dolphinMapper:passthrough-guide">
                            <ExternalLink block url={BT_PASSTHROUGH_GUIDE_URL}>
                                {t(language, "Bluetooth passthrough setup guide")}
                            </ExternalLink>
                        </FocusTarget>
                    </PanelSectionRow>

                    <PanelSectionRow>
                        <ToggleRow
                            label={t(language, "Continuous Scanning")}
                            value={dolphinContinuousScanning}
                            onChange={handleContinuousScanningChange}
                            outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                            focusKey="dolphinMapper:toggle:dolphinContinuousScanning"
                            help={t(language, "help_dolphin_continuous_scanning")}
                        />
                    </PanelSectionRow>
                    {realHardwareBlocked === "scanning" && (
                        <PanelSectionRow>
                            <ErrorText>{t(language, "Close Dolphin to change this setting.")}</ErrorText>
                        </PanelSectionRow>
                    )}
                    <PanelSectionRow>
                        <ToggleRow
                            label={t(language, "Balance Board")}
                            value={dolphinBalanceBoard}
                            onChange={handleBalanceBoardChange}
                            outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                            focusKey="dolphinMapper:toggle:dolphinBalanceBoard"
                            help={t(language, "help_dolphin_balance_board")}
                        />
                    </PanelSectionRow>
                    {realHardwareBlocked === "board" && (
                        <PanelSectionRow>
                            <ErrorText>{t(language, "Close Dolphin to change this setting.")}</ErrorText>
                        </PanelSectionRow>
                    )}
                </>
            )}

            <PanelSectionRow>
                <FocusableItem
                    focusKey="dolphinMapper:add"
                    outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                    disabled={belowDisabled}
                    onClick={() => openMappingModal(null)}
                >
                    {t(language, "Add Mapping")}
                </FocusableItem>
            </PanelSectionRow>

            {mouseKeyboardMode && mappings.length > 0 && (
                <LabeledRow
                    focusKey="dolphinMapper:mode"
                    label={t(language, "Click")}
                    value={dolphinMapperModeLabel(mode, language)}
                    disabled={belowDisabled}
                    onClick={handleModeClick}
                    outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                />
            )}

            {mappings.length > 0 && (
                <LabeledRow
                    focusKey="dolphinMapper:filter"
                    label={t(language, "Filter")}
                    value={dolphinSystemFilterLabel(dolphinSystemFilter, language)}
                    disabled={belowDisabled || reordering}
                    onClick={handleFilterClick}
                    outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                />
            )}

            {gamepadCardActions && mappings.length > 0 && (
                <PanelSectionRow>
                    <ButtonHints
                        style={controllerGlyphStyle}
                        hints={[
                            { button: "a", label: t(language, "Map") },
                            { button: "x", label: t(language, "Delete") },
                            { button: "y", label: t(language, "Edit") },
                            ...(gamepadReorderAvailable
                                ? [{ button: "r1" as const, label: t(language, "Reorder") }]
                                : [])
                        ]}
                    />
                </PanelSectionRow>
            )}

            {reordering && !belowDisabled && (
                <div style={{ marginTop: "8px", marginBottom: "8px" }}>
                    <ReorderStrip
                        targetId={reorderTargetId}
                        onMove={onReorderMove}
                        focusKeyPrefix="dolphinMapper"
                    />
                    <PanelSectionRow>
                        <InfoText>{t(language, "reorder_help_dolphin")}</InfoText>
                    </PanelSectionRow>
                </div>
            )}

            {loaded && mappings.length === 0 && (
                <PanelSectionRow>
                    <InfoText>{t(language, "No mappings yet. Add one to get started.")}</InfoText>
                </PanelSectionRow>
            )}

            {loaded && mappings.length > 0 && visibleMappings.length === 0 && !reordering && (
                <PanelSectionRow>
                    <InfoText>{t(language, "No mappings for this filter.")}</InfoText>
                </PanelSectionRow>
            )}

            <Focusable
                flow-children="column"
                resetNavOnEntry
                navEntryPreferPosition={NAV_ENTER_MAINTAIN_Y}
            >
                <SlidingWindowRows list={list}>
                    {list.mountedItems.map((row, index) => {
                        const at = list.start + index;
                        if (row.kind === "card") {
                            return renderCard(row, at, guardAt);
                        }
                        const { group } = row;
                        return (
                            <div key={rowKey(row)}>
                                <SectionTitle
                                    label={group.header}
                                    align="start"
                                    scaled={false}
                                    dimmed={belowDisabled}
                                    action={
                                        <CollapseToggleButton
                                            collapsed={collapsedSet.has(group.key)}
                                            focusKey={rowFocusKey(row)}
                                            focusFallback={GROUP_FALLBACK}
                                            disabled={headersDead}
                                            onToggle={() => toggleGroupCollapsed(group.key)}
                                            onGamepadFocus={() => list.onItemFocus(at)}
                                            onGamepadDirection={list.guardTopRow(at)}
                                        />
                                    }
                                />
                            </div>
                        );
                    })}
                </SlidingWindowRows>
            </Focusable>
        </PanelSection>
    );

    return page;
}

type MappingCardListProps = {
    language: LanguageCode;
    belowDisabled: boolean;
    buttonOuterStyle: CSSProperties;
    onCardClick: (mapping: DolphinMapping) => void;
    onCardBlur: (mappingId: string) => void;
    onCardFocus: (at: number) => void;
    onCardDelete?: (mapping: DolphinMapping) => void;
    onCardEdit?: (mapping: DolphinMapping) => void;
    onCardReorderPick?: (mappingId: string) => void;
    onCardReorderFollow?: (mappingId: string) => void;
};

type MappingCardProps = {
    mapping: DolphinMapping;
    groupKey: string;
    windowIndex: number;
    onGamepadDirection?: (evt: { detail?: { button?: number } }) => boolean | void;
    isReorderTarget: boolean;
    isPendingDelete: boolean;
    applyBlocked: boolean;
    list: MappingCardListProps;
};

const MappingCard = React.memo(function MappingCard(props: MappingCardProps) {
    const { mapping, groupKey, windowIndex, onGamepadDirection, isReorderTarget, isPendingDelete, applyBlocked, list } = props;
    const { language, belowDisabled } = list;

    const outerStyle: CSSProperties = {
        ...list.buttonOuterStyle,
        ...(isReorderTarget ? { outline: `2px solid ${achievementGreen}`, borderRadius: "6px" } : {})
    };

    function handleClick() {
        list.onCardClick(mapping);
    }

    function handleBlur() {
        list.onCardBlur(mapping.id);
    }

    function handleGamepadFocus() {
        list.onCardFocus(windowIndex);
        list.onCardReorderFollow?.(mapping.id);
    }

    function handleButtonDown(evt: { detail?: { button?: number } }) {
        const button = evt?.detail?.button;

        if (button === BUTTON_SECONDARY && list.onCardDelete) {
            playOkSound();
            list.onCardDelete(mapping);
            return;
        }

        if (button === BUTTON_OPTIONS && list.onCardEdit) {
            playOkSound();
            list.onCardEdit(mapping);
            return;
        }

        if (button === BUTTON_BUMPER_RIGHT && list.onCardReorderPick) {
            playOkSound();
            list.onCardReorderPick(mapping.id);
            return;
        }
    }

    return (
        <FocusableItem
            focusKey={`${CARD_FOCUS_PREFIX}${mapping.id}`}
            focusFallback={groupKey ? [`dolphinMapper:group:${groupKey}`, "dolphinMapper:filter"] : undefined}
            outerStyle={outerStyle}
            disabled={belowDisabled}
            onClick={handleClick}
            onBlur={handleBlur}
            onGamepadFocus={handleGamepadFocus}
            onGamepadBlur={handleBlur}
            onGamepadDirection={onGamepadDirection}
            onButtonDown={handleButtonDown}
        >
            <MappingCardBody mapping={mapping} language={language}>
                {isPendingDelete && (
                    <div style={{ ...bodyTextStyle(), opacity: 1, color: "#ff6a6a" }}>{t(language, "Press again to delete")}</div>
                )}
                {applyBlocked && (
                    <div style={{ ...bodyTextStyle(), opacity: 1, color: "#ff6a6a" }}>{t(language, "Close Dolphin to apply this mapping.")}</div>
                )}
            </MappingCardBody>
        </FocusableItem>
    );
});

export default skipWhileHidden(DolphinMapperPage, (props) => props.view === "dolphinMapper");
