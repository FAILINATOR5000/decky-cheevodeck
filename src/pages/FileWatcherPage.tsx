import { Focusable, PanelSection, PanelSectionRow, SliderField } from "@decky/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { BackButton } from "../components/ui/BackButton";
import { BottomFocusAnchor } from "../components/ui/BottomFocusAnchor";
import { FocusableItem } from "../components/ui/FocusableItem";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { ProgressBar } from "../components/ui/ProgressBar";
import { SectionTitle } from "../components/ui/SectionTitle";
import { ToggleRow } from "../components/ui/ToggleRow";
import { DirectoryCard, type DirectoryCardListProps } from "../components/filewatcher/DirectoryCard";
import { FileWatcherExclusionsModal } from "../components/pickers/FileWatcherExclusionsModal";
import { FileWatcherFindingsModal } from "../components/pickers/FileWatcherFindingsModal";
import { SchedulePickerModal } from "../components/pickers/SchedulePickerModal";
import { useWindowedList } from "../hooks/useWindowedList";
import { useFocusClaim } from "../hooks/useFocusClaim";
import { FocusClaim } from "../components/ui/FocusClaim";
import { useFileWatcher } from "../components/filewatcher/FileWatcherContext";
import { showManagedModal } from "../utils/modalRegistry";
import { t, type LanguageCode } from "../locales";
import type {
    ButtonSpacing,
    FileWatcherBucket,
    FileWatcherPass,
    FileWatcherRoot,
    FileWatcherSpeed,
    FileWatcherState,
    ViewKey
} from "../types";
import {
    FILE_WATCHER_BUCKETS,
    errorLine,
    bucketColor,
    bucketLabel,
    clockLabel,
    everyWeeksLabel,
    fileWatcherSpeedLabel,
    formatDateTime,
    passEtaLabel,
    sortWatchedRoots,
    weekdayLabel
} from "../utils/fileWatcher";
import { bodyTextStyle, errorRed, regularButtonSpacingStyle, warnAmber } from "../utils/style";

const BACK_BUTTON_SCROLL_MARGIN_PX = 24;

const LOADING_SPINNER_DELAY_MS = 500;

const SPEED_ORDER: FileWatcherSpeed[] = ["gentle", "balanced", "full"];

type FileWatcherPageState = {
    view: ViewKey;
    focusScopeResetToken: number;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;

    dynamicAllGames: boolean;
    dynamicInitialRows: number;
    dynamicRowStep: number;
    dynamicPrefetchDistance: number;
    dynamicSentinelRootMargin: number;
};

type FileWatcherPageActions = {
    onBack: () => void | Promise<void>;
    onHome: () => void | Promise<void>;
};

type FileWatcherPageProps = {
    state: FileWatcherPageState;
    actions: FileWatcherPageActions;
};

