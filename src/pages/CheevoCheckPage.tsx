import { DialogButton, PanelSection, PanelSectionRow, SliderField } from "@decky/ui";
import { Fragment, useEffect, useState, type ReactNode } from "react";

import { BackButton } from "../components/ui/BackButton";
import { BottomFocusAnchor } from "../components/ui/BottomFocusAnchor";
import { CollapseChevron } from "../components/ui/CollapseChevron";
import { ConfirmRow } from "../components/ui/ConfirmRow";
import { FocusableItem } from "../components/ui/FocusableItem";
import { InfoText, helpDescription } from "../components/ui/InfoText";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { ProgressBar } from "../components/ui/ProgressBar";
import { SectionTitle } from "../components/ui/SectionTitle";
import { TextViewerModal } from "../components/ui/TextViewerModal";
import { ToggleRow } from "../components/ui/ToggleRow";
import { showManagedModal } from "../utils/modalRegistry";
import { fileWatcherSpeedLabel } from "../utils/fileWatcher";
import { useCheevoCheck } from "../components/cheevocheck/CheevoCheckContext";
import { t, type LanguageCode } from "../locales";
import type {
    ButtonSpacing,
    CheevoCheckBrowseRow,
    CheevoCheckGame,
    CheevoCheckListKind,
    CheevoCheckResults,
    CheevoCheckRow,
    CheevoCheckScanProgress,
    CheevoCheckVerifyBucket,
    CheevoCheckVerifyResults,
    CheevoCheckVerifyRow,
    CheevoCheckVerifySpeed,
    ViewKey
} from "../types";
import { achievementGreen, bodyTextStyle, errorRed, faultViolet, regularButtonSpacingStyle, warnAmber } from "../utils/style";

const BACK_BUTTON_SCROLL_MARGIN_PX = 24;

const LOADING_SPINNER_DELAY_MS = 500;

const PARKED_ARTICLE = /^(.*?), (The|A|An)( - .*)?$/;

const STALE_DATA_DAYS = 7;

const SPEED_ORDER: CheevoCheckVerifySpeed[] = ["gentle", "balanced", "full"];

const VERIFY_BUCKETS: Array<{
    bucket: CheevoCheckVerifyBucket;
    label: string;
    help: string;
    colour: string;
}> = [
    { bucket: "verified", label: "Verified", help: "help_cheevo_check_verified", colour: achievementGreen },
    { bucket: "raFull", label: "Recognised — Full Hash", help: "help_cheevo_check_ra_full", colour: achievementGreen },
    { bucket: "raPartial", label: "Recognised — Partial Hash", help: "help_cheevo_check_ra_partial", colour: warnAmber },
    { bucket: "mismatch", label: "Doesn't Match Its Name", help: "help_cheevo_check_mismatch", colour: errorRed },
    { bucket: "unrecognised", label: "Not Recognised", help: "help_cheevo_check_unrecognised", colour: warnAmber },
    { bucket: "unverifiable", label: "Can't Verify", help: "help_cheevo_check_unverifiable", colour: faultViolet }
];

function SectionCollapseToggle(props: {
    collapsed: boolean;
    focusKey: string;
    onToggle: (next: boolean) => void;
}) {
    return (
        <PanelSectionRow>
            <div data-focus-key={props.focusKey} style={{ display: "flex", width: "100%", marginTop: "8px" }}>
                <DialogButton
                    onClick={() => props.onToggle(!props.collapsed)}
                    style={{
                        minWidth: 0,
                        minHeight: 0,
                        width: "100%",
                        height: "16px",
                        padding: "0",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                    }}
                >
                    <CollapseChevron collapsed={props.collapsed} />
                </DialogButton>
            </div>
        </PanelSectionRow>
    );
}

type CheevoCheckPageState = {
    view: ViewKey;
    focusScopeResetToken: number;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;

    batterySaver: boolean;
    mouseKeyboardMode: boolean;
};

type CheevoCheckPageActions = {
    onBack: () => void | Promise<void>;
    onHome: () => void | Promise<void>;
    onToggleBatterySaver: (next: boolean) => void | Promise<void>;
    onBrowse: (kind: CheevoCheckListKind, rows: CheevoCheckBrowseRow[]) => void;
};

type CheevoCheckPageProps = {
    state: CheevoCheckPageState;
    actions: CheevoCheckPageActions;
};

