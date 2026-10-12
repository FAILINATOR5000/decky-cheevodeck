import { Focusable, PanelSectionRow, SliderField } from "@decky/ui";
import { PanelSection } from "../components/ui/PanelSection";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { BackButton } from "../components/ui/BackButton";
import { BottomFocusAnchor } from "../components/ui/BottomFocusAnchor";
import { FocusableItem } from "../components/ui/FocusableItem";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { ProgressBar } from "../components/ui/ProgressBar";
import { SectionTitle } from "../components/ui/SectionTitle";
import { ToggleRow } from "../components/ui/ToggleRow";
import { DarkenScreenRow } from "../components/darken/DarkenScreenRow";
import { DirectoryCard, type DirectoryCardListProps } from "../components/filewatcher/DirectoryCard";
import { FileWatcherExclusionsModal } from "../components/pickers/FileWatcherExclusionsModal";
import { FileWatcherFindingsModal } from "../components/pickers/FileWatcherFindingsModal";
import { SchedulePickerModal } from "../components/pickers/SchedulePickerModal";
import { useSlidingWindow } from "../hooks/useSlidingWindow";
import { useWhenHeld } from "../hooks/useWhenHeld";
import { SlidingWindowRows } from "../components/ui/SlidingWindowRows";
import { useFocusClaim } from "../hooks/useFocusClaim";
import { FocusClaim } from "../components/ui/FocusClaim";
import { FocusTarget } from "../components/ui/FocusTarget";
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
import { textSize } from "../utils/scale";
import { subLandingAhead, usePageLanding } from "../focusRecords";

const BACK_BUTTON_SCROLL_MARGIN_PX = 24;

const LOADING_SPINNER_DELAY_MS = 500;

const SPEED_ORDER: FileWatcherSpeed[] = ["gentle", "balanced", "full"];

const CARD_FOCUS_PREFIX = "filewatcher:card:";

function cardFocusKey(root: FileWatcherRoot) {
    return `${CARD_FOCUS_PREFIX}${root.id}`;
}

const BUCKET_FOCUS_PREFIX = "fileWatcher:bucket:";

const STATIC_CLAIM_SLOT = -2;

const RESULTS_FALLBACK = ["fileWatcher:schedule"];

