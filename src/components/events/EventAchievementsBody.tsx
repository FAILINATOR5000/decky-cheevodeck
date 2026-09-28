import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PanelSectionRow } from "@decky/ui";
import { AchievementList } from "../achievements/AchievementList";
import { UnlockStamp } from "../achievements/UnlockStamp";
import { ButtonHints } from "../ui/ButtonHints";
import { ErrorText } from "../ui/ErrorText";
import { FadeImage } from "../ui/FadeImage";
import { InlineSpinner } from "../ui/InlineSpinner";
import { LabeledRow } from "../ui/LabeledRow";
import { PanelSection } from "../ui/PanelSection";
import { useEvents } from "./EventsContext";
import { prefetchGameIcons } from "../../api";
import { useFocusClaim } from "../../hooks/useFocusClaim";
import { useGameIcon } from "../../hooks/useGameIcon";
import { localizeRuntimeText, t, type LanguageCode } from "../../locales";
import type { AchievementRow, EventChecklistGame, EventSource, Payload } from "../../types";
import { earned, unlockDateLabel, unlockedHardcore } from "../../utils/achievements";
import { consoleInlineName } from "../../utils/consoles";
import { achievementUiMetrics } from "../../utils/style";

const SPINNER_DELAY_MS = 500;

export function eventListOrder(achievements: AchievementRow[]): AchievementRow[] {
    return [...achievements].sort((a, b) => (a.displayOrder - b.displayOrder) || (a.id - b.id));
}

type EventAchievementsBodyProps = {
    language: LanguageCode;
    eventGameId: number;
    payload: Payload | null;
    payloadLoading: boolean;
    payloadError: string | null;
    sources: Record<string, EventSource>;
    sourceGames: Record<string, EventChecklistGame>;
    sourceBanners: boolean;
    restoreAchievementId: number | null;
    onRestoreSettled: () => void;
    onOpenAchievement: (achievement: AchievementRow) => void;
    onOpenGame: (achievement: AchievementRow) => void;
    onRequestFocus: (focusKey: string) => void;
};

function SourceGameBanner(props: {
    gameId: number;
    title: string;
    consoleName: string;
    imageIcon: string;
    showIcons: boolean;
    size: number;
    fontSize: number;
}) {
    const { iconDataUri, cold } = useGameIcon(props.gameId, props.imageIcon || null, "event source banner");
    const system = consoleInlineName(props.consoleName);
    return (
        <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
            {props.showIcons && (
                <div
                    style={{
                        width: `${props.size}px`,
                        height: `${props.size}px`,
                        borderRadius: "5px",
                        overflow: "hidden",
                        flexShrink: 0,
                        background: "rgba(255,255,255,0.10)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: `${Math.round(props.size * 0.5)}px`,
                        fontWeight: 800
                    }}
                >
                    {iconDataUri ? (
                        <FadeImage
                            src={iconDataUri}
                            fadeOnLoad={cold}
                            decoding="async"
                            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        />
                    ) : (
                        props.title.charAt(0).toUpperCase()
                    )}
                </div>
            )}
            <span
                style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: `${props.fontSize}px`,
                    fontWeight: 700,
                    opacity: 0.9,
                    overflowWrap: "break-word",
                    wordBreak: "break-word",
                    textAlign: "left"
                }}
            >
                {props.title}
                {system ? <span style={{ opacity: 0.65, fontWeight: 600 }}>{` · ${system}`}</span> : null}
            </span>
        </div>
    );
}