function FileWatcherPage(props: FileWatcherPageProps) {
    const { state, actions } = props;
    const { language } = state;

    const {
        state: watcher,
        loaded,
        starting,
        cancelling,
        savingReport,
        error,
        startPass,
        cancelPass,
        saveReport,
        addRoot,
        removeRoot,
        saveRoot,
        forgetRootHashes,
        saveSchedule,
        saveWindow,
        dismissFinding,
        settings
    } = useFileWatcher();
    const [showLoading, setShowLoading] = useState(false);
    const [armedRootId, setArmedRootId] = useState<number | null>(null);
    const rowClaim = useFocusClaim();
    const [addClaimToken, setAddClaimToken] = useState(0);

    useEffect(() => {
        if (loaded) {
            setShowLoading(false);
            return;
        }
        const timer = window.setTimeout(() => setShowLoading(true), LOADING_SPINNER_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [loaded]);

    const roots = sortWatchedRoots(watcher?.roots ?? [], language);
    const {
        mountedItems: mountedRoots,
        markerRef: cardsMarkerRef,
        onItemFocus: noteCardFocus
    } = useWindowedList({
        items: roots,
        dynamicLoading: state.dynamicAllGames,
        initialRows: state.dynamicInitialRows,
        rowStep: state.dynamicRowStep,
        prefetchDistance: state.dynamicPrefetchDistance,
        sentinelRootMargin: `${state.dynamicSentinelRootMargin}px 0px`,
        resetKey: "fileWatcher:roots"
    });

    const openExclusionsRef = useRef(openExclusions);
    openExclusionsRef.current = openExclusions;
    const cardFocusRef = useRef(noteCardFocus);
    cardFocusRef.current = noteCardFocus;
    const trashPressRef = useRef(handleTrashPress);
    trashPressRef.current = handleTrashPress;
    const trashBlurRef = useRef(handleTrashBlur);
    trashBlurRef.current = handleTrashBlur;

    const cardList = useMemo<DirectoryCardListProps>(() => ({
        language,
        locked: Boolean(watcher?.pass),
        onOpen: (root) => {
            openExclusionsRef.current(root);
        },
        onCardFocus: (index) => {
            cardFocusRef.current(index);
        },
        onTrashPress: (rootId) => {
            trashPressRef.current(rootId);
        },
        onTrashBlur: (rootId) => {
            trashBlurRef.current(rootId);
        }
    }), [language, watcher?.pass]);

    const activePass = watcher?.pass ?? null;
    const busy = Boolean(activePass) || starting;

    if (state.view !== "fileWatcher") {
        return null;
    }

    const counts = watcher?.counts;
    const skippedIds = new Set((watcher?.skipped ?? []).map((row) => row.rootId));

    function openSchedule() {
        if (!watcher) {
            return;
        }
        showManagedModal((close) => (
            <SchedulePickerModal
                language={language}
                schedule={watcher.schedule}
                window={watcher.window}
                onSaveSchedule={saveSchedule}
                onSaveWindow={saveWindow}
                close={close}
            />
        ));
    }

    function openExclusions(root: FileWatcherRoot) {
        showManagedModal((close) => (
            <FileWatcherExclusionsModal
                language={language}
                root={root}
                locked={Boolean(activePass)}
                mappedFiles={watcher?.rootStats?.[String(root.id)]?.files ?? 0}
                onSave={saveRoot}
                onForgetHashes={forgetRootHashes}
                close={close}
            />
        ));
    }

    function openFindings(bucket: FileWatcherBucket) {
        showManagedModal((close) => (
            <FileWatcherFindingsModal
                language={language}
                bucket={bucket}
                roots={watcher?.roots ?? []}
                skipped={watcher?.skipped ?? []}
                onDismiss={dismissFinding}
                close={close}
            />
        ));
    }

    function handleTrashBlur(rootId: number) {
        setArmedRootId((armed) => (armed === rootId ? null : armed));
    }

    async function handleTrashPress(rootId: number) {
        if (armedRootId !== rootId) {
            setArmedRootId(rootId);
            return;
        }
        setArmedRootId(null);
        const removedIndex = mountedRoots.findIndex((root) => root.id === rootId);
        const remaining = mountedRoots.length - 1;
        await removeRoot(rootId);
        if (remaining <= 0) {
            setAddClaimToken((token) => token + 1);
            return;
        }
        rowClaim.claimSlot(Math.min(Math.max(removedIndex, 0), remaining - 1));
    }

    const scopeKey = `fileWatcher:${busy ? "scan" : "idle"}:${state.focusScopeResetToken}`;

    return (
        <Focusable key={scopeKey}>
            <PanelSection>
                <PageNavStrip
                    title={t(language, "File Watcher")}
                    buttonSpacing={state.buttonSpacing}
                    onHome={actions.onHome}
                />

                <BackButton
                    label={t(language, "Back")}
                    focusKey="fileWatcher:back"
                    navAutoFocus
                    buttonSpacing={state.buttonSpacing}
                    onClick={actions.onBack}
                    scrollMarginTop={BACK_BUTTON_SCROLL_MARGIN_PX}
                />

                {busy && (
                    <>
                        <PanelSectionRow>
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "12px" }}>
                                {activePass?.active === false ? (
                                    <div style={{ ...bodyTextStyle(), color: warnAmber, opacity: 1, fontWeight: 700 }}>
                                        {pausedLine(activePass, watcher?.window?.blockTo, language)}
                                    </div>
                                ) : (
                                    <InlineSpinner
                                        label={activePass?.origin === "schedule"
                                            ? t(language, "Running your scheduled check...")
                                            : t(language, "Checking your files...")}
                                        bold
                                    />
                                )}
                                <div style={bodyTextStyle()}>
                                    {t(language, "This can take a while. You can leave this page or close the panel.")}
                                </div>
                                <ProgressBar fraction={passFraction(activePass)} />
                                {activePass?.active !== false && activePass?.phase === "hash" && (
                                    <div style={bodyTextStyle()}>
                                        {typeof activePass?.etaSeconds === "number"
                                            ? passEtaLabel(activePass.etaSeconds, language)
                                            : t(language, "Estimating time left...")}
                                    </div>
                                )}
                                {
}
                                {activePass && activePass.phase === "enumerate" && (
                                    <div style={bodyTextStyle()}>{t(language, "Finding your files...")}</div>
                                )}
                                {activePass && activePass.phase === "hash" && (
                                    <div style={{ ...bodyTextStyle(), wordBreak: "break-word" }}>
                                        {activePass.currentRoot ? `${activePass.currentRoot} · ` : ""}
                                        {t(language, "{{done}} of {{total}} files", {
                                            done: activePass.doneFiles,
                                            total: activePass.totalFiles
                                        })}
                                    </div>
                                )}
                            </div>
                        </PanelSectionRow>

                        <ScanControls
                            language={language}
                            speed={settings.speed}
                            runDuringGames={settings.runDuringGames}
                            buttonSpacing={state.buttonSpacing}
                            onSaveSpeed={settings.saveSpeed}
                            onSaveRunDuringGames={settings.saveRunDuringGames}
                            marginTop="6px"
                        />

                        {activePass && (
                            <PanelSectionRow>
                                <FocusableItem
                                    focusKey="fileWatcher:cancel"
                                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                    disabled={cancelling}
                                    onClick={cancelPass}
                                    bottomSeparator="none"
                                >
                                    {t(language, cancelling ? "Stopping..." : "Cancel Scan")}
                                </FocusableItem>
                            </PanelSectionRow>
                        )}
                    </>
                )}

                {
}
                {!loaded && showLoading && (
                    <PanelSectionRow>
                        <InlineSpinner label={t(language, "Loading...")} />
                    </PanelSectionRow>
                )}

                {!busy && loaded && (
                    <>
                        {error && (
                            <PanelSectionRow>
                                <div style={{ ...bodyTextStyle(), color: errorRed, opacity: 1, marginTop: "10px" }}>
                                    {t(language, errorLine(error))}
                                </div>
                            </PanelSectionRow>
                        )}

                        {
}
                        {Boolean(watcher?.lastCompletedAt) && (
                            <PanelSectionRow>
                                <div style={{ ...bodyTextStyle(), marginTop: "12px" }}>
                                    {t(language, "Last verified: {{date}}", {
                                        date: formatDateTime(watcher?.lastCompletedAt ?? 0, language)
                                    })}
                                </div>
                            </PanelSectionRow>
                        )}
                        <PanelSectionRow>
                            <div style={bodyTextStyle()}>
                                {watcher?.nextDueAt
                                    ? t(language, "Next run: {{date}}", {
                                        date: formatDateTime(watcher.nextDueAt, language)
                                    })
                                    : t(language, "Next run: not scheduled")}
                            </div>
                        </PanelSectionRow>

                        <PanelSectionRow>
                            <FocusableItem
                                focusKey="fileWatcher:schedule"
                                outerStyle={{ ...regularButtonSpacingStyle(state.buttonSpacing), marginTop: "10px" }}
                                onClick={openSchedule}
                                bottomSeparator="none"
                            >
                                {scheduleSummary(watcher, language)}
                            </FocusableItem>
                        </PanelSectionRow>

                        <PanelSectionRow>
                            <FocusableItem
                                focusKey="fileWatcher:verifyNow"
                                outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                disabled={roots.length === 0}
                                onClick={startPass}
                                bottomSeparator="none"
                                help={t(language, "help_file_watcher_verify_now")}
                            >
                                {t(language, nothingRecordedYet(watcher) ? "Hash Now" : "Verify Now")}
                            </FocusableItem>
                        </PanelSectionRow>
                        <PanelSectionRow>
                            <FocusableItem
                                focusKey="fileWatcher:saveReport"
                                outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                disabled={!watcher?.hasReport || savingReport}
                                onClick={saveReport}
                            >
                                {t(language, savingReport ? "Saving report..." : "Save Report")}
                            </FocusableItem>
                        </PanelSectionRow>

                        {watcher?.hasReport && counts && (
                            <>
                                <SectionTitle label={t(language, "Results")} />
                                {FILE_WATCHER_BUCKETS.map((bucket) => (
                                    <PanelSectionRow>
                                        <FocusableItem
                                            key={bucket}
                                            focusKey={`fileWatcher:bucket:${bucket}`}
                                            outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                            disabled={(counts[bucket] ?? 0) === 0}
                                            onClick={() => openFindings(bucket)}
                                            bottomSeparator="none"
                                        >
                                            <span style={{ color: bucketColor(bucket) }}>
                                                {`${bucketLabel(bucket, language)}  ${counts[bucket] ?? 0}`}
                                            </span>
                                        </FocusableItem>
                                    </PanelSectionRow>
                                ))}
                            </>
                        )}

                        {
}
                        {(watcher?.roots ?? []).length > 0
                            && ((watcher?.excludedTotal ?? 0) > 0 || (watcher?.hasReport && counts)) && (
                            <>
                                {!(watcher?.hasReport && counts) && <SectionTitle label={t(language, "Results")} />}
                                <PanelSectionRow>
                                    <FocusableItem
                                        focusKey="fileWatcher:excluded"
                                        outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                        disabled={(watcher?.excludedTotal ?? 0) === 0}
                                        onClick={() => openFindings("excluded")}
                                        bottomSeparator="none"
                                    >
                                        {`${bucketLabel("excluded", language)}  ${watcher?.excludedTotal ?? 0}`}
                                    </FocusableItem>
                                </PanelSectionRow>
                            </>
                        )}

                        <SectionTitle label={t(language, "Options")} />
                        <ScanControls
                            language={language}
                            speed={settings.speed}
                            runDuringGames={settings.runDuringGames}
                            buttonSpacing={state.buttonSpacing}
                            onSaveSpeed={settings.saveSpeed}
                            onSaveRunDuringGames={settings.saveRunDuringGames}
                            showHelp
                        />

                        <SectionTitle label={t(language, "Setup")} />

                        <Focusable key={`addclaim:${addClaimToken}`} autoFocus={addClaimToken > 0}>
                            <PanelSectionRow>
                                <FocusableItem
                                    focusKey="fileWatcher:addDirectory"
                                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                    onClick={addRoot}
                                    bottomSeparator="standard"
                                    help={t(language, "help_file_watcher_add_directory")}
                                >
                                    {t(language, "Add Directory")}
                                </FocusableItem>
                            </PanelSectionRow>
                        </Focusable>
                        {roots.length === 0 && (
                            <PanelSectionRow>
                                <div style={{ ...bodyTextStyle(), marginTop: "10px" }}>
                                    {t(language, "Nothing watched yet. Add a directory and File Watcher will record a hash for every file in it.")}
                                </div>
                            </PanelSectionRow>
                        )}

                        {roots.length > 0 && (
                            <>
                                <SectionTitle label={t(language, "Watched")} />
                                <div>
                                    {mountedRoots.map((root, index) => (
                                        <FocusClaim
                                            key={`fwslot:${index}`}
                                            token={rowClaim.claim?.slotIndex === index ? rowClaim.claim.token : 0}
                                            armed={Boolean(rowClaim.claim?.armed) && rowClaim.claim?.slotIndex === index}
                                            onSpent={rowClaim.spend}
                                        >
                                            <DirectoryCard
                                                root={root}
                                                fileCount={watcher?.rootStats?.[String(root.id)]?.files ?? 0}
                                                unreachable={skippedIds.has(root.id)}
                                                armed={armedRootId === root.id}
                                                index={index}
                                                list={cardList}
                                            />
                                        </FocusClaim>
                                    ))}
                                    {state.dynamicAllGames && mountedRoots.length < roots.length && (
                                        <div ref={cardsMarkerRef} style={{ height: "1px" }} />
                                    )}
                                </div>
                            </>
                        )}

                        {
}
                        <BottomFocusAnchor focusKey="fileWatcher:bottom:anchor" />
                    </>
                )}
            </PanelSection>
        </Focusable>
    );
}