function CheevoCheckPage(props: CheevoCheckPageProps) {
    const { state, actions } = props;
    const { language } = state;

    const {
        state: cheevo,
        settings,
        loaded,
        starting,
        cancelling,
        savingReport,
        startScan,
        cancelScan,
        saveReport,
        clearHashCache
    } = useCheevoCheck();
    const [showLoading, setShowLoading] = useState(false);

    useEffect(() => {
        if (loaded) {
            setShowLoading(false);
            return;
        }
        const timer = window.setTimeout(() => setShowLoading(true), LOADING_SPINNER_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [loaded]);

    if (state.view !== "cheevoCheck") {
        return null;
    }

    const running = Boolean(cheevo?.running);
    const results = cheevo?.results ?? null;
    const progress = cheevo?.progress ?? null;
    const busy = running || starting;
    const unsupportedRows = results?.unsupported ?? [];
    const noAchievementRows = results?.noAchievements ?? [];
    const failedRows = results?.failed ?? [];
    const supportedGames = results?.supportedGames ?? [];
    const missingConsoles = results?.missingConsoles ?? [];
    const verify = cheevo?.verifyResults ?? null;
    const canScanOffline = Boolean(cheevo?.dataAvailable) && !busy;

    function openGuide() {
        showManagedModal((close) => (
            <TextViewerModal
                language={language}
                mouseKeyboardMode={state.mouseKeyboardMode}
                title={t(language, "Cheevo Check Guide")}
                documentName="cheevoCheck"
                close={close}
            />
        ));
    }

    function extendedInfo(row: CheevoCheckRow): string[] {
        const lines: string[] = [];
        if (row.innerName) {
            lines.push(t(language, "In the archive: {{name}}", { name: row.innerName }));
        }
        if (row.raHash) {
            lines.push(t(language, "Hash: {{hash}}", { hash: row.raHash }));
        }
        return lines;
    }

    function browseGames(kind: CheevoCheckListKind, games: CheevoCheckGame[]) {
        actions.onBrowse(kind, games.map((game) => ({
            key: `${game.systemId}:${game.gameId}`,
            system: game.system,
            systemId: game.systemId,
            title: game.title,
            detail: t(language, "{{count}} achievements", { count: game.achievements }),
            note: "",
            gameId: game.gameId,
            imageIcon: game.imageIcon ?? "",
            searchTitle: ""
        })));
    }

    function browseRows(kind: CheevoCheckListKind, rows: CheevoCheckRow[]) {
        const searchable = kind === "unsupported" || kind === "failed" || kind === "archiveMismatch";
        actions.onBrowse(kind, rows.map((row, index) => ({
            key: `${row.path}:${index}`,
            system: row.system,
            systemId: row.systemId,
            title: row.title || row.file,
            detail: row.title ? row.file : "",
            note: row.reason ? t(language, failReasonKey(row.reason)) : "",
            gameId: row.gameId ?? 0,
            imageIcon: row.imageIcon ?? "",
            searchTitle: searchable ? titleFromFilename(row.file) : "",
            extra: kind === "archiveMismatch" ? extendedInfo(row) : []
        })));
    }

    const archiveMismatches: CheevoCheckRow[] = (() => {
        const out = [
            ...supportedGames.flatMap((game) => (game.files ?? []).map((file) => ({
                ...file, title: file.title || game.title, gameId: file.gameId ?? game.gameId,
                imageIcon: file.imageIcon ?? game.imageIcon
            }))),
            ...noAchievementRows,
            ...unsupportedRows,
            ...failedRows
        ].filter((row) => Boolean(row.innerName));
        return out.sort((a, b) => (
            a.system.localeCompare(b.system) || a.file.toLowerCase().localeCompare(b.file.toLowerCase())
        ));
    })();

    function browseVerify(bucket: CheevoCheckVerifyBucket, rows: CheevoCheckVerifyRow[]) {
        const searchable = bucket !== "raFull" && bucket !== "raPartial";
        actions.onBrowse(bucket, rows.map((row, index) => ({
            key: `${row.path}:${index}`,
            system: row.system,
            systemId: row.systemId,
            title: row.matchedName || row.file,
            detail: row.matchedName ? row.file : "",
            note: verifyNote(row, language),
            gameId: 0,
            imageIcon: "",
            searchTitle: searchable ? titleFromFilename(row.file) : ""
        })));
    }

    return (
        <PanelSection key={`cheevoCheck:view:${state.focusScopeResetToken}`}>
            <PageNavStrip
                title={t(language, "Cheevo Check")}
                buttonSpacing={state.buttonSpacing}
                onHome={actions.onHome}
            />

            <BackButton
                label={t(language, "Back")}
                focusKey="cheevocheck:back"
                navAutoFocus
                buttonSpacing={state.buttonSpacing}
                onClick={actions.onBack}
                scrollMarginTop={BACK_BUTTON_SCROLL_MARGIN_PX}
            />

            {busy && (
                <PanelSectionRow>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "12px" }}>
                        <InlineSpinner label={t(language, "Checking your library...")} bold />
                        <div style={bodyTextStyle()}>
                            {t(language, "This can take a while on a big library. You can leave this page or close the panel — we'll let you know when it's done.")}
                        </div>
                        <ProgressBar fraction={scanFraction(progress)} />
                        {progress && <div style={bodyTextStyle()}>{phaseLine(progress, language)}</div>}
                    </div>
                </PanelSectionRow>
            )}

            {
}
            {busy && settings.verifyHashes && (
                <VerifySpeedSlider
                    language={language}
                    speed={settings.verifySpeed}
                    onSaveSpeed={settings.saveVerifySpeed}
                    marginTop="6px"
                />
            )}

            {
}
            {running && (
                <PanelSectionRow>
                    <FocusableItem
                        focusKey="cheevocheck:cancel"
                        outerStyle={{ ...regularButtonSpacingStyle(state.buttonSpacing), marginTop: "12px" }}
                        disabled={cancelling}
                        onClick={cancelScan}
                        bottomSeparator="none"
                    >
                        {t(language, cancelling ? "Stopping..." : "Cancel Scan")}
                    </FocusableItem>
                </PanelSectionRow>
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
                    <SectionTitle label={t(language, "Scan")} />
                    <SectionCollapseToggle
                        collapsed={settings.scanCollapsed}
                        focusKey="cheevocheck:scan:collapse"
                        onToggle={settings.saveScanCollapsed}
                    />
                    {!settings.scanCollapsed && (
                    <>

                    <PanelSectionRow>
                        <div
                            style={{
                                ...bodyTextStyle(),
                                color: warnAmber,
                                opacity: 1
                            }}
                        >
                            {t(language, "help_cheevo_check_dolphin")}
                        </div>
                    </PanelSectionRow>

                    <PanelSectionRow>
                        <FocusableItem
                            focusKey="cheevocheck:guide"
                            outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                            onClick={openGuide}
                            bottomSeparator="standard"
                        >
                            {t(language, "Guide")}
                        </FocusableItem>
                    </PanelSectionRow>

                    {!results && (
                        <PanelSectionRow>
                            <div style={{ ...bodyTextStyle(), marginTop: "12px" }}>
                                {t(language, "Nothing checked yet. Press Scan to pick your ROM folder.")}
                            </div>
                        </PanelSectionRow>
                    )}

                    {results && (
                        <>
                            <PanelSectionRow>
                                <div style={{ ...bodyTextStyle(), color: achievementGreen, opacity: 1, marginTop: "12px" }}>
                                    {t(language, "Checked on {{date}}.", {
                                        date: formatWhen(results.completedAt, language)
                                    })}
                                </div>
                            </PanelSectionRow>
                            {results.offline && isStale(results.dataBuiltAt) && (
                                <PanelSectionRow>
                                    <InfoText>
                                        {t(language, "Checked against RetroAchievements data saved {{count}} days ago.", {
                                            count: daysSince(results.dataBuiltAt)
                                        })}
                                    </InfoText>
                                </PanelSectionRow>
                            )}
                            {missingConsoles.length > 0 && (
                                <PanelSectionRow>
                                    <InfoText>
                                        {t(language, "No saved data for {{systems}} — run a Scan to include them.", {
                                            systems: missingConsoles.join(", ")
                                        })}
                                    </InfoText>
                                </PanelSectionRow>
                            )}
                            {
}
                            {results.skippedDolphin > 0 && (
                                <PanelSectionRow>
                                    <InfoText>
                                        {t(language, "Skipped {{count}} GameCube or Wii files because Dolphin isn't installed.", {
                                            count: results.skippedDolphin
                                        })}
                                    </InfoText>
                                </PanelSectionRow>
                            )}
                        </>
                    )}

                    {
}
                    <PanelSectionRow>
                        <FocusableItem
                            focusKey="cheevocheck:scan"
                            outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                            onClick={() => startScan(false)}
                            bottomSeparator="standard"
                            help={t(language, "help_cheevo_check_scan")}
                        >
                            {t(language, "Scan")}
                        </FocusableItem>
                    </PanelSectionRow>
                    <PanelSectionRow>
                        <FocusableItem
                            focusKey="cheevocheck:offline-scan"
                            outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                            disabled={!canScanOffline}
                            onClick={() => startScan(true)}
                            bottomSeparator="standard"
                            help={t(language, "help_cheevo_check_offline_scan")}
                        >
                            {t(language, "Offline Scan")}
                        </FocusableItem>
                    </PanelSectionRow>
                    {results && results.scanned > 0 && (
                        <>
                            <PanelSectionRow>
                                <FocusableItem
                                    focusKey="cheevocheck:save-report"
                                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                    disabled={savingReport}
                                    onClick={() => void saveReport(buildReport(results, verify, archiveMismatches, language))}
                                    bottomSeparator="standard"
                                    help={t(language, "help_cheevo_check_save_report")}
                                >
                                    {t(language, savingReport ? "Saving report..." : "Save Report")}
                                </FocusableItem>
                            </PanelSectionRow>
                        </>
                    )}

                    </>
                    )}

                    {results && (
                        <>
                            <SectionTitle label={t(language, "RA Match Results")} />
                            <SectionCollapseToggle
                                collapsed={settings.resultsCollapsed}
                                focusKey="cheevocheck:results:collapse"
                                onToggle={settings.saveResultsCollapsed}
                            />
                            {!settings.resultsCollapsed && (
                            <>
                            <PanelSectionRow>
                                <div
                                    style={{
                                        width: "100%",
                                        display: "grid",
                                        gridTemplateColumns: "1fr auto",
                                        rowGap: "6px",
                                        columnGap: "10px",
                                        alignItems: "center",
                                        marginTop: "10px"
                                    }}
                                >
                                    <div style={bodyTextStyle()}>{t(language, "Supported Games")}</div>
                                    <div style={{ ...bodyTextStyle(), color: achievementGreen, opacity: 1, fontWeight: 700 }}>
                                        {supportedGames.length}
                                    </div>
                                    <div style={bodyTextStyle()}>{t(language, "No Achievements")}</div>
                                    <div style={{ ...bodyTextStyle(), color: warnAmber, opacity: 1, fontWeight: 700 }}>
                                        {noAchievementRows.length}
                                    </div>
                                    <div style={bodyTextStyle()}>{t(language, "Unsupported Files")}</div>
                                    <div style={{ ...bodyTextStyle(), color: errorRed, opacity: 1, fontWeight: 700 }}>
                                        {unsupportedRows.length}
                                    </div>
                                    <div style={bodyTextStyle()}>{t(language, "Couldn't Scan")}</div>
                                    <div style={{ ...bodyTextStyle(), color: faultViolet, opacity: 1, fontWeight: 700 }}>
                                        {failedRows.length}
                                    </div>
                                </div>
                            </PanelSectionRow>

                            <PanelSectionRow>
                                <FocusableItem
                                    focusKey="cheevocheck:supported"
                                    outerStyle={{ ...regularButtonSpacingStyle(state.buttonSpacing), marginTop: "10px" }}
                                    disabled={supportedGames.length === 0}
                                    onClick={() => browseGames("supported", supportedGames)}
                                    bottomSeparator="standard"
                                    help={t(language, "help_cheevo_check_supported")}
                                >
                                    {t(language, "Supported Games ({{count}})", { count: supportedGames.length })}
                                </FocusableItem>
                            </PanelSectionRow>
                            <PanelSectionRow>
                                <FocusableItem
                                    focusKey="cheevocheck:unsupported"
                                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                    disabled={unsupportedRows.length === 0}
                                    onClick={() => browseRows("unsupported", unsupportedRows)}
                                    bottomSeparator="standard"
                                    help={t(language, "help_cheevo_check_unsupported")}
                                >
                                    {t(language, "Unsupported Files ({{count}})", { count: unsupportedRows.length })}
                                </FocusableItem>
                            </PanelSectionRow>
                            <PanelSectionRow>
                                <FocusableItem
                                    focusKey="cheevocheck:noachievements"
                                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                    disabled={noAchievementRows.length === 0}
                                    onClick={() => browseRows("noAchievements", noAchievementRows)}
                                    bottomSeparator="standard"
                                    help={t(language, "help_cheevo_check_no_achievements")}
                                >
                                    {t(language, "No Achievements ({{count}})", { count: noAchievementRows.length })}
                                </FocusableItem>
                            </PanelSectionRow>
                            {failedRows.length > 0 && (
                                <>
                                    <PanelSectionRow>
                                        <FocusableItem
                                            focusKey="cheevocheck:failed"
                                            outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                            onClick={() => browseRows("failed", failedRows)}
                                            bottomSeparator="standard"
                                            help={t(language, "help_cheevo_check_failed")}
                                        >
                                            {t(language, "Couldn't Scan ({{count}})", { count: failedRows.length })}
                                        </FocusableItem>
                                    </PanelSectionRow>
                                </>
                            )}

                            {
}
                            {archiveMismatches.length > 0 && (
                                <>
                                    <PanelSectionRow>
                                        <FocusableItem
                                            focusKey="cheevocheck:archivemismatch"
                                            outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                            onClick={() => browseRows("archiveMismatch", archiveMismatches)}
                                            bottomSeparator="standard"
                                            help={t(language, "help_cheevo_check_archive_mismatch")}
                                        >
                                            {t(language, "Archive Name Mismatches ({{count}})", { count: archiveMismatches.length })}
                                        </FocusableItem>
                                    </PanelSectionRow>
                                </>
                            )}

                            </>
                            )}

                            {
}
                            {verify && (
                                <>
                                    <SectionTitle label={t(language, "Dump Verification")} />
                                    <SectionCollapseToggle
                                        collapsed={settings.verifyCollapsed}
                                        focusKey="cheevocheck:verify:collapse"
                                        onToggle={settings.saveVerifyCollapsed}
                                    />
                                    {!settings.verifyCollapsed && (
                                    <>
                                    <PanelSectionRow>
                                        <div
                                            style={{
                                                width: "100%",
                                                display: "grid",
                                                gridTemplateColumns: "1fr auto",
                                                rowGap: "6px",
                                                columnGap: "10px",
                                                alignItems: "center",
                                                marginTop: "10px"
                                            }}
                                        >
                                            {VERIFY_BUCKETS.map((entry) => (
                                                <Fragment key={entry.bucket}>
                                                    <div style={bodyTextStyle()}>{t(language, entry.label)}</div>
                                                    <div style={{ ...bodyTextStyle(), color: entry.colour, opacity: 1, fontWeight: 700 }}>
                                                        {verifyRows(verify, entry.bucket).length}
                                                    </div>
                                                </Fragment>
                                            ))}
                                        </div>
                                    </PanelSectionRow>

                                    {VERIFY_BUCKETS.map((entry, index) => {
                                        const rows = verifyRows(verify, entry.bucket);
                                        return (
                                            <Fragment key={entry.bucket}>
                                                <PanelSectionRow>
                                                    <FocusableItem
                                                        focusKey={`cheevocheck:verify:${entry.bucket}`}
                                                        outerStyle={index === 0
                                                            ? { ...regularButtonSpacingStyle(state.buttonSpacing), marginTop: "10px" }
                                                            : regularButtonSpacingStyle(state.buttonSpacing)}
                                                        disabled={rows.length === 0}
                                                        onClick={() => browseVerify(entry.bucket, rows)}
                                                        bottomSeparator="standard"
                                                        help={t(language, entry.help)}
                                                    >
                                                        {t(language, "{{label}} ({{count}})", {
                                                            label: t(language, entry.label),
                                                            count: rows.length
                                                        })}
                                                    </FocusableItem>
                                                </PanelSectionRow>
                                            </Fragment>
                                        );
                                    })}

                                    {
}
                                    {results.completedAt > verify.verifiedAt && (
                                        <PanelSectionRow>
                                            <InfoText>
                                                {t(language, "A later scan has run since this verification.")}
                                            </InfoText>
                                        </PanelSectionRow>
                                    )}
                                    </>
                                    )}
                                </>
                            )}

                        </>
                    )}

                    {
}
                    <SectionTitle label={t(language, "Options")} />
                    <SectionCollapseToggle
                        collapsed={settings.optionsCollapsed}
                        focusKey="cheevocheck:options:collapse"
                        onToggle={settings.saveOptionsCollapsed}
                    />
                    {!settings.optionsCollapsed && (
                    <>

                    <PanelSectionRow>
                        <ToggleRow
                            label={t(language, "Temporarily Disable Services")}
                            value={state.batterySaver}
                            onChange={actions.onToggleBatterySaver}
                            outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                            bottomSeparator="standard"
                            help={t(language, "help_cheevo_check_pause_services")}
                        />
                    </PanelSectionRow>
                    <PanelSectionRow>
                        <ToggleRow
                            label={t(language, "Cache Local Hashes")}
                            value={settings.cacheHashes}
                            onChange={settings.saveCacheHashes}
                            outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                            bottomSeparator="standard"
                            help={t(language, "help_cheevo_check_cache_hashes")}
                        />
                    </PanelSectionRow>
                    <PanelSectionRow>
                        <ToggleRow
                            label={t(language, "Extract to RAM")}
                            value={settings.extractToRam}
                            onChange={settings.saveExtractToRam}
                            outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                            bottomSeparator="standard"
                            help={t(language, "help_cheevo_check_extract_to_ram")}
                        />
                    </PanelSectionRow>
                    <PanelSectionRow>
                        <ToggleRow
                            label={t(language, "Verify Dump")}
                            value={settings.verifyHashes}
                            onChange={settings.saveVerifyHashes}
                            outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                            bottomSeparator="standard"
                            help={t(language, "help_cheevo_check_verify_hashes")}
                        />
                    </PanelSectionRow>
                    {settings.verifyHashes && (
                        <>
                            <VerifySpeedSlider
                                language={language}
                                speed={settings.verifySpeed}
                                onSaveSpeed={settings.saveVerifySpeed}
                                help={t(language, "help_cheevo_check_verify_speed")}
                                separator
                            />
                            <VerifyControls
                                language={language}
                                extractToRam={settings.extractToRam}
                                skipDiscVerify={settings.skipDiscVerify}
                                skipCartVerify={settings.skipCartVerify}
                                buttonSpacing={state.buttonSpacing}
                                onToggleExtractToRam={settings.saveExtractToRam}
                                onToggleSkipDiscVerify={settings.saveSkipDiscVerify}
                                onToggleSkipCartVerify={settings.saveSkipCartVerify}
                            />
                        </>
                    )}

                    {
}
                    <PanelSectionRow>
                        <ConfirmRow
                            focusKey="cheevocheck:clear-cache"
                            idleLabel={t(language, "Clear Local Cache")}
                            armedLabel={t(language, "Press again to clear")}
                            disabled={!cheevo?.hasLocalHashCache}
                            buttonSpacing={state.buttonSpacing}
                            bottomSeparator="none"
                            onConfirm={clearHashCache}
                            help={t(language, "help_cheevo_check_clear_cache")}
                        />
                    </PanelSectionRow>

                    </>
                    )}

                    {
}
                    <BottomFocusAnchor focusKey="cheevocheck:bottom:anchor" />
                </>
            )}
        </PanelSection>
    );
}