export function EventAchievementsBody(props: EventAchievementsBodyProps) {
    const { language, payload, sources, sourceGames, sourceBanners } = props;
    const { settings } = useEvents();
    const [clickAction, setClickAction] = useState<"achievement" | "game">("achievement");

    const displayPayload = useMemo<Payload | null>(() => {
        if (!payload) {
            return null;
        }
        const achievements = (payload.achievements ?? []).map((row) =>
            sources[String(row.id)]?.obfuscated ? { ...row, description: "" } : row
        );
        return { ...payload, achievements };
    }, [payload, sources]);

    const ordered = useMemo(() => eventListOrder(displayPayload?.achievements ?? []), [displayPayload]);
    const gameAction = !sourceBanners && Object.keys(sources).length > 0;

    useEffect(function prefetchSourceGameIcons() {
        if (!sourceBanners || !settings.showIcons) {
            return;
        }
        const entries = Object.values(sources)
            .filter((source) => !source.obfuscated)
            .map((source) => ({ gameId: source.gameId, imageIcon: sourceGames[String(source.gameId)]?.imageIcon || null }));
        if (entries.length > 0) {
            void prefetchGameIcons(entries);
        }
    }, [sources, sourceGames, sourceBanners, settings.showIcons]);

    const metrics = useMemo(() => achievementUiMetrics(settings.uiSize), [settings.uiSize]);

    const headerLabel = useCallback((achievement: AchievementRow): ReactNode => {
        const source = sourceBanners ? sources[String(achievement.id)] : undefined;
        if (source === undefined || source.obfuscated) {
            return null;
        }
        const game = sourceGames[String(source.gameId)];
        return (
            <SourceGameBanner
                gameId={source.gameId}
                title={source.gameTitle || game?.title || ""}
                consoleName={source.consoleName || game?.consoleName || ""}
                imageIcon={game?.imageIcon ?? ""}
                showIcons={settings.showIcons}
                size={Math.max(18, Math.round(metrics.iconSize * 0.4))}
                fontSize={metrics.captionFontSize}
            />
        );
    }, [sources, sourceGames, sourceBanners, settings.showIcons, metrics]);

    const extraLabel = useCallback((achievement: AchievementRow): ReactNode => {
        const source = sourceBanners ? undefined : sources[String(achievement.id)];
        const showSource = source !== undefined && !source.obfuscated;
        const softcoreOnly = earned(achievement) && !unlockedHardcore(achievement);
        const stamp = earned(achievement) ? unlockDateLabel(achievement, language) : "";
        if (!stamp && !showSource) {
            return null;
        }
        return (
            <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                {stamp && <UnlockStamp date={stamp} />}
                {showSource && (
                    <span>
                        {source.consoleName
                            ? t(language, "from {{game}} ({{console}})", { game: source.gameTitle, console: source.consoleName })
                            : t(language, "from {{game}}", { game: source.gameTitle })}
                    </span>
                )}
                {softcoreOnly && (
                    <span style={{ color: "#f59e0b" }}>{t(language, "Softcore, doesn't count")}</span>
                )}
            </span>
        );
    }, [sources, sourceBanners, language]);

    function handleClick(achievement: AchievementRow) {
        if (settings.mouseKeyboardMode && gameAction && clickAction === "game") {
            props.onOpenGame(achievement);
            return;
        }
        props.onOpenAchievement(achievement);
    }

    const claim = useFocusClaim();
    const firedRef = useRef(false);
    const [seedRows, setSeedRows] = useState<number | undefined>(undefined);
    useEffect(() => {
        if (props.restoreAchievementId === null || firedRef.current || !displayPayload) {
            return;
        }
        firedRef.current = true;
        const index = ordered.findIndex((row) => row.id === props.restoreAchievementId);
        if (index < 0) {
            props.onRestoreSettled();
            props.onRequestFocus("eventviewer:back");
            return;
        }
        setSeedRows(index + 1 + settings.dynamicRowStep);
        claim.claimSlot(index);
        props.onRequestFocus(`achievement:${props.restoreAchievementId}`);
    }, [displayPayload, ordered, props.restoreAchievementId]);

    const spent = firedRef.current && (claim.claim?.token ?? 0) > 0 && !claim.claim?.armed;
    useEffect(() => {
        if (spent) {
            props.onRestoreSettled();
            setSeedRows(undefined);
        }
    }, [spent]);

    const waiting = !displayPayload && !props.payloadError;
    const [spinnerDue, setSpinnerDue] = useState(false);
    useEffect(() => {
        if (!waiting) {
            setSpinnerDue(false);
            return;
        }
        const timer = window.setTimeout(() => setSpinnerDue(true), SPINNER_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [waiting]);

    if (!displayPayload) {
        if (props.payloadError) {
            return (
                <PanelSection>
                    <PanelSectionRow>
                        <ErrorText>{localizeRuntimeText(language, props.payloadError)}</ErrorText>
                    </PanelSectionRow>
                </PanelSection>
            );
        }
        if (!spinnerDue) {
            return null;
        }
        return (
            <PanelSection>
                <PanelSectionRow>
                    <InlineSpinner label={t(language, "Loading...")} />
                </PanelSectionRow>
            </PanelSection>
        );
    }

    return (
        <AchievementList
            key={`eventviewer:achievements:${props.eventGameId}`}
            payload={displayPayload}
            language={language}
            showIcons={settings.showIcons}
            achievementStyle={settings.achievementStyle}
            uiSize={settings.uiSize}
            topPadding={0}
            blockPadding={settings.blockPadding}
            showAll={true}
            mode="overview"
            trackedIds={[]}
            mainFilter="all"
            mainSort="absolute"
            showRetroPoints={settings.showRetroPoints}
            onAchievementClick={handleClick}
            getAchievementExtraLabel={extraLabel}
            getAchievementHeaderLabel={headerLabel}
            preRows={settings.mouseKeyboardMode ? (
                gameAction && (
                    <LabeledRow
                        focusKey="eventviewer:click"
                        bottomSeparator="none"
                        label={t(language, "Click")}
                        value={clickAction === "game" ? t(language, "Game") : t(language, "Achievement")}
                        onClick={() => setClickAction((current) => (current === "game" ? "achievement" : "game"))}
                    />
                )
            ) : (
                <PanelSectionRow>
                    <ButtonHints
                        style={settings.controllerGlyphStyle}
                        hints={[
                            ...(gameAction
                                ? [
                                    { button: "a" as const, label: t(language, "Achievement") },
                                    { button: "x" as const, label: t(language, "Game") }
                                ]
                                : [{ button: "a" as const, label: t(language, "View Info") }])
                        ]}
                    />
                </PanelSectionRow>
            )}
            seedRows={seedRows}
            claimedRow={claim.claim ? { ...claim.claim, onSpent: claim.spend } : undefined}
        />
    );
}
