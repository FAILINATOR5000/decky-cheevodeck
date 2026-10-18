import { useMemo, useState } from "react";
import { DialogButton, Focusable, PanelSectionRow } from "@decky/ui";
// Font Awesome Free icons, CC BY 4.0. See ATTRIBUTIONS.md.
import { FaTrophy } from "react-icons/fa";
import { ActivityGrid, dayLabel, monthLabel, shadeStyle } from "../components/activity/ActivityGrid";
import { AchievementList } from "../components/achievements/AchievementList";
import { UnlockStamp } from "../components/achievements/UnlockStamp";
import { BackButton } from "../components/ui/BackButton";
import { ButtonHints } from "../components/ui/ButtonHints";
import { ErrorText } from "../components/ui/ErrorText";
import { FocusTarget } from "../components/ui/FocusTarget";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { PageHelpButton, PageNavStrip } from "../components/ui/PageNavStrip";
import { PanelSection } from "../components/ui/PanelSection";
import { landOnTop, pendingLandingKey, usePageLanding } from "../focusRecords";
import { useActivityController } from "../hooks/useActivityController";
import { localizeRuntimeText, t, type LanguageCode } from "../locales";
import type { AchievementRow, ActivityRow, ActivitySubject, ButtonSpacing, ControllerGlyphStyle, Payload, UiSize, ViewKey } from "../types";
import { unlockDateLabel } from "../utils/achievements";
import { formatInteger } from "../utils/format";
import { BUTTON_OPTIONS } from "../utils/gamepadButtons";
import { openExternalUrl } from "../utils/navigation";
import { playOkSound } from "../utils/navSound";
import { achievementUiMetrics, bodyTextStyle, smallTextStyle } from "../utils/style";

const GUIDE_URL = "https://github.com/FAILINATOR5000/decky-cheevodeck/blob/main/docs/tutorials/activity.md";
const CAPTION_MAX_FONT_SIZE = achievementUiMetrics("xlarge").bodyFontSize;
const TITLE_MAX_FONT_SIZE = achievementUiMetrics("large").titleFontSize;
const DAY_KEY_PREFIX = "activity:day:";

type ActivityPageState = {
    view: ViewKey;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
    uiSize: UiSize;
    showIcons: boolean;
    showRetroPoints: boolean;
    controllerGlyphStyle: ControllerGlyphStyle;
    mouseKeyboardMode: boolean;
    subject: ActivitySubject;
    month: string | null;
    day: string | null;
};

type ActivityPageActions = {
    onBack: () => void | Promise<void>;
    onHome: () => void | Promise<void>;
    onChangeMonth: (month: string) => void;
    onOpenDay: (day: string | null) => void;
    onOpenAchievement: (achievement: AchievementRow, row: ActivityRow) => void;
    onOpenGame: (row: ActivityRow) => void;
};