function VerifySpeedSlider(props: {
    language: LanguageCode;
    speed: CheevoCheckVerifySpeed;
    onSaveSpeed: (value: CheevoCheckVerifySpeed) => void | Promise<void>;
    marginTop?: string;
    help?: ReactNode;
    separator?: boolean;
}) {
    const { language } = props;
    return (
        <PanelSectionRow>
            <div data-focus-key="cheevoCheck:verifySpeed" style={{ marginTop: props.marginTop }}>
                <SliderField
                    label={t(language, "Speed: {{speed}}", { speed: fileWatcherSpeedLabel(props.speed, language) })}
                    value={Math.max(0, SPEED_ORDER.indexOf(props.speed))}
                    min={0}
                    max={SPEED_ORDER.length - 1}
                    step={1}
                    notchCount={SPEED_ORDER.length}
                    notchTicksVisible
                    layout="below"
                    bottomSeparator={props.separator ? "standard" : "none"}
                    description={helpDescription(props.help)}
                    onChange={(index) => void props.onSaveSpeed(SPEED_ORDER[index] ?? "full")}
                />
            </div>
        </PanelSectionRow>
    );
}

function VerifyControls(props: {
    language: LanguageCode;
    extractToRam: boolean;
    skipDiscVerify: boolean;
    skipCartVerify: boolean;
    buttonSpacing: ButtonSpacing;
    onToggleExtractToRam: (value: boolean) => void | Promise<void>;
    onToggleSkipDiscVerify: (value: boolean) => void | Promise<void>;
    onToggleSkipCartVerify: (value: boolean) => void | Promise<void>;
}) {
    const { language } = props;
    return (
        <>
            <PanelSectionRow>
                <ToggleRow
                    label={t(language, "Ignore Discs When Verifying Dump")}
                    value={props.skipDiscVerify}
                    onChange={props.onToggleSkipDiscVerify}
                    outerStyle={regularButtonSpacingStyle(props.buttonSpacing)}
                    bottomSeparator="standard"
                    help={t(language, "help_cheevo_check_skip_disc_verify")}
                />
            </PanelSectionRow>
            <PanelSectionRow>
                <ToggleRow
                    label={t(language, "Ignore Large Carts When Verifying Dump")}
                    value={props.skipCartVerify}
                    onChange={props.onToggleSkipCartVerify}
                    outerStyle={regularButtonSpacingStyle(props.buttonSpacing)}
                    bottomSeparator="standard"
                    help={t(language, "help_cheevo_check_skip_cart_verify")}
                />
            </PanelSectionRow>
            <PanelSectionRow>
                <ToggleRow
                    label={t(language, "Extract to RAM")}
                    value={props.extractToRam}
                    onChange={props.onToggleExtractToRam}
                    outerStyle={regularButtonSpacingStyle(props.buttonSpacing)}
                    bottomSeparator="standard"
                    help={t(language, "help_cheevo_check_verify_ram")}
                />
            </PanelSectionRow>
        </>
    );
}