function passFraction(activePass: FileWatcherPass | null): number | null {
    if (!activePass || activePass.totalBytes <= 0) {
        return null;
    }
    return Math.min(1, activePass.doneBytes / activePass.totalBytes);
}

function pausedLine(
    activePass: FileWatcherPass,
    blockTo: [number, number] | undefined,
    language: LanguageCode
): string {
    const fraction = passFraction(activePass);
    const percent = fraction === null ? 0 : Math.round(fraction * 100);
    if (activePass.waitingFor === "window" && blockTo) {
        return t(language, "Paused at {{percent}}% — resumes at {{time}}", {
            percent,
            time: clockLabel(blockTo[0], blockTo[1])
        });
    }
    if (activePass.waitingFor === "game") {
        return t(language, "Paused at {{percent}}% — a game is running", { percent });
    }
    if (activePass.waitingFor === "batterySaver") {
        return t(language, "Paused at {{percent}}% — Battery Saver is on", { percent });
    }
    if (activePass.waitingFor === "startup") {
        return t(language, "Resuming Soon — {{percent}}%", { percent });
    }
    return t(language, "Paused at {{percent}}%", { percent });
}

function ScanControls(props: {
    language: LanguageCode;
    speed: FileWatcherSpeed;
    runDuringGames: boolean;
    buttonSpacing: ButtonSpacing;
    onSaveSpeed: (value: FileWatcherSpeed) => void | Promise<void>;
    onSaveRunDuringGames: (value: boolean) => void | Promise<void>;
    marginTop?: string;
    showHelp?: boolean;
}) {
    const { language } = props;
    return (
        <>
            <PanelSectionRow>
                <div data-focus-key="fileWatcher:speed" style={{ marginTop: props.marginTop }}>
                    <SliderField
                        label={t(language, "Speed: {{speed}}", { speed: fileWatcherSpeedLabel(props.speed, language) })}
                        value={Math.max(0, SPEED_ORDER.indexOf(props.speed))}
                        min={0}
                        max={SPEED_ORDER.length - 1}
                        step={1}
                        notchCount={SPEED_ORDER.length}
                        notchTicksVisible
                        layout="below"
                        bottomSeparator="none"
                        onChange={(index) => void props.onSaveSpeed(SPEED_ORDER[index] ?? "gentle")}
                    />
                </div>
            </PanelSectionRow>
            <PanelSectionRow>
                <ToggleRow
                    outerStyle={regularButtonSpacingStyle(props.buttonSpacing)}
                    label={t(language, "Run during games")}
                    value={props.runDuringGames}
                    bottomSeparator={props.showHelp ? "standard" : "none"}
                    onChange={props.onSaveRunDuringGames}
                    help={props.showHelp ? t(language, "help_file_watcher_run_during_games") : undefined}
                />
            </PanelSectionRow>
        </>
    );
}

function nothingRecordedYet(watcher: FileWatcherState | null): boolean {
    if (!watcher || watcher.roots.length === 0) {
        return false;
    }
    return Object.values(watcher.rootStats ?? {}).every((row) => (row?.files ?? 0) === 0);
}

function scheduleSummary(watcher: FileWatcherState | null, language: LanguageCode): string {
    const schedule = watcher?.schedule;
    if (!schedule?.enabled) {
        return t(language, "Schedule: Off");
    }
    return `${everyWeeksLabel(schedule.everyWeeks, language)} · ${weekdayLabel(schedule.weekday, language)} ${clockLabel(schedule.hour, schedule.minute)}`;
}

export default FileWatcherPage;