function stepMonth(month: string, by: number): string {
    const [year, monthNumber] = month.split("-").map(Number);
    const index = year * 12 + (monthNumber - 1) + by;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function rowsOfDay(rows: ActivityRow[], day: string): ActivityRow[] {
    return rows
        .filter((row) => row.day === day)
        .sort((a, b) => (a.ts - b.ts) || (a.achievementId - b.achievementId));
}

function utcStamp(ts: number): string {
    return new Date(ts * 1000).toISOString().slice(0, 19).replace("T", " ");
}

function asAchievement(row: ActivityRow, index: number): AchievementRow {
    const stamp = utcStamp(row.ts);
    return {
        id: row.achievementId,
        title: row.title,
        description: row.description,
        points: row.points,
        trueRatio: 0,
        badgeName: row.badgeName,
        displayOrder: index,
        dateEarned: stamp,
        dateEarnedHardcore: row.hardcore ? stamp : null,
        measured: false,
        numAwarded: 0,
        numAwardedHardcore: 0
    };
}

function ActivityPage(props: { state: ActivityPageState; actions: ActivityPageActions }) {
    const { state, actions } = props;
    const { language, subject, day } = state;
    const active = state.view === "activity";
    const activity = useActivityController({ isActive: active, subject, month: state.month });
    const data = activity.data;
    const metrics = useMemo(() => achievementUiMetrics(state.uiSize), [state.uiSize]);
    const [focusedDay, setFocusedDay] = useState<string | null>(null);

    const dayRows = useMemo(() => (data && day ? rowsOfDay(data.rows, day) : []), [data, day]);
    const dayPayload = useMemo<Payload | null>(() => {
        if (!day || dayRows.length === 0) {
            return null;
        }
        const achievements = dayRows.map(asAchievement);
        return {
            gameId: dayRows[0].gameId,
            title: dayLabel(day, language),
            consoleName: null,
            numAchievements: achievements.length,
            numAwardedToUser: achievements.length,
            achievements
        };
    }, [day, dayRows, language]);
    const rowById = useMemo(() => new Map(dayRows.map((row) => [row.achievementId, row])), [dayRows]);

    const [openFirst] = useState(() => pendingLandingKey("activity") ?? undefined);
    const [landingOpenKey, setLandingOpenKey] = useState<string | null>(null);
    const ready = data !== null || activity.error !== null || activity.needsSettings;
    usePageLanding({
        view: "activity",
        subject: subject.ulid,
        sub: day && (data === null || dayPayload) ? [{ kind: "day", subject: day }] : [],
        defaultKey: "activity:back",
        ready,
        holds: (key) => dayRows.some((row) => `achievement:${row.achievementId}` === key),
        open: (key) => setLandingOpenKey(key)
    });

    if (!active) {
        return null;
    }

    function handleButtonDown(evt: { detail?: { button?: number }; target?: EventTarget | null }) {
        if (evt?.detail?.button !== BUTTON_OPTIONS || !day || state.mouseKeyboardMode) {
            return;
        }
        const target = evt.target as { closest?: (selector: string) => Element | null } | null | undefined;
        const focusKey = typeof target?.closest === "function"
            ? target.closest("[data-focus-key]")?.getAttribute("data-focus-key") ?? null
            : null;
        const match = focusKey === null ? null : /^achievement:(\d+)$/.exec(focusKey);
        const row = match ? rowById.get(Number(match[1])) : undefined;
        if (row) {
            playOkSound();
            actions.onOpenGame(row);
        }
    }

    const title = t(language, "Activity");
    const pending = activity.pendingMonth;
    const shown = data && pending && pending !== data.month
        ? { ...data, month: pending, rows: [], dayCounts: {}, quartiles: [0, 0, 0] as [number, number, number] }
        : data;
    const month = shown?.month ?? state.month;
    const asked = state.month ?? data?.month ?? null;
    const isCurrent = data !== null && asked !== null && asked >= data.currentMonth;
    const landingKey = pendingLandingKey("activity");
    const landingDay = landingKey?.startsWith(DAY_KEY_PREFIX) ? landingKey.slice(DAY_KEY_PREFIX.length) : null;
    const named = focusedDay ?? landingDay;
    const focused = named && shown && named.startsWith(`${shown.month}-`) ? named : null;
    const focusedCount = focused && shown ? shown.dayCounts[focused] ?? 0 : 0;
    const monthCount = shown ? Object.values(shown.dayCounts).reduce((sum, count) => sum + count, 0) : 0;
    const captionFontSize = Math.min(metrics.bodyFontSize, CAPTION_MAX_FONT_SIZE);

    function stepForward(next: string) {
        if (data && next >= data.currentMonth) {
            landOnTop("activity", "activity:prev");
        }
        actions.onChangeMonth(next);
    }

    const monthView = data && shown ? (
        <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", width: "100%" }}>
            <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: "4px", width: "100%" }}>
                <FocusTarget focusKey="activity:prev">
                    <DialogButton
                        style={{ minWidth: 0, width: "42px", padding: "6px 0" }}
                        disabled={!asked}
                        onClick={() => asked && actions.onChangeMonth(stepMonth(asked, -1))}
                    >
                        {"‹"}
                    </DialogButton>
                </FocusTarget>
                <FocusTarget focusKey="activity:prevyear" focusFallback={["activity:prev"]}>
                    <DialogButton
                        style={{ minWidth: 0, width: "21px", padding: "6px 0" }}
                        disabled={!asked}
                        onClick={() => asked && actions.onChangeMonth(stepMonth(asked, -12))}
                    >
                        {"«"}
                    </DialogButton>
                </FocusTarget>
                <div
                    style={{
                        flex: 1,
                        minWidth: 0,
                        textAlign: "center",
                        whiteSpace: "nowrap",
                        fontWeight: 800,
                        fontSize: `${Math.min(metrics.titleFontSize, TITLE_MAX_FONT_SIZE)}px`
                    }}
                >
                    {month ? monthLabel(month, language) : ""}
                </div>
                <FocusTarget focusKey="activity:nextyear" focusFallback={["activity:next", "activity:prev"]}>
                    <DialogButton
                        style={{ minWidth: 0, width: "21px", padding: "6px 0" }}
                        disabled={!asked || isCurrent}
                        focusable={Boolean(asked) && !isCurrent}
                        onClick={() => {
                            if (asked) {
                                const ahead = stepMonth(asked, 12);
                                stepForward(ahead > data.currentMonth ? data.currentMonth : ahead);
                            }
                        }}
                    >
                        {"»"}
                    </DialogButton>
                </FocusTarget>
                <FocusTarget focusKey="activity:next" focusFallback={["activity:prev"]}>
                    <DialogButton
                        style={{ minWidth: 0, width: "42px", padding: "6px 0" }}
                        disabled={!asked || isCurrent}
                        focusable={Boolean(asked) && !isCurrent}
                        onClick={() => asked && stepForward(stepMonth(asked, 1))}
                    >
                        {"›"}
                    </DialogButton>
                </FocusTarget>
            </Focusable>
            <div
                style={{
                    ...smallTextStyle(),
                    fontSize: `${captionFontSize}px`,
                    opacity: 1,
                    width: "100%",
                    marginBottom: "4px",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: "0.35em",
                    whiteSpace: "nowrap"
                }}
            >
                {pending ? (
                    <>
                        <InlineSpinner size={Math.round(captionFontSize)} />
                        <span>{t(language, "Loading...")}</span>
                    </>
                ) : (
                    <>
                        <span>{`${focused ? dayLabel(focused, language) : t(language, "This month")} ·`}</span>
                        <FaTrophy style={{ flexShrink: 0 }} />
                        <span>{formatInteger(focused ? focusedCount : monthCount)}</span>
                    </>
                )}
            </div>
            <PanelSectionRow key={`activity:month:${shown.month}`}>
                <ActivityGrid
                    language={language}
                    month={shown}
                    cellSize={Math.round(metrics.iconSize * 0.8)}
                    onFocusDay={setFocusedDay}
                    onBlurDay={(day) => setFocusedDay((current) => (current === day ? null : current))}
                    onOpenDay={(picked) => {
                        const first = rowsOfDay(shown.rows, picked)[0];
                        if (first) {
                            playOkSound();
                            landOnTop("activity", `achievement:${first.achievementId}`);
                            actions.onOpenDay(picked);
                        }
                    }}
                />
            </PanelSectionRow>
            <PanelSectionRow>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", width: "100%", paddingTop: "10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px", ...smallTextStyle(), fontSize: `${metrics.pointsFontSize}px` }}>
                        <span>{t(language, "activity_legend_less")}</span>
                        {[0, 1, 2, 3, 4].map((level) => (
                            <span key={level} style={{ ...shadeStyle(level), width: "12px", height: "12px", borderRadius: "2px", display: "inline-block" }} />
                        ))}
                        <span>{t(language, "activity_legend_more")}</span>
                    </div>
                    {subject.own && activity.comboLength !== null && activity.comboLength > 0 && (
                        <div style={{ ...smallTextStyle(), fontSize: `${metrics.bodyFontSize}px`, opacity: 1, fontWeight: 700 }}>
                            {t(language, "{{count}}-day Combo", { count: activity.comboLength })}
                        </div>
                    )}
                    {!pending && shown.rows.length === 0 && (
                        <div style={bodyTextStyle()}>{t(language, "No unlocks this month.")}</div>
                    )}
                </div>
            </PanelSectionRow>
            <PanelSectionRow>
                <div style={{ width: "100%", paddingTop: "10px" }}>
                    <FocusTarget focusKey="activity:refresh" focusFallback={["activity:prev"]} style={{ width: "100%" }}>
                        <DialogButton style={{ width: "100%" }} disabled={activity.loading} onClick={() => void activity.refresh()}>
                            {t(language, "Refresh")}
                        </DialogButton>
                    </FocusTarget>
                </div>
            </PanelSectionRow>
        </Focusable>
    ) : activity.loading ? (
        <PanelSectionRow>
            <InlineSpinner label={t(language, "Loading...")} />
        </PanelSectionRow>
    ) : null;

    const dayView = dayPayload ? (
        <Focusable key={`activity:${day}`} resetNavOnEntry>
            <AchievementList
                key={`activity:day:${day}`}
                payload={dayPayload}
                language={language}
                showIcons={state.showIcons}
                uiSize={state.uiSize}
                topPadding={0}
                blockPadding={0}
                showAll={true}
                mode="tracked"
                trackedIds={[]}
                mainFilter="all"
                mainSort="absolute"
                showRetroPoints={state.showRetroPoints}
                titleOverride={dayLabel(day ?? "", language)}
                onAchievementClick={(achievement) => {
                    const row = rowById.get(achievement.id);
                    if (row) {
                        playOkSound();
                        actions.onOpenAchievement(achievement, row);
                    }
                }}
                getAchievementExtraLabel={(achievement) => {
                    const row = rowById.get(achievement.id);
                    return (
                        <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                            <UnlockStamp date={unlockDateLabel(achievement, language)} />
                            {row && (
                                <span>
                                    {row.consoleName
                                        ? t(language, "from {{game}} ({{console}})", { game: row.gameTitle, console: row.consoleName })
                                        : t(language, "from {{game}}", { game: row.gameTitle })}
                                </span>
                            )}
                        </span>
                    );
                }}
                preRows={state.mouseKeyboardMode ? undefined : (
                    <PanelSectionRow>
                        <ButtonHints
                            style={state.controllerGlyphStyle}
                            hints={[
                                { button: "a", label: t(language, "Achievement") },
                                { button: "y", label: t(language, "Game") }
                            ]}
                        />
                    </PanelSectionRow>
                )}
                windowId="activity:day"
                openFirstKey={openFirst}
                openAtKey={landingOpenKey ?? undefined}
            />
        </Focusable>
    ) : null;

    return (
        <Focusable flow-children="column" onButtonDown={handleButtonDown}>
            <PanelSection>
                <PageNavStrip
                    title={title}
                    buttonSpacing={state.buttonSpacing}
                    onHome={actions.onHome}
                    help={<PageHelpButton focusKey="activity:guide" onClick={() => void openExternalUrl(GUIDE_URL)} />}
                />
                <BackButton
                    label={t(language, "← Back")}
                    focusKey="activity:back"
                    navAutoFocus
                    buttonSpacing={state.buttonSpacing}
                    onClick={actions.onBack}
                />
                {activity.needsSettings && (
                    <PanelSectionRow>
                        <div style={bodyTextStyle()}>{t(language, "Credentials are missing. Set them up under Options.")}</div>
                    </PanelSectionRow>
                )}
                {activity.error && (
                    <PanelSectionRow>
                        <ErrorText>{localizeRuntimeText(language, activity.error)}</ErrorText>
                    </PanelSectionRow>
                )}
                {!(day && dayPayload) && monthView}
            </PanelSection>
            {day && dayPayload && dayView}
        </Focusable>
    );
}

export default ActivityPage;