type FileWatcherPageState = {
    view: ViewKey;
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
    const [backClaimToken, setBackClaimToken] = useState(0);

    const activePass = watcher?.pass ?? null;
    const busy = Boolean(activePass) || starting;

    useEffect(() => {
        if (loaded) {
            setShowLoading(false);
            return;
        }
        const timer = window.setTimeout(() => setShowLoading(true), LOADING_SPINNER_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [loaded]);

    const roots = useMemo(() => sortWatchedRoots(watcher?.roots ?? [], language), [watcher?.roots, language]);

    const cardWindow = useSlidingWindow({
        items: roots,
        itemKey: (root) => String(root.id),
        focusKeyFor: cardFocusKey,
        windowId: "filewatcher:roots",
        heightScope: ["filewatcher:roots", language, textSize(12)].join("|"),
        dynamicLoading: state.dynamicAllGames,
        initialRows: state.dynamicInitialRows,
        rowStep: state.dynamicRowStep,
        prefetchDistance: state.dynamicPrefetchDistance,
        sentinelRootMarginPx: state.dynamicSentinelRootMargin,
        resetKey: "fileWatcher:roots",
        debugLabel: "filewatcher:roots"
    });
    const mountedRoots = cardWindow.mountedItems;
    const whenCardHeld = useWhenHeld(cardWindow, roots, cardFocusKey);

    usePageLanding({
        view: "fileWatcher",
        defaultKey: "fileWatcher:back",
        ready: loaded,
        holds: (key) => roots.some((root) => cardFocusKey(root) === key),
        open: (key) => cardWindow.openAt(key)
    });

    const openExclusionsRef = useRef(openExclusions);
    openExclusionsRef.current = openExclusions;
    const cardFocusRef = useRef(cardWindow.onItemFocus);
    cardFocusRef.current = cardWindow.onItemFocus;
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

    function startPassFromButton() {
        setBackClaimToken((token) => token + 1);
        return startPass();
    }

    function cancelPassFromButton() {
        setBackClaimToken((token) => token + 1);
        return cancelPass();
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
        const removedIndex = roots.findIndex((root) => root.id === rootId);
        const heir = roots[removedIndex + 1] ?? roots[removedIndex - 1];
        await removeRoot(rootId);
        if (!heir) {
            rowClaim.claimSlot(STATIC_CLAIM_SLOT);
            return;
        }
        whenCardHeld(cardFocusKey(heir), (slot) => rowClaim.claimSlot(slot), `${CARD_FOCUS_PREFIX}${rootId}`);
    }

    const scopeKey = `fileWatcher:${busy ? "scan" : "idle"}`;

    function claimAddDirectory(control: ReactNode): ReactNode {
        const claim = rowClaim.claim;
        if (!claim || claim.slotIndex !== STATIC_CLAIM_SLOT) {
            return control;
        }
        return (
            <FocusClaim token={claim.token} armed={claim.armed} onSpent={rowClaim.spend}>
                {control}
            </FocusClaim>
        );
    }

    const page = (
        <Focusable
            key={scopeKey}
            flow-children="column"
        >
            <PanelSection>
                <PageNavStrip
                    title={t(language, "File Watcher")}
                    buttonSpacing={state.buttonSpacing}
                    onHome={actions.onHome}
                />

                <BackButton
                    key={`back:${backClaimToken}`}
                    label={t(language, "Back")}
                    focusKey="fileWatcher:back"
                    navAutoFocus
                    reclaim={backClaimToken > 0}
                    standDown={subLandingAhead("fileWatcher", 0)}
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

                        <SectionTitle label={t(language, "Options")} />
                        <SpeedRow
                            language={language}
                            speed={settings.speed}
                            onSaveSpeed={settings.saveSpeed}
                        />
                        <DarkenScreenRow focusKey="fileWatcher:toggle:darkenScreen" language={language} buttonSpacing={state.buttonSpacing} />
                        <RunDuringGamesRow
                            language={language}
                            runDuringGames={settings.runDuringGames}
                            buttonSpacing={state.buttonSpacing}
                            onSaveRunDuringGames={settings.saveRunDuringGames}
                        />

                        {activePass && (
                            <PanelSectionRow>
                                <FocusableItem
                                    focusKey="fileWatcher:cancel"
                                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                    disabled={cancelling}
                                    onClick={cancelPassFromButton}
                                    bottomSeparator="none"
                                >
                                    {t(language, cancelling ? "Stopping..." : "Cancel Scan")}
                                </FocusableItem>
                            </PanelSectionRow>
                        )}
                    </>
                )}

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
                                onClick={startPassFromButton}
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
                                onClick={() => void saveReport()}
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
                                            focusKey={`${BUCKET_FOCUS_PREFIX}${bucket}`}
                                focusFallback={RESULTS_FALLBACK}
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

                        {(watcher?.roots ?? []).length > 0
                            && ((watcher?.excludedTotal ?? 0) > 0 || (watcher?.hasReport && counts)) && (
                            <>
                                {!(watcher?.hasReport && counts) && <SectionTitle label={t(language, "Results")} />}
                                <PanelSectionRow>
                                    <FocusableItem
                                        focusKey="fileWatcher:excluded"
                                    focusFallback={RESULTS_FALLBACK}
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
                        <SpeedRow
                            language={language}
                            speed={settings.speed}
                            onSaveSpeed={settings.saveSpeed}
                        />
                        <DarkenScreenRow focusKey="fileWatcher:toggle:darkenScreen" language={language} buttonSpacing={state.buttonSpacing} />
                        <RunDuringGamesRow
                            language={language}
                            runDuringGames={settings.runDuringGames}
                            buttonSpacing={state.buttonSpacing}
                            onSaveRunDuringGames={settings.saveRunDuringGames}
                        />

                        <SectionTitle label={t(language, "Setup")} />

                        <PanelSectionRow>
                            {claimAddDirectory(
                                <FocusableItem
                                    focusKey="fileWatcher:addDirectory"
                                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                    onClick={() => {
                                        void addRoot();
                                    }}
                                    bottomSeparator="standard"
                                    help={t(language, "help_file_watcher_add_directory")}
                                >
                                    {t(language, "Add Directory")}
                                </FocusableItem>
                            )}
                        </PanelSectionRow>
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
                                <SlidingWindowRows list={cardWindow}>
                                    {mountedRoots.map((root, index) => (
                                        <FocusClaim
                                            key={`fwcard:${root.id}`}
                                            token={rowClaim.claim?.slotIndex === cardWindow.start + index ? rowClaim.claim.token : 0}
                                            armed={Boolean(rowClaim.claim?.armed) && rowClaim.claim?.slotIndex === cardWindow.start + index}
                                            onSpent={rowClaim.spend}
                                        >
                                            <DirectoryCard
                                                root={root}
                                                fileCount={watcher?.rootStats?.[String(root.id)]?.files ?? 0}
                                                unreachable={skippedIds.has(root.id)}
                                                armed={armedRootId === root.id}
                                                index={cardWindow.start + index}
                                                list={cardList}
                                                onGamepadDirection={cardWindow.guardTopRow(cardWindow.start + index)}
                                            />
                                        </FocusClaim>
                                    ))}
                                </SlidingWindowRows>
                            </>
                        )}

                        <BottomFocusAnchor focusKey="fileWatcher:bottom:anchor" />
                    </>
                )}
            </PanelSection>
        </Focusable>
    );

    return page;
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
        return t(language, "Paused at {{percent}}% — Standby is on", { percent });
    }
    if (activePass.waitingFor === "startup") {
        return t(language, "Resuming Soon — {{percent}}%", { percent });
    }
    return t(language, "Paused at {{percent}}%", { percent });
}

function SpeedRow(props: {
    language: LanguageCode;
    speed: FileWatcherSpeed;
    onSaveSpeed: (value: FileWatcherSpeed) => void | Promise<void>;
}) {
    const { language } = props;
    return (
        <PanelSectionRow>
            <FocusTarget focusKey="fileWatcher:speed">
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
            </FocusTarget>
        </PanelSectionRow>
    );
}

function RunDuringGamesRow(props: {
    language: LanguageCode;
    runDuringGames: boolean;
    buttonSpacing: ButtonSpacing;
    onSaveRunDuringGames: (value: boolean) => void | Promise<void>;
}) {
    const { language } = props;
    return (
        <PanelSectionRow>
            <ToggleRow
                outerStyle={regularButtonSpacingStyle(props.buttonSpacing)}
                focusKey="fileWatcher:toggle:runDuringGames"
                label={t(language, "Run during games")}
                value={props.runDuringGames}
                onChange={props.onSaveRunDuringGames}
                help={t(language, "help_file_watcher_run_during_games")}
            />
        </PanelSectionRow>
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