function verifyRows(
    results: CheevoCheckVerifyResults,
    bucket: CheevoCheckVerifyBucket
): CheevoCheckVerifyRow[] {
    const rows = results[bucket];
    return Array.isArray(rows) ? rows : [];
}

function groupBySystem<T extends { system: string }>(rows: T[]): Array<[string, T[]]> {
    const groups = new Map<string, T[]>();
    for (const row of rows) {
        const key = row.system || "?";
        const bucket = groups.get(key);
        if (bucket) {
            bucket.push(row);
        }
        else {
            groups.set(key, [row]);
        }
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function buildReport(
    results: CheevoCheckResults,
    verify: CheevoCheckVerifyResults | null,
    archiveMismatches: CheevoCheckRow[],
    language: LanguageCode
): string {
    const lines: string[] = [];
    const rule = "=".repeat(72);

    lines.push(t(language, "Cheevo Check Report"));
    lines.push(rule);
    lines.push("");
    lines.push(t(language, "Folder: {{path}}", { path: results.root }));
    lines.push(t(language, "Checked {{count}} files against RA on {{date}}.", {
        count: results.scanned,
        date: formatWhen(results.completedAt, language)
    }));
    if (verify) {
        lines.push(t(language, "Checked {{count}} files against dump lists on {{date}}.", {
            count: verify.scanned,
            date: formatWhen(verify.verifiedAt, language)
        }));
    }
    lines.push("");
    lines.push(`${t(language, "RA Check")}`);
    lines.push(`${t(language, "Unsupported Files")}: ${results.unsupported.length}`);
    lines.push(`${t(language, "No Achievements")}: ${results.noAchievements.length}`);
    lines.push(`${t(language, "Couldn't Scan")}: ${results.failed.length}`);
    lines.push(`${t(language, "Archive Name Mismatches")}: ${archiveMismatches.length}`);
    lines.push(`${t(language, "Supported Games")}: ${results.supportedGames.length}`);
    if (verify) {
        lines.push("");
        lines.push(`${t(language, "Dump Check")}`);
        for (const entry of VERIFY_BUCKETS) {
            lines.push(`${t(language, entry.label)}: ${verifyRows(verify, entry.bucket).length}`);
        }
    }

    function section(heading: string, help: string, body: string[]) {
        lines.push("");
        lines.push(rule);
        lines.push(heading);
        lines.push(rule);
        lines.push(t(language, help));
        lines.push("");
        if (body.length === 0) {
            lines.push(`  ${t(language, "Nothing here.")}`);
            return;
        }
        lines.push(body.join("\n\n"));
    }

    function fileRows(rows: CheevoCheckRow[], withReason: boolean): string[] {
        return groupBySystem(rows).map(([system, group]) => {
            const block = [`  ${system}`];
            for (const row of group) {
                block.push(`    ${row.title || row.file}`);
                if (row.title) {
                    block.push(`      ${row.file}`);
                }
                if (withReason && row.reason) {
                    block.push(`      ${t(language, failReasonKey(row.reason))}`);
                }
            }
            return block.join("\n");
        });
    }

    section(t(language, "Unsupported Files"), "help_cheevo_check_unsupported",
        fileRows(results.unsupported, false));
    section(t(language, "No Achievements"), "help_cheevo_check_no_achievements",
        fileRows(results.noAchievements, false));
    section(t(language, "Couldn't Scan"), "help_cheevo_check_failed",
        fileRows(results.failed, true));

    section(t(language, "Archive Name Mismatches"), "help_cheevo_check_archive_mismatch",
        groupBySystem(archiveMismatches).map(([system, group]) => {
            const block = [`  ${system}`];
            for (const row of group) {
                block.push(`    ${row.file}`);
                if (row.innerName) {
                    block.push(`      ${t(language, "In the archive: {{name}}", { name: row.innerName })}`);
                }
            }
            return block.join("\n");
        }));

    const supported = groupBySystem(results.supportedGames).map(([system, group]) => {
        const block = [`  ${system}`];
        for (const game of group) {
            block.push(`    ${game.title}`);
            block.push(`      ${t(language, "{{count}} achievements", { count: game.achievements })}`);
        }
        return block.join("\n");
    });
    section(t(language, "Supported Games"), "report_cheevo_check_supported", supported);

    if (verify) {
        for (const entry of VERIFY_BUCKETS) {
            const rows = groupBySystem(verifyRows(verify, entry.bucket)).map(([system, group]) => {
                const block = [`  ${system}`];
                for (const row of group) {
                    block.push(`    ${row.file}`);
                    if (row.matchedName) {
                        block.push(`      ${t(language, "Listed as: {{name}}", { name: row.matchedName })}`);
                    }
                    if (row.crc && row.datCrc) {
                        block.push(`      ${t(language, "Checksum: {{crc}} — the listed dump has {{datCrc}}", {
                            crc: row.crc,
                            datCrc: row.datCrc
                        })}`);
                    }
                    const note = verifyNote(row, language);
                    if (note) {
                        block.push(`      ${note}`);
                    }
                    const problems = row.problems ?? [];
                    if (problems.length > 0) {
                        block.push(`      ${t(language, "Tool output:")}`);
                        for (const line of problems) {
                            block.push(`        ${line}`);
                        }
                    }
                }
                return block.join("\n");
            });
            section(t(language, entry.label), entry.help, rows);
        }
    }

    return lines.join("\n").trimEnd() + "\n";
}

function scanFraction(progress: CheevoCheckScanProgress | null): number | null {
    if (!progress || progress.total <= 0) {
        return null;
    }
    return progress.done / progress.total;
}

function phaseLine(progress: CheevoCheckScanProgress, language: LanguageCode): string {
    if (progress.phase === "fetch") {
        return t(language, "Downloading achievement data...");
    }
    if (progress.phase === "hash") {
        return t(language, "RA Check: {{done}} of {{total}} files", {
            done: progress.done,
            total: progress.total
        });
    }
    if (progress.phase === "verify") {
        return t(language, "Dump Check: {{done}} of {{total}} files", {
            done: progress.done,
            total: progress.total
        });
    }
    return t(language, "Finding your files...");
}

function titleFromFilename(file: string): string {
    const dot = file.lastIndexOf(".");
    const stem = dot > 0 ? file.slice(0, dot) : file;
    const cleaned = stem
        .replace(/[([][^)\]]*[)\]]/g, " ")
        .replace(/_+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!cleaned) {
        return stem.trim();
    }

    const parked = cleaned.match(PARKED_ARTICLE);
    if (parked) {
        return `${parked[2]} ${parked[1]}${parked[3] ?? ""}`;
    }
    return cleaned;
}

