import { PanelSectionRow } from "@decky/ui";
import { PanelSection } from "../components/ui/PanelSection";
import { Fragment, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

import { BackButton } from "../components/ui/BackButton";
import { BottomFocusAnchor } from "../components/ui/BottomFocusAnchor";
import { ButtonPrompt } from "../components/ui/ButtonPrompt";
import { ConfirmRow } from "../components/ui/ConfirmRow";
import { FocusClaim } from "../components/ui/FocusClaim";
import { FocusableItem } from "../components/ui/FocusableItem";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { PageHelpButton, PageNavStrip } from "../components/ui/PageNavStrip";
import { ProgressBar } from "../components/ui/ProgressBar";
import { SlidingWindowRows } from "../components/ui/SlidingWindowRows";
import { TripleConfirmRow } from "../components/ui/TripleConfirmRow";
import { SectionTitle } from "../components/ui/SectionTitle";
import { ToggleRow } from "../components/ui/ToggleRow";
import { useFocusClaim } from "../hooks/useFocusClaim";
import { useSlidingWindow } from "../hooks/useSlidingWindow";
import { useMemoriesTransfer } from "../components/memories/MemoriesTransferContext";
import {
    BUNDLE_FOCUS_PREFIX,
    IMPORT_AGAIN_FOCUS_KEY,
    NEARBY_FOCUS_PREFIX
} from "../hooks/useMemoriesTransferController";
import { transferErrorKey } from "../utils/memoriesTransferErrors";
import { nearbyDeviceLabel, nearbyDeviceName } from "../utils/nearbyDevices";
import { t, type LanguageCode } from "../locales";
import type {
    ButtonSpacing,
    MemoriesTransferStatus,
    MemoryBundleRow,
    NearbyDeviceRow,
    ViewKey
} from "../types";
import { textSize } from "../utils/scale";
import { transferSizeLabel } from "../utils/memoriesTransferSize";
import { bodyTextStyle, errorRed, regularButtonSpacingStyle, warnAmber } from "../utils/style";
import { pendingLandingKey, subLandingAhead, usePageLanding } from "../focusRecords";
import { expectHeirClaim } from "../focusClaims";

const BACK_BUTTON_SCROLL_MARGIN_PX = 24;

const LOADING_SPINNER_DELAY_MS = 500;

const IMPORT_FOCUS_KEY = "memoriesTransfer:import";

const HELP_TEXT_BASE_PX = 12;

const NEARBY_INITIAL_ROWS = 20;
const NEARBY_ROW_STEP = 20;
const NEARBY_SENTINEL_ROOT_MARGIN_PX = 600;

const NO_NEARBY_DEVICES: NearbyDeviceRow[] = [];

function nearbyKey(row: NearbyDeviceRow): string {
    return NEARBY_FOCUS_PREFIX + row.id;
}

type PendingTarget =
    | { kind: "bundle"; row: MemoryBundleRow }
    | { kind: "nearby"; row: NearbyDeviceRow };

function dateLabel(seconds: number, language: LanguageCode): string {
    if (seconds <= 0) {
        return "";
    }
    return new Date(seconds * 1000).toLocaleDateString(language, {
        year: "numeric",
        month: "short",
        day: "numeric"
    });
}

function phaseLabel(status: MemoriesTransferStatus, language: LanguageCode): string {
    const name = status.peer ? nearbyDeviceLabel(status.peer, language) : "";
    switch (status.state) {
        case "connecting":
        case "preparing":
            return t(language, "Getting it ready on {{name}}...", { name });
        case "receiving":
            return t(language, "Receiving from {{name}}...", { name });
        case "sending":
            return t(language, "Sending to {{name}}...", { name });
        case "scanning":
            return t(language, "Looking through your memories...");
        case "writing":
            return t(language, "Writing the bundle...");
        case "validating":
            return t(language, "Checking the bundle...");
        case "importing":
            return t(language, "Bringing your memories in...");
        case "finishing":
            return t(language, "Finishing up...");
        default:
            return t(language, "Getting started...");
    }
}

function transferFraction(status: MemoriesTransferStatus): number | null {
    if (status.totalBytes <= 0 || status.state === "scanning" || status.state === "connecting"
        || status.state === "preparing") {
        return null;
    }
    return Math.min(status.bytes / status.totalBytes, 1);
}

type MemoriesTransferPageState = {
    view: ViewKey;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;

    activeUlid: string;
    memoriesCount: number;
};

type MemoriesTransferPageActions = {
    onBack: () => void | Promise<void>;
    onHome: () => void | Promise<void>;
    onDeleteAllMemories: () => void | Promise<void>;
};

type MemoriesTransferPageProps = {
    state: MemoriesTransferPageState;
    actions: MemoriesTransferPageActions;
};

function MemoriesTransferPage(props: MemoriesTransferPageProps) {
    const { state, actions } = props;
    const { language } = state;

    const {
        status,
        counts,
        weight,
        loaded,
        running,
        starting,
        cancelling,
        includeVideos,
        setIncludeVideos,
        mode,
        setMode,
        bundles,
        bundleFolderEmpty,
        refreshCounts,
        refreshEstimate,
        listing,
        startError,
        startExport,
        browseForBundles,
        forgetBundles,
        startImport,
        nearby,
        nearbyClosed,
        pullFromNearby,
        cancel,
        recoverStashed,
        discardStashed
    } = useMemoriesTransfer();

    const [showLoading, setShowLoading] = useState(false);
    const [pending, setPending] = useState<PendingTarget | null>(null);
    const [backClaimToken, setBackClaimToken] = useState(0);

    useEffect(function forgetTheConfirmationOnTheWayOut() {
        if (state.view === "memoriesTransfer") {
            return;
        }
        setPending(null);
    }, [state.view]);

    useEffect(() => {
        if (loaded) {
            setShowLoading(false);
            return;
        }
        const timer = window.setTimeout(() => setShowLoading(true), LOADING_SPINNER_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [loaded]);

    const confirmClaim = useFocusClaim();
    const claimedKeyRef = useRef<string | null>(null);

    const busy = running || starting;

    const nearbyRows = nearby ?? NO_NEARBY_DEVICES;
    const nearbyWindow = useSlidingWindow({
        items: nearbyRows,
        itemKey: (row) => row.id,
        focusKeyFor: nearbyKey,
        windowId: "memoriesTransfer:nearby",
        heightScope: ["memoriesTransfer:nearby", language, textSize(12), includeVideos].join("|"),
        dynamicLoading: true,
        initialRows: NEARBY_INITIAL_ROWS,
        rowStep: NEARBY_ROW_STEP,
        prefetchDistance: 0,
        sentinelRootMarginPx: NEARBY_SENTINEL_ROOT_MARGIN_PX,
        resetKey: `memoriesTransfer:nearby|${nearbyRows.length > 0}`,
        openFirst: pendingLandingKey("memoriesTransfer") ?? undefined
    });

    usePageLanding({
        view: "memoriesTransfer",
        defaultKey: "memoriesTransfer:back",
        ready: loaded && !listing,
        holds: (key) => nearbyRows.some((row) => nearbyKey(row) === key),
        open: (key) => nearbyWindow.openAt(key)
    });

    if (state.view !== "memoriesTransfer") {
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

    function exportFromButton() {
        setBackClaimToken((token) => token + 1);
        return startExport();
    }

    function importFromButton() {
        setBackClaimToken((token) => token + 1);
        return browseForBundles();
    }

    function cancelFromButton() {
        setBackClaimToken((token) => token + 1);
        return cancel();
    }

    function claim(focusKey: string) {
        expectHeirClaim();
        claimedKeyRef.current = focusKey;
        confirmClaim.claimSlot(0);
    }

    function pickBundle(row: MemoryBundleRow) {
        if (mode === "replace") {
            setPending({ kind: "bundle", row });
            void refreshCounts();
            claim("memoriesTransfer:replace:keep");
            return;
        }
        setBackClaimToken((token) => token + 1);
        void startImport(row.path);
    }

    function pickNearby(row: NearbyDeviceRow) {
        if (mode === "replace") {
            setPending({ kind: "nearby", row });
            void refreshCounts();
            claim("memoriesTransfer:replace:keep");
            return;
        }
        setBackClaimToken((token) => token + 1);
        void pullFromNearby(row);
    }

    function confirmReplace() {
        const chosen = pending;
        setBackClaimToken((token) => token + 1);
        setPending(null);
        if (chosen?.kind === "bundle") {
            void startImport(chosen.row.path);
        }
        else if (chosen?.kind === "nearby") {
            void pullFromNearby(chosen.row);
        }
    }

    function keepWhatIHave() {
        const returning = pending;
        setPending(null);
        if (returning?.kind === "nearby" && nearbyRows.some((row) => row.id === returning.row.id)) {
            claim(nearbyKey(returning.row));
            return;
        }
        const stillListed = returning?.kind === "bundle" && (bundles ?? []).some((row) => row.path === returning.row.path);
        if (stillListed) {
            claim(BUNDLE_FOCUS_PREFIX + returning.row.path);
        }
        else {
            claim(bundles === null ? IMPORT_FOCUS_KEY : IMPORT_AGAIN_FOCUS_KEY);
        }
    }

    async function deleteAllFromButton() {
        setBackClaimToken((token) => token + 1);
        setPending(null);
        await actions.onDeleteAllMemories();
        await refreshEstimate();
    }

    function chooseAnotherFolder() {
        setPending(null);
        forgetBundles();
        return importFromButton();
    }

    const failed = status?.state === "failed";
    const stashed = Boolean(status?.stashed);
    const errorCode = startError || (failed ? status?.error ?? "" : "");
    const exporting = status?.direction === "export" || status?.direction === "send";
    const nothingToExport = (counts?.memories ?? 0) <= 0
        || (!includeVideos && weight !== null && weight.memoriesNoVideos <= 0);

    const scopeKey = `memoriesTransfer:view:${busy ? "run" : "idle"}`;

    const page = (
        <PanelSection key={scopeKey}>
            <PageNavStrip
                title={t(language, "Transfer")}
                buttonSpacing={state.buttonSpacing}
                onHome={actions.onHome}
                help={<PageHelpButton focusKey="memoriesTransfer:guide" guide="transfer-memories" />}
            />

            <BackButton
                key={`back:${backClaimToken}`}
                label={t(language, "Back")}
                focusKey="memoriesTransfer:back"
                navAutoFocus
                reclaim={backClaimToken > 0}
                standDown={subLandingAhead("memoriesTransfer", 0)}
                buttonSpacing={state.buttonSpacing}
                onClick={actions.onBack}
                scrollMarginTop={BACK_BUTTON_SCROLL_MARGIN_PX}
            />

            {!loaded && showLoading && (
                <PanelSectionRow>
                    <InlineSpinner label={t(language, "Loading...")} />
                </PanelSectionRow>
            )}

            {busy && status && (
                <>
                    <PanelSectionRow>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "12px" }}>
                            <InlineSpinner label={phaseLabel(status, language)} bold />
                            <div style={bodyTextStyle()}>
                                {t(language, "You can leave this page or close the panel. You will be notified when the transfer is finished.")}
                            </div>
                            <ProgressBar fraction={transferFraction(status)} />
                            {status.totalBytes > 0 && (
                                <div style={bodyTextStyle()}>
                                    {`${transferSizeLabel(status.bytes)} / ${transferSizeLabel(status.totalBytes)}`}
                                </div>
                            )}
                            {status.totalRecords > 0 && (
                                <div style={bodyTextStyle()}>
                                    {t(language, "{{count}} of {{total}} memories", {
                                        count: status.records,
                                        total: status.totalRecords
                                    })}
                                </div>
                            )}
                        </div>
                    </PanelSectionRow>

                    <PanelSectionRow>
                        {exporting ? (
                            <ConfirmRow
                                focusKey="memoriesTransfer:cancel"
                                idleLabel={t(language, "Cancel Export")}
                                armedLabel={t(language, "Press again to cancel")}
                                disabled={cancelling}
                                buttonSpacing={state.buttonSpacing}
                                bottomSeparator="none"
                                onConfirm={cancelFromButton}
                            />
                        ) : (
                            <FocusableItem
                                focusKey="memoriesTransfer:cancel"
                                outerStyle={{ ...regularButtonSpacingStyle(state.buttonSpacing), marginTop: "12px" }}
                                disabled={cancelling}
                                onClick={cancelFromButton}
                                bottomSeparator="none"
                            >
                                {t(language, cancelling ? "Stopping..." : "Cancel Import")}
                            </FocusableItem>
                        )}
                    </PanelSectionRow>
                </>
            )}

            {!busy && loaded && (
                <>
                    {stashed && (
                        <>
                            <SectionTitle label={t(language, "Unfinished Restore")} align="start" scaled={false} />
                            <PanelSectionRow>
                                <div style={{ ...bodyTextStyle(), color: warnAmber, opacity: 1 }}>
                                    {t(language, "A restore stopped part way through. Your old library is still on this device, alongside whatever the import managed. Only you know which one you want.")}
                                </div>
                            </PanelSectionRow>
                            <PanelSectionRow>
                                <ConfirmRow
                                    focusKey="memoriesTransfer:recover"
                                    idleLabel={t(language, "Put My Old Library Back")}
                                    armedLabel={t(language, "Press again to put it back")}
                                    disabled={false}
                                    buttonSpacing={state.buttonSpacing}
                                    onConfirm={recoverStashed}
                                    help={t(language, "help_memories_transfer_recover")}
                                />
                            </PanelSectionRow>
                            <PanelSectionRow>
                                <ConfirmRow
                                    focusKey="memoriesTransfer:discard"
                                    idleLabel={t(language, "Throw the Old Library Away")}
                                    armedLabel={t(language, "Press again to throw it away")}
                                    disabled={false}
                                    buttonSpacing={state.buttonSpacing}
                                    labelStyle={{ color: errorRed }}
                                    onConfirm={discardStashed}
                                    help={t(language, "help_memories_transfer_discard")}
                                />
                            </PanelSectionRow>
                        </>
                    )}

                    {errorCode !== "" && (
                        <PanelSectionRow>
                            <div style={{ ...bodyTextStyle(), color: errorRed, opacity: 1 }}>
                                {t(language, transferErrorKey(errorCode))}
                            </div>
                        </PanelSectionRow>
                    )}

                    {status?.state === "canceled" && (
                        <PanelSectionRow>
                            <div style={bodyTextStyle()}>
                                {t(language, "Stopped, and nothing was left behind.")}
                            </div>
                        </PanelSectionRow>
                    )}

                    <SectionTitle label={t(language, "Export")} align="start" scaled={false} />

                    <PanelSectionRow>
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            <div style={bodyTextStyle()}>
                                {t(language, "{{count}} memories across {{games}} games", {
                                    count: counts?.memories ?? 0,
                                    games: counts?.games ?? 0
                                })}
                            </div>
                            <div style={bodyTextStyle()}>
                                {weight === null
                                    ? t(language, "Working out the size...")
                                    : t(language, "About {{size}} on disk", {
                                        size: transferSizeLabel(
                                            includeVideos ? weight.bytes : weight.bytesNoVideos
                                        )
                                    })}
                            </div>
                            {!includeVideos && (weight?.clipMemories ?? 0) > 0 && (
                                <div style={{ ...bodyTextStyle(), color: warnAmber, opacity: 1 }}>
                                    {t(language, "{{count}} clip memories stay behind.", {
                                        count: weight?.clipMemories ?? 0
                                    })}
                                </div>
                            )}
                            {(weight?.offlineClips ?? 0) > 0 && (
                                <div style={{ ...bodyTextStyle(), color: warnAmber, opacity: 1 }}>
                                    {t(language, "{{count}} clip videos are on a drive that isn't connected.", {
                                        count: weight?.offlineClips ?? 0
                                    })}
                                </div>
                            )}
                            {(weight?.missingOwnedClips ?? 0) > 0 && (
                                <div style={{ ...bodyTextStyle(), color: warnAmber, opacity: 1 }}>
                                    {t(language, "{{count}} clip videos are gone from where they were saved.", {
                                        count: weight?.missingOwnedClips ?? 0
                                    })}
                                </div>
                            )}
                            {(weight?.missingClips ?? 0) > 0 && (
                                <div style={{ ...bodyTextStyle(), color: warnAmber, opacity: 1 }}>
                                    {t(language, "{{count}} clip videos were left out of the import that brought them here.", {
                                        count: weight?.missingClips ?? 0
                                    })}
                                </div>
                            )}
                        </div>
                    </PanelSectionRow>

                    <ToggleRow
                        label={t(language, "Include Clip Videos")}
                        value={includeVideos}
                        outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                        focusKey="memoriesTransfer:toggle:includeVideos"
                        onChange={setIncludeVideos}
                        help={t(language, "help_memories_transfer_include_videos")}
                    />

                    <PanelSectionRow>
                        {claimTarget(
                            <FocusableItem
                                outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                focusKey="memoriesTransfer:export"
                                disabled={nothingToExport}
                                onClick={exportFromButton}
                                help={t(language, "help_memories_transfer_export")}
                            >
                                {t(language, "Choose Where to Save...")}
                            </FocusableItem>
                        )}
                    </PanelSectionRow>

                    <SectionTitle label={t(language, "Import")} align="start" scaled={false} />

                    <ToggleRow
                        label={t(language, "Replace My Library")}
                        value={mode === "replace"}
                        outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                        focusKey="memoriesTransfer:toggle:mode"
                        onChange={(next) => setMode(next ? "replace" : "merge")}
                        help={t(language, "help_memories_transfer_replace")}
                    />

                    {pending !== null && (pending.kind === "nearby" || bundles !== null) ? (
                        <>
                            <PanelSectionRow>
                                <div style={{ ...bodyTextStyle(), color: errorRed, opacity: 1 }}>
                                    {t(language, "This will delete {{count}} memories across {{games}} games and put {{name}} in their place.", {
                                        count: counts?.memories ?? 0,
                                        games: counts?.games ?? 0,
                                        name: pending.kind === "bundle" ? pending.row.name : nearbyDeviceLabel(pending.row, language)
                                    })}
                                </div>
                            </PanelSectionRow>
                            <PanelSectionRow>
                                {claimTarget(
                                    <FocusableItem
                                        outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                        focusKey="memoriesTransfer:replace:keep"
                                        onClick={keepWhatIHave}
                                    >
                                        {t(language, "Keep What I Have")}
                                    </FocusableItem>
                                )}
                            </PanelSectionRow>
                            <PanelSectionRow>
                                <ConfirmRow
                                    focusKey="memoriesTransfer:replace:confirm"
                                    idleLabel={t(language, "Replace My Library")}
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
                            {nearbyRows.length > 0 && (
                                <SlidingWindowRows list={nearbyWindow}>
                                    {nearbyWindow.mountedItems.map((row, index) => {
                                        const at = nearbyWindow.start + index;
                                        const neighbors = [nearbyRows[at + 1], nearbyRows[at - 1]]
                                            .filter((other): other is NearbyDeviceRow => other !== undefined)
                                            .map(nearbyKey);
                                        return (
                                            <PanelSectionRow key={row.id}>
                                                {claimTarget(
                                                    <FocusableItem
                                                        outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                                        focusKey={nearbyKey(row)}
                                                        focusFallback={[
                                                            ...neighbors,
                                                            IMPORT_FOCUS_KEY,
                                                            IMPORT_AGAIN_FOCUS_KEY
                                                        ]}
                                                        onGamepadFocus={() => nearbyWindow.onItemFocus(at)}
                                                        onGamepadDirection={nearbyWindow.guardTopRow(at)}
                                                        onClick={() => pickNearby(row)}
                                                    >
                                                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                                            <div>{nearbyDeviceName(row, language)}</div>
                                                            <div style={bodyTextStyle()}>{row.address}</div>
                                                            <div style={bodyTextStyle()}>
                                                                {t(language, "{{count}} memories, {{size}}", {
                                                                    count: includeVideos ? row.memories : row.memoriesNoVideos,
                                                                    size: transferSizeLabel(includeVideos ? row.bytes : row.bytesNoVideos)
                                                                })}
                                                            </div>
                                                            {!includeVideos && row.includesVideo && (
                                                                <div style={bodyTextStyle()}>
                                                                    {t(language, "No clip videos")}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </FocusableItem>
                                                )}
                                            </PanelSectionRow>
                                        );
                                    })}
                                </SlidingWindowRows>
                            )}
                            {nearbyRows.length === 0 && nearby === null && !nearbyClosed && (
                                <PanelSectionRow>
                                    <InlineSpinner label={t(language, "Looking for nearby devices...")} />
                                </PanelSectionRow>
                            )}
                            {nearbyRows.length === 0 && (nearby !== null || nearbyClosed) && (
                                <PanelSectionRow>
                                    <div style={bodyTextStyle()}>
                                        {t(language, "No devices found. Make sure both devices are on this page.")}
                                    </div>
                                </PanelSectionRow>
                            )}
                            {bundles === null && !listing ? (
                                <PanelSectionRow>
                                    {claimTarget(
                                        <FocusableItem
                                            outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                            focusKey={IMPORT_FOCUS_KEY}
                                            onClick={importFromButton}
                                            bottomSeparator="none"
                                            help={
                                                <ButtonPrompt
                                                    language={language}
                                                    textKey="help_memories_transfer_import"
                                                    button="a"
                                                    fontSize={textSize(HELP_TEXT_BASE_PX)}
                                                />
                                            }
                                        >
                                            {t(language, "Choose a Folder...")}
                                        </FocusableItem>
                                    )}
                                </PanelSectionRow>
                            ) : (
                                <>
                                    {listing && (
                                        <PanelSectionRow>
                                            <InlineSpinner label={t(language, "Looking for bundles...")} />
                                        </PanelSectionRow>
                                    )}
                                    {!listing && bundleFolderEmpty && (
                                        <PanelSectionRow>
                                            <div style={{ ...bodyTextStyle(), color: warnAmber, opacity: 1 }}>
                                                {t(language, "No memory bundles in that folder.")}
                                            </div>
                                        </PanelSectionRow>
                                    )}
                                    {(bundles ?? []).map((row) => (
                                        <Fragment key={row.path}>
                                        <PanelSectionRow>
                                            {claimTarget(
                                                <FocusableItem
                                                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                                    focusKey={BUNDLE_FOCUS_PREFIX + row.path}
                                                    onClick={() => pickBundle(row)}
                                                >
                                                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                                        <div>{row.name}</div>
                                                        <div style={bodyTextStyle()}>
                                                            {t(language, "{{count}} memories, {{size}}", {
                                                                count: row.total,
                                                                size: transferSizeLabel(row.sizeBytes)
                                                            })}
                                                        </div>
                                                        <div style={bodyTextStyle()}>
                                                            {dateLabel(row.createdAt, language)}
                                                        </div>
                                                        {!row.includesVideo && (
                                                            <div style={bodyTextStyle()}>
                                                                {t(language, "No clip videos in this bundle.")}
                                                            </div>
                                                        )}
                                                        {row.ulid !== "" && row.ulid !== state.activeUlid && (
                                                            <div style={{ ...bodyTextStyle(), color: warnAmber, opacity: 1 }}>
                                                                {t(language, "From another RetroAchievements account")}
                                                            </div>
                                                        )}
                                                    </div>
                                                </FocusableItem>
                                            )}
                                        </PanelSectionRow>
                                        </Fragment>
                                    ))}
                                    {bundles !== null && (
                                        <PanelSectionRow>
                                            {claimTarget(
                                                <FocusableItem
                                                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                                    focusKey={IMPORT_AGAIN_FOCUS_KEY}
                                                    focusFallback={[IMPORT_FOCUS_KEY]}
                                                    onClick={chooseAnotherFolder}
                                                    bottomSeparator="none"
                                                >
                                                    {t(language, "Choose a Different Folder...")}
                                                </FocusableItem>
                                            )}
                                        </PanelSectionRow>
                                    )}
                                </>
                            )}
                        </>
                    )}

                    <SectionTitle label={t(language, "Memories Data")} align="start" scaled={false} />

                    <PanelSectionRow>
                        <TripleConfirmRow
                            focusKey="memoriesTransfer:delete-all-memories"
                            idleLabel={t(language, "Delete All Memories ({{count}})", {
                                count: state.memoriesCount
                            })}
                            armedLabel2={t(language, "Press again to delete everything")}
                            armedLabel3={t(language, "Last chance: This erases everything")}
                            disabled={state.memoriesCount <= 0}
                            buttonSpacing={state.buttonSpacing}
                            bottomSeparator="none"
                            labelStyle={{ color: errorRed }}
                            onConfirm={deleteAllFromButton}
                            help={t(language, "help_delete_all_memories")}
                        />
                    </PanelSectionRow>

                    <BottomFocusAnchor focusKey="memoriesTransfer:bottom:anchor" />
                </>
            )}
        </PanelSection>
    );

    return page;
}

export default MemoriesTransferPage;
