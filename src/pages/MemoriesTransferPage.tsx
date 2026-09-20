import { PanelSectionRow } from "@decky/ui";
import { PanelSection } from "../components/ui/PanelSection";
import { Fragment, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

import { logFocusDebug } from "../api";
import { BackButton } from "../components/ui/BackButton";
import { BottomFocusAnchor } from "../components/ui/BottomFocusAnchor";
import { ButtonPrompt } from "../components/ui/ButtonPrompt";
import { ConfirmRow } from "../components/ui/ConfirmRow";
import { FocusClaim } from "../components/ui/FocusClaim";
import { FocusableItem } from "../components/ui/FocusableItem";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { ProgressBar } from "../components/ui/ProgressBar";
import { TripleConfirmRow } from "../components/ui/TripleConfirmRow";
import { RestoreCurtain } from "../components/ui/RestoreCurtain";
import { SectionTitle } from "../components/ui/SectionTitle";
import { ToggleRow } from "../components/ui/ToggleRow";
import { useFocusClaim } from "../hooks/useFocusClaim";
import { useMemoriesTransfer } from "../components/memories/MemoriesTransferContext";
import { armMemoriesTransferFocusReturn } from "../utils/memoriesTransferFocusReturn";
import { transferErrorKey } from "../utils/memoriesTransferErrors";
import { t, type LanguageCode } from "../locales";
import type {
    ButtonSpacing,
    MemoriesTransferStatus,
    MemoryBundleRow,
    ViewKey
} from "../types";
import { textSize } from "../utils/scale";
import { transferSizeLabel } from "../utils/memoriesTransferSize";
import { bodyTextStyle, errorRed, regularButtonSpacingStyle, warnAmber } from "../utils/style";

const BACK_BUTTON_SCROLL_MARGIN_PX = 24;

const LOADING_SPINNER_DELAY_MS = 500;

const BUNDLE_FOCUS_PREFIX = "memoriesTransfer:bundle:";

const HELP_TEXT_BASE_PX = 12;

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
    switch (status.state) {
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
    if (status.totalBytes <= 0 || status.state === "scanning") {
        return null;
    }
    return Math.min(status.bytes / status.totalBytes, 1);
}

type MemoriesTransferPageState = {
    view: ViewKey;
    focusScopeResetToken: number;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;

    activeUlid: string;
    memoriesCount: number;
    restoreFocusKey: string | null;
    restorePending: boolean;
    panelOverlayVisible: boolean;
};

type MemoriesTransferPageActions = {
    onBack: () => void | Promise<void>;
    onHome: () => void | Promise<void>;
    onRequestFocus: (focusKey: string) => void;
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
        cancel,
        recoverStashed,
        discardStashed
    } = useMemoriesTransfer();

    const [showLoading, setShowLoading] = useState(false);
    const [pendingBundle, setPendingBundle] = useState<MemoryBundleRow | null>(null);
    const [backClaimToken, setBackClaimToken] = useState(0);

    useEffect(function forgetTheConfirmationOnTheWayOut() {
        if (state.view === "memoriesTransfer") {
            return;
        }
        setPendingBundle(null);
    }, [state.view]);

    useEffect(() => {
        if (loaded) {
            setShowLoading(false);
            return;
        }
        const timer = window.setTimeout(() => setShowLoading(true), LOADING_SPINNER_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [loaded]);

    const { restoreFocusKey, restorePending } = state;

    const restoreClaim = useFocusClaim();
    const restoreFiredRef = useRef(false);
    const [restoreAbandoned, setRestoreAbandoned] = useState(false);
    const claimedKeyRef = useRef<string | null>(null);

    const busy = running || starting;

    useEffect(function landRestoredCursor() {
        if (state.view !== "memoriesTransfer" || !restorePending || restoreFiredRef.current) {
            return;
        }
        if (!loaded) {
            return;
        }
        if (restoreFocusKey === null || busy) {
            restoreFiredRef.current = true;
            setRestoreAbandoned(true);
            logFocusDebug(
                "memoriestransfer-restore",
                restoreFocusKey ?? "(none)",
                busy ? "a transfer is running" : "nothing armed"
            );
            actions.onRequestFocus("memoriesTransfer:back");
            return;
        }
        let target = restoreFocusKey;
        if (target === "memoriesTransfer:import") {
            if (listing) {
                return;
            }
            if (bundles !== null && bundles.length > 0) {
                target = `${BUNDLE_FOCUS_PREFIX}0`;
            }
        }
        restoreFiredRef.current = true;
        logFocusDebug("memoriestransfer-restore", target, "claiming");
        claimedKeyRef.current = target;
        restoreClaim.claimSlot(0);
        actions.onRequestFocus(target);
    }, [
        state.view,
        restorePending,
        restoreFocusKey,
        loaded,
        busy,
        listing,
        bundles,
        restoreClaim.claimSlot,
        actions.onRequestFocus
    ]);

    if (state.view !== "memoriesTransfer") {
        return null;
    }

    function claimTarget(control: ReactElement<{ focusKey?: string }>): ReactNode {
        const claim = restoreClaim.claim;
        if (!claim || control.props.focusKey !== claimedKeyRef.current) {
            return control;
        }
        return (
            <FocusClaim token={claim.token} armed={claim.armed} onSpent={restoreClaim.spend}>
                {control}
            </FocusClaim>
        );
    }

    function exportFromButton() {
        setBackClaimToken((token) => token + 1);
        armMemoriesTransferFocusReturn("memoriesTransfer:export");
        return startExport();
    }

    function importFromButton() {
        setBackClaimToken((token) => token + 1);
        armMemoriesTransferFocusReturn("memoriesTransfer:import");
        return browseForBundles();
    }

    function cancelFromButton() {
        setBackClaimToken((token) => token + 1);
        return cancel();
    }

    function claim(focusKey: string) {
        claimedKeyRef.current = focusKey;
        restoreClaim.claimSlot(0);
    }

    function pickBundle(row: MemoryBundleRow) {
        if (mode === "replace") {
            setPendingBundle(row);
            void refreshCounts();
            claim("memoriesTransfer:replace:keep");
            return;
        }
        setBackClaimToken((token) => token + 1);
        void startImport(row.path);
    }

    function confirmReplace() {
        const chosen = pendingBundle;
        setBackClaimToken((token) => token + 1);
        setPendingBundle(null);
        if (chosen) {
            void startImport(chosen.path);
        }
    }

    function keepWhatIHave() {
        const returning = pendingBundle;
        setPendingBundle(null);
        const index = returning === null
            ? -1
            : (bundles ?? []).findIndex((row) => row.path === returning.path);
        claim(index >= 0 ? `${BUNDLE_FOCUS_PREFIX}${index}` : "memoriesTransfer:import");
    }

    async function deleteAllFromButton() {
        setBackClaimToken((token) => token + 1);
        setPendingBundle(null);
        await actions.onDeleteAllMemories();
        await refreshEstimate();
    }

    function chooseAnotherFolder() {
        setPendingBundle(null);
        forgetBundles();
        return importFromButton();
    }

    const failed = status?.state === "failed";
    const stashed = Boolean(status?.stashed);
    const errorCode = startError || (failed ? status?.error ?? "" : "");
    const exporting = status?.direction === "export";

    const scopeKey = `memoriesTransfer:view:${busy ? "run" : "idle"}:${state.focusScopeResetToken}`;

    const restoreSettled = restoreAbandoned
        || ((restoreClaim.claim?.token ?? 0) > 0 && !restoreClaim.claim?.armed);

    const page = (
        <PanelSection key={scopeKey}>
            <PageNavStrip
                title={t(language, "Transfer")}
                buttonSpacing={state.buttonSpacing}
                onHome={actions.onHome}
            />

            <BackButton
                key={`back:${backClaimToken}`}
                label={t(language, "Back")}
                focusKey="memoriesTransfer:back"
                navAutoFocus={!restorePending || backClaimToken > 0}
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
                            {(weight?.missingClips ?? 0) > 0 && (
                                <div style={{ ...bodyTextStyle(), color: warnAmber, opacity: 1 }}>
                                    {t(language, "{{count}} clip videos are no longer in Steam.", {
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
                        onChange={setIncludeVideos}
                        help={t(language, "help_memories_transfer_include_videos")}
                    />

                    <PanelSectionRow>
                        {claimTarget(
                            <FocusableItem
                                outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                focusKey="memoriesTransfer:export"
                                disabled={(counts?.memories ?? 0) <= 0}
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
                        onChange={(next) => setMode(next ? "replace" : "merge")}
                        help={t(language, "help_memories_transfer_replace")}
                    />

                    {pendingBundle !== null && bundles !== null ? (
                        <>
                            <PanelSectionRow>
                                <div style={{ ...bodyTextStyle(), color: errorRed, opacity: 1 }}>
                                    {t(language, "This will delete {{count}} memories across {{games}} games and put {{name}} in their place.", {
                                        count: counts?.memories ?? 0,
                                        games: counts?.games ?? 0,
                                        name: pendingBundle.name
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
                    ) : bundles === null ? (
                        <PanelSectionRow>
                            {claimTarget(
                                <FocusableItem
                                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                    focusKey="memoriesTransfer:import"
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
                            {bundles.map((row, index) => (
                                <Fragment key={row.path}>
                                <PanelSectionRow>
                                    {claimTarget(
                                        <FocusableItem
                                            outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                            focusKey={`${BUNDLE_FOCUS_PREFIX}${index}`}
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
                            <PanelSectionRow>
                                {claimTarget(
                                    <FocusableItem
                                        outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                        focusKey="memoriesTransfer:import"
                                        onClick={chooseAnotherFolder}
                                        bottomSeparator="none"
                                    >
                                        {t(language, "Choose a Different Folder...")}
                                    </FocusableItem>
                                )}
                            </PanelSectionRow>
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

    return (
        <RestoreCurtain
            armed={restorePending}
            settled={restoreSettled}
            covered={state.panelOverlayVisible}
        >
            {page}
        </RestoreCurtain>
    );
}

export default MemoriesTransferPage;