function daysSince(timestamp: number): number {
    if (!timestamp) {
        return 0;
    }
    return Math.floor((Date.now() / 1000 - timestamp) / 86400);
}

function isStale(timestamp: number): boolean {
    return Boolean(timestamp) && daysSince(timestamp) >= STALE_DATA_DAYS;
}

function formatWhen(timestamp: number, language: LanguageCode): string {
    const localeTag = language === "en" ? undefined : language;
    return new Date(timestamp * 1000).toLocaleDateString(localeTag);
}

const PATCHED_NAME = /t[-+]eng|translat|patch|romhack|\bhack\b|[([]english/i;

function verifyNote(row: CheevoCheckVerifyRow, language: LanguageCode): string {
    if (row.reason === "trimmed" && PATCHED_NAME.test(row.file)) {
        return t(language, "The name says this has been patched or translated, which no dump list carries. It's also trimmed — the blank padding at the end was stripped to save room — so it could never have matched one anyway. Both are normal and neither means anything is wrong.");
    }
    if (row.bucket === "raFull" && row.datCrc) {
        return t(language, "No-Intro, Redump and TOSEC don't list this exact copy — a patch or a translation usually — but RetroAchievements hashes this system whole and knows every byte of it. Nothing is wrong with the file.");
    }
    if (row.headerDiff) {
        return t(language, "RetroAchievements hashes everything after the small header on the front of these files, and it recognises this copy — so the game data is in good condition and recognised. The difference from the published dump is in that header, which carries mapper flags and padding rather than anything the game uses.");
    }
    if (row.bucket === "raPartial" && row.datCrc) {
        return t(language, "This file couldn't be verified against the No-Intro, Redump or TOSEC hashes, but part of the hash is recognised by RetroAchievements. This file is most likely okay — probably a patch or a different dump that RA accepts.");
    }
    if (row.reason) {
        return t(language, verifyReasonKey(row.reason));
    }
    if (row.trimmed) {
        return t(language, "Also trimmed — the blank padding at the end was stripped to save room. That's why it isn't in No-Intro, and it has no effect on the game.");
    }
    if (row.selfCheck === "failed") {
        return t(language, "The content inside this doesn't match the checksums the dump carries for itself. That's a real fault — something was damaged, or the transfer never finished.");
    }
    if (row.selfCheck === "passed" && row.selfCheckCount) {
        return t(language, "None of No-Intro, Redump or TOSEC covers this system, but the dump carries its own checksums and every content file inside it matches. Nothing is wrong with this file.");
    }
    if (row.selfCheck === "passed" && row.trackOnly) {
        return t(language, "Every byte still matches this disc's own checksum, and the track Redump lists matches too.");
    }
    if (row.selfCheck === "passed") {
        return t(language, "Every byte still matches this disc's own checksum.");
    }
    return "";
}

function verifyReasonKey(reason: string): string {
    if (reason === "read_failed") {
        return "This file wouldn't read. That's a real fault rather than a mismatch.";
    }
    if (reason === "chd_extract_failed") {
        return "We couldn't unpack this disc. Usually damage, but some discs are built in a way our tool can't read, so it's worth trying another one before concluding anything.";
    }
    if (reason === "chd_no_match") {
        return "The disc unpacked fine and doesn't match Redump. That isn't evidence of damage — discs don't always rebuild byte for byte, and a patched disc looks the same from here.";
    }
    if (reason === "trimmed") {
        return "The blank padding at the end was stripped to save room. The game data is almost certainly fine, but No-Intro hashes the full cart dump, so a trimmed file can never match one.";
    }
    if (reason === "rebuilt") {
        return "This is a rebuilt copy — the same game, repacked smaller with the disc's empty space removed. Very common, and it plays exactly the same, but Redump lists the original full-size dump so a rebuilt one can never match it.";
    }
    if (reason === "no_reference") {
        return "No-Intro, Redump and TOSEC don't cover this system, so there's nothing to check against. This says nothing about the file.";
    }
    if (reason === "no_single_rom") {
        return "This archive holds several game files and we couldn't tell which is the game, so we didn't guess.";
    }
    if (reason === "no_space") {
        return "Checking a disc needs temporary space about the size of the disc, and there wasn't enough free.";
    }
    if (reason === "discs_off") {
        return "Disc checking is turned off, so this one was left alone. Turn off Ignore Discs When Verifying Dump to include discs — it's the slow part of the check.";
    }
    if (reason === "carts_off") {
        return "Big cartridge image checking is turned off, so this one was left alone. Turn off Ignore Large Carts When Verifying Dump to include them.";
    }
    if (reason === "no_tool") {
        return "The tool that reads this kind of file wasn't available, so we couldn't check it.";
    }
    return "The signatures aren't the originals. That's normal for files kept outside a real console and says nothing about the game data, which checked out.";
}

function failReasonKey(reason: string): string {
    if (reason === "ambiguous") {
        return "This archive holds more than one game, so it was difficult to tell which to check.";
    }
    if (reason === "no_space") {
        return "Not enough free space to unpack this one. Free some up and scan again.";
    }
    if (reason === "archive") {
        return "We couldn't unpack this archive.";
    }
    return "Couldn't read this file. It may be a bad dump.";
}


export default CheevoCheckPage;
