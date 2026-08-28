import { DialogButton, PanelSection, PanelSectionRow } from "@decky/ui";
import React, { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BackButton } from "../components/ui/BackButton";
import { ButtonHints } from "../components/ui/ButtonHints";
import { FocusClaim } from "../components/ui/FocusClaim";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { SectionTitle } from "../components/ui/SectionTitle";
import { FocusableItem } from "../components/ui/FocusableItem";
import { LabeledRow } from "../components/ui/LabeledRow";
import { ToggleRow } from "../components/ui/ToggleRow";
import { ReorderStrip } from "../components/ui/ReorderStrip";
import { InfoText } from "../components/ui/InfoText";
import { ErrorText } from "../components/ui/ErrorText";
import { CollapseChevron } from "../components/ui/CollapseChevron";
import { ExternalLink } from "../components/ui/ExternalLink";
import { t, type LanguageCode } from "../locales";
import type {
    ButtonSpacing,
    ControllerGlyphStyle,
    DolphinMapperMode,
    DolphinMapping,
    DolphinSystemFilter,
    OkResult,
    ReorderDirection,
    ViewKey
} from "../types";
import { parseNoteTag } from "../utils/achievements";
import {
    dolphinMapperModeLabel,
    dolphinSystemFilterLabel,
    groupMappingsByTag,
    mappingSummary,
    nextDolphinMapperMode,
    nextDolphinSystemFilter
} from "../utils/dolphin";
import {
    BUTTON_BUMPER_RIGHT,
    BUTTON_DIR_DOWN,
    BUTTON_DIR_UP,
    BUTTON_OPTIONS,
    BUTTON_SECONDARY
} from "../utils/gamepadButtons";
import { playOkSound } from "../utils/navSound";
import { regularButtonSpacingStyle, bodyTextStyle } from "../utils/style";
import { achievementGreen } from "../utils/style";
import { textSize } from "../utils/scale";
import { useFocusClaim } from "../hooks/useFocusClaim";
import { useDolphinMapper } from "../components/mapping/DolphinMapperContext";
import { DolphinMappingModal } from "../components/mapping/DolphinMappingModal";
import { markNextValidationSkipped } from "../api";
import { showManagedModal } from "../utils/modalRegistry";

type DeleteFocusPlan =
    | { kind: "none" }
    | { kind: "claim"; slotIndex: number }
    | { kind: "back" };

const BACK_BUTTON_SCROLL_MARGIN_PX = 24;

const NO_CLAIM_SLOT = -1;

const APPLY_ERROR_SETTLE_MS = 250;

const BT_PASSTHROUGH_GUIDE_URL = "https://retrodeck.readthedocs.io/en/latest/wiki_emulator_guides/dolphin/dolphin-wii-remote/";

const MAX_CONTROLLER_SLOTS = 4;

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function GamepadIcon() {
    return (
        <svg
            viewBox="0 0 640 512"
            width="20"
            height="16"
            xmlns="http://www.w3.org/2000/svg"
            focusable="false"
        >
            <path
                fill="currentColor"
                d="M192 64C86 64 0 150 0 256S86 448 192 448l256 0c106 0 192-86 192-192s-86-192-192-192L192 64zM496 168a40 40 0 1 1 0 80 40 40 0 1 1 0-80zM392 304a40 40 0 1 1 80 0 40 40 0 1 1 -80 0zM168 200c0-13.3 10.7-24 24-24s24 10.7 24 24l0 32 32 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-32 0 0 32c0 13.3-10.7 24-24 24s-24-10.7-24-24l0-32-32 0c-13.3 0-24-10.7-24-24s10.7-24 24-24l32 0 0-32z"
            />
        </svg>
    );
}

