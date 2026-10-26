import { Focusable, PanelSectionRow } from "@decky/ui";
import { PanelSection } from "../components/ui/PanelSection";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

import { BackButton } from "../components/ui/BackButton";
import { BottomFocusAnchor } from "../components/ui/BottomFocusAnchor";
import { ConfirmRow } from "../components/ui/ConfirmRow";
import { FocusClaim } from "../components/ui/FocusClaim";
import { FocusableItem } from "../components/ui/FocusableItem";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { LabeledRow } from "../components/ui/LabeledRow";
import { PageHelpButton, PageNavStrip } from "../components/ui/PageNavStrip";
import { SlidingWindowRows } from "../components/ui/SlidingWindowRows";
import { ToggleRow } from "../components/ui/ToggleRow";
import { rankName } from "../components/milestones/RankTableModal";
import { useDataTransfer } from "../components/dataTransfer/DataTransferContext";
import { useFocusClaim } from "../hooks/useFocusClaim";
import { useSlidingWindow } from "../hooks/useSlidingWindow";
import { DATA_NEARBY_FOCUS_PREFIX } from "../hooks/useDataTransferController";
import { dataTransferErrorKey } from "../utils/dataTransferErrors";
import { importResultLines } from "../utils/dataTransferLines";
import { nextDataKind } from "../utils/dataTransferChoices";
import { nearbyDeviceAddressLabel, nearbyDeviceName } from "../utils/nearbyDevices";
import { t, type LanguageCode } from "../locales";
import type {
    ButtonSpacing,
    DataDeviceRow,
    DataKind,
    DataMilestonesSummary,
    DataTransferStatus,
    RankTier,
    ViewKey
} from "../types";
import { textSize } from "../utils/scale";
import { bodyTextStyle, errorRed, regularButtonSpacingStyle } from "../utils/style";
import { pendingLandingKey, subLandingAhead, usePageLanding } from "../focusRecords";
import { expectHeirClaim } from "../focusClaims";

const BACK_BUTTON_SCROLL_MARGIN_PX = 24;

const DATA_FOCUS_KEY = "dataTransfer:data";
const MODE_FOCUS_KEY = "dataTransfer:toggle:mode";

const NEARBY_INITIAL_ROWS = 20;
const NEARBY_ROW_STEP = 20;
const NEARBY_SENTINEL_ROOT_MARGIN_PX = 600;

const NO_DATA_DEVICES: DataDeviceRow[] = [];

const RANK_TIERS: RankTier[] = ["tracker", "hunter", "expert", "master", "legend"];

function nearbyKey(row: DataDeviceRow): string {
    return DATA_NEARBY_FOCUS_PREFIX + row.id;
}

const KIND_LABELS: Record<DataKind, string> = {
    all: "All Data (Current Game)",
    tracked: "Tracked (Current Game)",
    notes: "Notes (Current Game)",
    guides: "Guides (Current Game)",
    events: "Events",
    milestones: "Milestones"
};

const GAME_KINDS: DataKind[] = ["all", "tracked", "notes", "guides"];

function kindLabel(kind: DataKind, language: LanguageCode): string {
    return t(language, KIND_LABELS[kind]);
}

function rowCount(row: DataDeviceRow, kind: DataKind): number | null {
    if (kind === "all") {
        const counts = [row.tracked, row.notes, row.guides];
        return counts.some((count) => count === null) ? null : counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
    }
    return kind === "milestones" ? null : row[kind];
}

function hasProgress(milestones: DataMilestonesSummary | null): milestones is DataMilestonesSummary {
    return milestones !== null && (milestones.xp > 0 || milestones.claims > 0);
}

function rankLabel(milestones: DataMilestonesSummary, language: LanguageCode): string {
    const tier = RANK_TIERS.find((known) => known === milestones.tier);
    return tier ? rankName(language, { xp: milestones.xp, tier, step: milestones.step }) : "";
}

function phaseLabel(status: DataTransferStatus, language: LanguageCode): string {
    const name = status.peer ? nearbyDeviceAddressLabel(status.peer, language) : "";
    if (status.state === "receiving") {
        return t(language, "Receiving from {{name}}...", { name });
    }
    if (status.state === "saving" || status.state === "committing") {
        return t(language, "Saving...");
    }
    return t(language, "Connecting to {{name}}...", { name });
}

function resultLines(status: DataTransferStatus, language: LanguageCode): string[] {
    const result = status.result ?? {};
    const name = status.peer ? nearbyDeviceAddressLabel(status.peer, language) : "";
    if (status.kind === "milestones") {
        return [result.sourceCleared
            ? t(language, "Milestones moved from {{name}}.", { name })
            : t(language, "Milestones imported, but {{name}} didn't confirm it cleared its copy.", { name })];
    }
    return status.kind ? importResultLines(language, status.kind, status.mode === "replace", result) : [];
}

type DataTransferPageState = {
    view: ViewKey;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;

    gameId: number | null;
    gameTitle: string | null;
};

type DataTransferPageActions = {
    onBack: () => void | Promise<void>;
    onHome: () => void | Promise<void>;
};

type DataTransferPageProps = {
    state: DataTransferPageState;
    actions: DataTransferPageActions;
};

function DataTransferPage(props: DataTransferPageProps) {
    const { state, actions } = props;
    const { language } = state;

    const {
        status,
        loaded,
        running,
        starting,
        cancelling,
        kind,
        setKind,
        mode,
        setMode,
        startError,
        setStartError,
        localSummary,
        reloadLocalSummary,
        nearby,
        nearbyClosed,
        sawRunning,
        forgetFinished,
        pullFrom,
        cancel
    } = useDataTransfer();

    const [pending, setPending] = useState<DataDeviceRow | null>(null);
    const [pressedName, setPressedName] = useState("");
    const [backClaimToken, setBackClaimToken] = useState(0);

    useEffect(function forgetTheConfirmationOnTheWayOut() {
        if (state.view === "dataTransfer") {
            return;
        }
        setPending(null);
    }, [state.view]);

    const confirmClaim = useFocusClaim();
    const claimedKeyRef = useRef<string | null>(null);

    const busy = running || starting;

    const wasBusyRef = useRef(busy);
    useEffect(() => {
        const wasBusy = wasBusyRef.current;
        wasBusyRef.current = busy;
        if (!wasBusy || busy || state.view !== "dataTransfer") {
            return;
        }
        expectHeirClaim();
        setBackClaimToken((token) => token + 1);
    }, [busy, state.view]);

    const nearbyRows = nearby ?? NO_DATA_DEVICES;
    const nearbyWindow = useSlidingWindow({
        items: nearbyRows,
        itemKey: (row) => row.id,
        focusKeyFor: nearbyKey,
        windowId: "dataTransfer:nearby",
        heightScope: ["dataTransfer:nearby", language, textSize(12), kind].join("|"),
        dynamicLoading: true,
        initialRows: NEARBY_INITIAL_ROWS,
        rowStep: NEARBY_ROW_STEP,
        prefetchDistance: 0,
        sentinelRootMarginPx: NEARBY_SENTINEL_ROOT_MARGIN_PX,
        resetKey: `dataTransfer:nearby|${nearbyRows.length > 0}`,
        openFirst: pendingLandingKey("dataTransfer") ?? undefined
    });

    usePageLanding({
        view: "dataTransfer",
        defaultKey: "dataTransfer:back",
        ready: loaded,
        holds: (key) => nearbyRows.some((row) => nearbyKey(row) === key),
        open: (key) => nearbyWindow.openAt(key)
    });

    if (state.view !== "dataTransfer") {
        return null;
    }

    function claimTarget(control: ReactElement<{ focusKey?: string }>): ReactNode {
        const claim = confirmClaim.claim;
        if (!claim || control.props.focusKey !== claimedKeyRef.current) {
            return control;
        }
        return (
            <FocusClaim token={claim.token} armed={claim.armed} onSpent={confirmClaim.spend}>
                {control}
            </FocusClaim>
        );
    }

    function claim(focusKey: string) {
        expectHeirClaim();
        claimedKeyRef.current = focusKey;
        confirmClaim.claimSlot(0);
    }

    function cycleKind() {
        setPending(null);
        forgetFinished();
        setStartError("");
        setKind(nextDataKind(kind));
    }

    function rowRefusal(row: DataDeviceRow): string {
        if (kind === "milestones") {
            return hasProgress(row.milestones) ? "" : "peer_nothing";
        }
        if (GAME_KINDS.includes(kind)) {
            if (state.gameId === null) {
                return "no_game";
            }
            if (row.gameId !== state.gameId) {
                return "different_game";
            }
        }
        return rowCount(row, kind) === 0 ? "peer_nothing" : "";
    }

    async function pickRow(row: DataDeviceRow) {
        forgetFinished();
        setPressedName(nearbyDeviceAddressLabel(row, language));
        let refusal = rowRefusal(row);
        if (!refusal && kind === "milestones") {
            const mine = (await reloadLocalSummary())?.milestones ?? null;
            if (mine !== null && row.milestones !== null && mine.xp > row.milestones.xp) {
                refusal = "more_here";
            }
        }
        setStartError(refusal);
        if (refusal) {
            return;
        }
        if (kind !== "milestones" && mode === "merge") {
            setBackClaimToken((token) => token + 1);
            void pullFrom(row);
            return;
        }
        setPending(row);
        void reloadLocalSummary();
        claim("dataTransfer:replace:keep");
    }

    function confirmReplace() {
        const chosen = pending;
        setBackClaimToken((token) => token + 1);
        setPending(null);
        if (chosen) {
            void pullFrom(chosen);
        }
    }

    function keepWhatIHave() {
        const returning = pending;
        setPending(null);
        if (returning && nearbyRows.some((row) => row.id === returning.id)) {
            claim(nearbyKey(returning));
            return;
        }
        claim(MODE_FOCUS_KEY);
    }

    function cancelFromButton() {
        setBackClaimToken((token) => token + 1);
        return cancel();
    }

    function rowSummary(row: DataDeviceRow): string {
        if (kind === "milestones") {
            if (!hasProgress(row.milestones)) {
                return t(language, "No milestones progress");
            }
            return t(language, "Rank {{rank}} · {{xp}} XP", {
                rank: rankLabel(row.milestones, language),
                xp: row.milestones.xp
            });
        }
        if (kind === "events") {
            return row.events === null ? "" : t(language, "{{count}} tracked events", { count: row.events });
        }
        if (row.gameId === null) {
            return t(language, "No current game");
        }
        if (row.gameId !== state.gameId) {
            return t(language, "Different game: {{title}}", { title: row.title ?? "" });
        }
        if (kind === "all") {
            return t(language, "Tracked {{tracked}} · Notes {{notes}} · Bookmarks {{bookmarks}}", {
                tracked: row.tracked ?? 0,
                notes: row.notes ?? 0,
                bookmarks: row.guides ?? 0
            });
        }
        const count = row[kind];
        if (count === null) {
            return "";
        }
        if (kind === "tracked") {
            return t(language, "{{count}} tracked", { count });
        }
        return kind === "notes"
            ? t(language, "{{count}} notes", { count })
            : t(language, "{{count}} bookmarks", { count });
    }

    function confirmLines(row: DataDeviceRow): string[] {
        const name = nearbyDeviceAddressLabel(row, language);
        if (kind === "tracked") {
            return [t(language, "This will replace {{count}} tracked achievements on this device.", {
                count: localSummary?.tracked ?? 0
            })];
        }
        if (kind === "notes") {
            return [t(language, "This will replace {{count}} notes on this device.", {
                count: localSummary?.notes ?? 0
            })];
        }
        if (kind === "guides") {
            return [t(language, "This will replace {{count}} bookmarks on this device.", {
                count: localSummary?.guides ?? 0
            })];
        }
        if (kind === "events") {
            return [t(language, "This will replace {{count}} tracked events on this device.", {
                count: localSummary?.events ?? 0
            })];
        }
        if (kind === "all") {
            return [t(language, "This will replace this device's tracked achievements, notes and bookmarks for this game with the ones on {{name}}.", { name })];
        }
        const mine = localSummary?.milestones ?? null;
        const theirs = row.milestones;
        return [t(language, "This replaces this device's milestones ({{rank}}, {{xp}} XP) with {{name}}'s ({{peerRank}}, {{peerXp}} XP). {{name}} starts over at zero.", {
            rank: mine ? rankLabel(mine, language) : "",
            xp: mine?.xp ?? 0,
            name,
            peerRank: theirs ? rankLabel(theirs, language) : "",
            peerXp: theirs?.xp ?? 0
        })];
    }

    const finished = sawRunning && status !== null && status.direction === "receive";
    const errorCode = startError || (finished && status?.state === "failed" ? status.error : "");
    const errorName = startError ? pressedName : (status?.peer ? nearbyDeviceAddressLabel(status.peer, language) : "");
    const noGame = GAME_KINDS.includes(kind) && state.gameId === null;
    const canCancel = status !== null && (status.state === "connecting" || status.state === "receiving");

    const scopeKey = `dataTransfer:view:${busy ? "run" : "idle"}`;

    return (
        <Focusable key={scopeKey} flow-children="column">
            <PanelSection>
                <PageNavStrip
                    title={t(language, "Data Transfer")}
                    buttonSpacing={state.buttonSpacing}
                    onHome={actions.onHome}
                    help={<PageHelpButton focusKey="dataTransfer:guide" guide="data-transfer" />}
                />

                <BackButton
                    key={`back:${backClaimToken}`}
                    label={t(language, "Back")}
                    focusKey="dataTransfer:back"
                    navAutoFocus
                    reclaim={backClaimToken > 0}
                    standDown={subLandingAhead("dataTransfer", 0)}
                    buttonSpacing={state.buttonSpacing}
                    onClick={actions.onBack}
                    scrollMarginTop={BACK_BUTTON_SCROLL_MARGIN_PX}
                />

                {busy && status && (
                    <>
                        <PanelSectionRow>
                            <div style={{ marginTop: "12px" }}>
                                <InlineSpinner label={phaseLabel(status, language)} bold />
                            </div>
                        </PanelSectionRow>
                        {canCancel && (
                            <PanelSectionRow>
                                <FocusableItem
                                    focusKey="dataTransfer:cancel"
                                    outerStyle={{ ...regularButtonSpacingStyle(state.buttonSpacing), marginTop: "12px" }}
                                    disabled={cancelling}
                                    onClick={cancelFromButton}
                                    bottomSeparator="none"
                                >
                                    {t(language, cancelling ? "Stopping..." : "Cancel")}
                                </FocusableItem>
                            </PanelSectionRow>
                        )}
                    </>
                )}

                {!busy && loaded && (
                    <>
                        <LabeledRow
                            outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                            focusKey={DATA_FOCUS_KEY}
                            onClick={cycleKind}
                            label={t(language, "Data")}
                            value={kindLabel(kind, language)}
                        />

                        <ToggleRow
                            controlled
                            label={t(language, "Replace Destination")}
                            value={kind === "milestones" || mode === "replace"}
                            disabled={kind === "milestones"}
                            outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                            focusKey={MODE_FOCUS_KEY}
                            focusFallback={[DATA_FOCUS_KEY]}
                            onChange={(next) => setMode(next ? "replace" : "merge")}
                            help={t(language, "help_data_transfer_replace")}
                        />

                        {GAME_KINDS.includes(kind) && state.gameId !== null && (
                            <PanelSectionRow>
                                <div style={bodyTextStyle()}>
                                    {t(language, "Current Game: {{title}}", { title: state.gameTitle ?? "" })}
                                </div>
                            </PanelSectionRow>
                        )}

                        {errorCode !== "" && (
                            <PanelSectionRow>
                                <div style={{ ...bodyTextStyle(), color: errorRed, opacity: 1 }}>
                                    {t(language, dataTransferErrorKey(errorCode), { name: errorName })}
                                </div>
                            </PanelSectionRow>
                        )}

                        {finished && status?.state === "done" && resultLines(status, language).map((line) => (
                            <PanelSectionRow key={line}>
                                <div style={bodyTextStyle()}>{line}</div>
                            </PanelSectionRow>
                        ))}

                        {finished && status?.state === "canceled" && (
                            <PanelSectionRow>
                                <div style={bodyTextStyle()}>
                                    {t(language, "Stopped, and nothing was left behind.")}
                                </div>
                            </PanelSectionRow>
                        )}

                        {pending !== null ? (
                            <>
                                {confirmLines(pending).map((line) => (
                                    <PanelSectionRow key={line}>
                                        <div style={{ ...bodyTextStyle(), color: errorRed, opacity: 1 }}>{line}</div>
                                    </PanelSectionRow>
                                ))}
                                <PanelSectionRow>
                                    {claimTarget(
                                        <FocusableItem
                                            outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                            focusKey="dataTransfer:replace:keep"
                                            focusFallback={[nearbyKey(pending), MODE_FOCUS_KEY]}
                                            onClick={keepWhatIHave}
                                        >
                                            {t(language, "Keep What I Have")}
                                        </FocusableItem>
                                    )}
                                </PanelSectionRow>
                                <PanelSectionRow>
                                    <ConfirmRow
                                        focusKey="dataTransfer:replace:confirm"
                                        focusFallback={[nearbyKey(pending), MODE_FOCUS_KEY]}
                                        idleLabel={t(language, "Replace Destination")}
                                        armedLabel={t(language, "Press again to replace it")}
                                        disabled={false}
                                        buttonSpacing={state.buttonSpacing}
                                        bottomSeparator="none"
                                        labelStyle={{ color: errorRed }}
                                        onConfirm={confirmReplace}
                                    />
                                </PanelSectionRow>
                            </>
                        ) : (
                            <>
                                <PanelSectionRow>
                                    <div style={{ ...bodyTextStyle(), fontWeight: "bold", opacity: 1, marginTop: "8px" }}>
                                        {t(language, "Import From Nearby Devices")}
                                    </div>
                                </PanelSectionRow>
                                {noGame && (
                                    <PanelSectionRow>
                                        <div style={bodyTextStyle()}>
                                            {t(language, "No current game. Load a game on both devices first.")}
                                        </div>
                                    </PanelSectionRow>
                                )}
                                {!noGame && nearbyRows.length > 0 && (
                                    <SlidingWindowRows list={nearbyWindow}>
                                        {nearbyWindow.mountedItems.map((row, index) => {
                                            const at = nearbyWindow.start + index;
                                            const neighbors = [nearbyRows[at + 1], nearbyRows[at - 1]]
                                                .filter((other): other is DataDeviceRow => other !== undefined)
                                                .map(nearbyKey);
                                            return (
                                                <PanelSectionRow key={row.id}>
                                                    {claimTarget(
                                                        <FocusableItem
                                                            outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                                            focusKey={nearbyKey(row)}
                                                            focusFallback={[...neighbors, MODE_FOCUS_KEY, DATA_FOCUS_KEY]}
                                                            onGamepadFocus={() => nearbyWindow.onItemFocus(at)}
                                                            onGamepadDirection={nearbyWindow.guardTopRow(at)}
                                                            onClick={() => void pickRow(row)}
                                                        >
                                                            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                                                <div>{nearbyDeviceName(row, language)}</div>
                                                                <div style={bodyTextStyle()}>{row.address}</div>
                                                                <div style={bodyTextStyle()}>{rowSummary(row)}</div>
                                                            </div>
                                                        </FocusableItem>
                                                    )}
                                                </PanelSectionRow>
                                            );
                                        })}
                                    </SlidingWindowRows>
                                )}
                                {!noGame && nearbyRows.length === 0 && nearby === null && !nearbyClosed && (
                                    <PanelSectionRow>
                                        <InlineSpinner label={t(language, "Looking for nearby devices...")} />
                                    </PanelSectionRow>
                                )}
                                {!noGame && nearbyRows.length === 0 && (nearby !== null || nearbyClosed) && (
                                    <PanelSectionRow>
                                        <div style={bodyTextStyle()}>
                                            {t(language, "No devices found. Make sure both devices are on this page.")}
                                        </div>
                                    </PanelSectionRow>
                                )}
                            </>
                        )}

                        <BottomFocusAnchor focusKey="dataTransfer:bottom:anchor" />
                    </>
                )}
            </PanelSection>
        </Focusable>
    );
}

export default DataTransferPage;