type DolphinMapperPageProps = {
    view: ViewKey;
    language: LanguageCode;
    focusScopeResetToken: number;
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

function DolphinMapperPage(props: DolphinMapperPageProps) {
    const {
        view,
        language,
        focusScopeResetToken,
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
        collapsedTags,
        toggleCollapsedTag,
        deckControllerStatus,
        setDeckDisabled,
        reorderTargetId,
        onReorderSwap,
        onReorderMove,
        saveMapping,
        applyMapping,
        deleteMapping
    } = useDolphinMapper();

    const openMappingModal = (existing: DolphinMapping | null) => {
        markNextValidationSkipped();
        showManagedModal((close) => (
            <DolphinMappingModal
                existing={existing}
                language={language}
                saveMapping={saveMapping}
                close={close}
            />
        ));
    };

    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [applyBlockedId, setApplyBlockedId] = useState<string | null>(null);
    const [passthroughBlocked, setPassthroughBlocked] = useState(false);
    const [realHardwareBlocked, setRealHardwareBlocked] = useState(false);
    const rowClaim = useFocusClaim();
    const [backClaimToken, setBackClaimToken] = useState(0);
    const applyErrorTimeoutRef = useRef<number | null>(null);
    useEffect(() => {
        return () => {
            if (applyErrorTimeoutRef.current !== null) {
                window.clearTimeout(applyErrorTimeoutRef.current);
            }
        };
    }, []);

    const collapsedSet = useMemo(() => new Set(collapsedTags), [collapsedTags]);

    if (view !== "dolphinMapper") {
        return null;
    }

    const belowDisabled = dolphinBluetoothPassthrough;
    const mode = mouseKeyboardMode ? dolphinMapperMode : "map";
    const reordering = mode === "reorder";

    const visibleMappings = dolphinSystemFilter === "all"
        ? mappings
        : mappings.filter((mapping) => mapping.system === dolphinSystemFilter);

    const groups = groupMappingsByTag(visibleMappings, language);

    const visualOrder: DolphinMapping[] = [];
    for (const group of groups) {
        if (collapsedSet.has(group.key)) {
            continue;
        }
        for (const mapping of group.mappings) {
            visualOrder.push(mapping);
        }
    }

    const slotIndexById = new Map<string, number>();
    visualOrder.forEach((mapping, index) => {
        slotIndexById.set(mapping.id, index);
    });


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

    function deleteFocusPlan(mappingId: string): DeleteFocusPlan {
        const removedIndex = visualOrder.findIndex((mapping) => mapping.id === mappingId);
        const group = groups.find((entry) => entry.mappings.some((mapping) => mapping.id === mappingId));
        if (group === undefined || removedIndex < 0) {
            return { kind: "none" };
        }
        if (group.mappings.length <= 1) {
            return { kind: "back" };
        }
        if (group.mappings[group.mappings.length - 1]?.id !== mappingId) {
            return { kind: "none" };
        }
        return { kind: "claim", slotIndex: removedIndex - 1 };
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
        const plan = deleteFocusPlan(mappingId);
        const result = await deleteMapping(mappingId);
        if (result && !result.ok) {
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

    function handleCardReorderNudge(direction: ReorderDirection) {
        const group = groups.find((entry) => entry.mappings.some((mapping) => mapping.id === reorderTargetId));
        onReorderMove(direction, group ? group.mappings.map((mapping) => mapping.id) : null);
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

    async function handlePassthroughChange(next: boolean) {
        setPassthroughBlocked(false);
        const result = await onBluetoothPassthroughChange(next);
        if (result && result.error === "dolphin_running") {
            setPassthroughBlocked(true);
        }
    }

    async function handleContinuousScanningChange(next: boolean) {
        setRealHardwareBlocked(false);
        const result = await onContinuousScanningChange(next);
        if (result && result.error === "dolphin_running") {
            setRealHardwareBlocked(true);
        }
    }

    async function handleBalanceBoardChange(next: boolean) {
        setRealHardwareBlocked(false);
        const result = await onBalanceBoardChange(next);
        if (result && result.error === "dolphin_running") {
            setRealHardwareBlocked(true);
        }
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
    const cardReorderNudgeRef = useRef(handleCardReorderNudge);
    cardReorderNudgeRef.current = handleCardReorderNudge;

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
        onCardReorderNudge: gamepadReorderAvailable
            ? (direction: ReorderDirection) => {
                cardReorderNudgeRef.current(direction);
            }
            : undefined
    }), [language, belowDisabled, buttonSpacing, gamepadCardActions, gamepadReorderAvailable]);

    function renderCard(mapping: DolphinMapping, reactKey: string | number, slotIndex: number) {
        const card = (
            <MappingCard
                key={reactKey}
                mapping={mapping}
                isReorderTarget={(reordering || gamepadReorderAvailable) && reorderTargetId === mapping.id}
                isPendingDelete={pendingDeleteId === mapping.id}
                applyBlocked={applyBlockedId === mapping.id}
                list={cardList}
            />
        );

        const claim = rowClaim.claim;
        if (!claim || claim.slotIndex !== slotIndex) {
            return card;
        }
        return (
            <FocusClaim
                key={reactKey}
                token={claim.token}
                armed={claim.armed}
                onSpent={rowClaim.spend}
            >
                {card}
            </FocusClaim>
        );
    }

    return (
        <PanelSection key={`dolphinMapper:view:${focusScopeResetToken}`}>
            <PageNavStrip
                title={t(language, "Dolphin Mapper")}
                buttonSpacing={buttonSpacing}
                onHome={onHome}
            />

            <BackButton
                key={`back:${backClaimToken}`}
                label={t(language, "Back")}
                focusKey="dolphinMapper:back"
                navAutoFocus
                buttonSpacing={buttonSpacing}
                onClick={onBack}
                scrollMarginTop={BACK_BUTTON_SCROLL_MARGIN_PX}
            />

            <PanelSectionRow>
                <InfoText>{t(language, "help_dolphin_controller_order")}</InfoText>
            </PanelSectionRow>

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
                                    help={t(language, "help_deck_controller_disable")}
                                />
                            </PanelSectionRow>
                            <PanelSectionRow>
                                <ErrorText>{t(language, "warn_deck_controller_crash")}</ErrorText>
                            </PanelSectionRow>
                        </>
                    )}

                    {
}
                    <PanelSectionRow>
                        <ToggleRow
                            label={t(language, "Bluetooth Passthrough")}
                            value={dolphinBluetoothPassthrough}
                            onChange={handlePassthroughChange}
                            outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                            help={t(language, "help_dolphin_passthrough")}
                        />
                    </PanelSectionRow>
                    {passthroughBlocked && (
                        <PanelSectionRow>
                            <ErrorText>{t(language, "Close Dolphin to change Bluetooth passthrough.")}</ErrorText>
                        </PanelSectionRow>
                    )}
                    <PanelSectionRow>
                        <ExternalLink block url={BT_PASSTHROUGH_GUIDE_URL}>
                            {t(language, "Bluetooth passthrough setup guide")}
                        </ExternalLink>
                    </PanelSectionRow>

                    <PanelSectionRow>
                        <ToggleRow
                            label={t(language, "Continuous Scanning")}
                            value={dolphinContinuousScanning}
                            onChange={handleContinuousScanningChange}
                            outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                            help={t(language, "help_dolphin_continuous_scanning")}
                        />
                    </PanelSectionRow>
                    <PanelSectionRow>
                        <ToggleRow
                            label={t(language, "Balance Board")}
                            value={dolphinBalanceBoard}
                            onChange={handleBalanceBoardChange}
                            outerStyle={regularButtonSpacingStyle(buttonSpacing)}
                            help={t(language, "help_dolphin_balance_board")}
                        />
                    </PanelSectionRow>
                    {realHardwareBlocked && (
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

            {
}
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

            {
}
            {loaded && mappings.length > 0 && visibleMappings.length === 0 && !reordering && (
                <PanelSectionRow>
                    <InfoText>{t(language, "No mappings for this filter.")}</InfoText>
                </PanelSectionRow>
            )}

            {
}
            {reordering
                ? mappings.map((mapping, index) => renderCard(mapping, index, NO_CLAIM_SLOT))
                : groups.map((group) => {
                    const collapsed = collapsedSet.has(group.key);
                    return (
                        <div key={group.key}>
                            <SectionTitle label={group.header} dimmed={belowDisabled} />
                            <PanelSectionRow>
                                <div
                                    data-focus-key={`dmapgroup:${group.key}`}
                                    style={{ display: "flex", width: "100%", marginTop: "4px" }}
                                >
                                    <DialogButton
                                        onClick={() => toggleGroupCollapsed(group.key)}
                                        disabled={belowDisabled}
                                        style={{
                                            minWidth: 0,
                                            minHeight: 0,
                                            width: "100%",
                                            height: "16px",
                                            padding: "0",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            ...(belowDisabled ? { opacity: 0.6 } : {})
                                        }}
                                    >
                                        <CollapseChevron collapsed={collapsed} />
                                    </DialogButton>
                                </div>
                            </PanelSectionRow>
                            {!collapsed && group.mappings.map((mapping, index) => renderCard(
                                mapping,
                                index,
                                slotIndexById.get(mapping.id) ?? NO_CLAIM_SLOT
                            ))}
                        </div>
                    );
                })}
        </PanelSection>
    );
}

type MappingCardListProps = {
    language: LanguageCode;
    belowDisabled: boolean;
    buttonOuterStyle: CSSProperties;
    onCardClick: (mapping: DolphinMapping) => void;
    onCardBlur: (mappingId: string) => void;
    onCardDelete?: (mapping: DolphinMapping) => void;
    onCardEdit?: (mapping: DolphinMapping) => void;
    onCardReorderPick?: (mappingId: string) => void;
    onCardReorderNudge?: (direction: ReorderDirection) => void;
};

type MappingCardProps = {
    mapping: DolphinMapping;
    isReorderTarget: boolean;
    isPendingDelete: boolean;
    applyBlocked: boolean;
    list: MappingCardListProps;
};

const MappingCard = React.memo(function MappingCard(props: MappingCardProps) {
    const { mapping, isReorderTarget, isPendingDelete, applyBlocked, list } = props;
    const { language, belowDisabled } = list;

    const parsed = parseNoteTag(mapping.name);
    const title = parsed.body.trim() || t(language, "Untitled mapping");

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

        if (isReorderTarget && list.onCardReorderNudge) {
            if (button === BUTTON_DIR_UP) {
                list.onCardReorderNudge("up");
            }
            else if (button === BUTTON_DIR_DOWN) {
                list.onCardReorderNudge("down");
            }
        }
    }

    return (
        <FocusableItem
            focusKey={`dmapcard:${mapping.id}`}
            outerStyle={outerStyle}
            disabled={belowDisabled}
            onClick={handleClick}
            onBlur={handleBlur}
            onGamepadBlur={handleBlur}
            onButtonDown={handleButtonDown}
        >
            <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
                <div style={{ fontWeight: 600, wordBreak: "break-word", fontSize: `${textSize(15)}px` }}>{title}</div>
                <div style={{ ...bodyTextStyle(), opacity: 0.75 }}>{mappingSummary(mapping, language)}</div>
                {mapping.body.trim() && (
                    <div style={{ ...bodyTextStyle(), whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {mapping.body.trim()}
                    </div>
                )}
                {isPendingDelete && (
                    <div style={{ ...bodyTextStyle(), opacity: 1, color: "#ff6a6a" }}>{t(language, "Press again to delete")}</div>
                )}
                {applyBlocked && (
                    <div style={{ ...bodyTextStyle(), opacity: 1, color: "#ff6a6a" }}>{t(language, "Close Dolphin to apply this mapping.")}</div>
                )}
                {
}
                <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", gap: "4px", marginTop: "4px" }}>
                    {Array.from({ length: MAX_CONTROLLER_SLOTS }, (_, slot) => (
                        <span
                            key={slot}
                            style={{ display: "inline-flex", opacity: slot < mapping.players.length ? 1 : 0.25 }}
                        >
                            <GamepadIcon />
                        </span>
                    ))}
                </div>
            </div>
        </FocusableItem>
    );
});

export default DolphinMapperPage;
