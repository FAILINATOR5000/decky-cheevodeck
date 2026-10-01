import { useEffect, type ReactNode } from "react";
import { DialogButton, Focusable, PanelSectionRow } from "@decky/ui";
import { FadeImage } from "../ui/FadeImage";
import { ProgressBar } from "../ui/ProgressBar";
import { AwardStamp } from "../achievements/AwardStamp";
import { ClaimedRow } from "./ClaimedRow";
import { prefetchGameIcons } from "../../api";
import type { FocusClaimController } from "../../hooks/useFocusClaim";
import { useGameIcon } from "../../hooks/useGameIcon";
import { t, type LanguageCode } from "../../locales";
import type { EventCompletion, EventListRow } from "../../types";
import { formatUnlockDate } from "../../utils/achievements";
import { eventDatesLabel, eventKindLabel, eventPhaseLabel } from "../../utils/events";
import { achievementGreen, smallTextStyle } from "../../utils/style";
import { textSize } from "../../utils/scale";

export type EventHeaderButton = {
    key: string;
    label: string;
    onClick: () => void;
};

type EventViewerHeaderProps = {
    language: LanguageCode;
    eventGameId: number;
    title: string;
    imageIcon: string | null;
    row: EventListRow | null;
    newestSiteGameId: number;
    completion: EventCompletion;
    showIcons: boolean;
    progressText: ReactNode;
    progressFraction: number | null;
    progressPending: boolean;
    buttons: EventHeaderButton[];
    buttonClaim: FocusClaimController;
    tabs: ReactNode;
};

const NAV_ENTER_MAINTAIN_X = 2;

const gridButtonStyle = {
    minWidth: 0,
    width: "100%",
    height: "100%",
    padding: "4px 10px",
    fontSize: "13px",
    fontWeight: 600
};

const claimCellStyle = { display: "flex", flex: 1, minWidth: 0 };

export function EventViewerHeader(props: EventViewerHeaderProps) {
    const { language, row } = props;
    const { iconDataUri, cold } = useGameIcon(props.eventGameId, props.imageIcon, "event header");

    useEffect(() => {
        if (props.showIcons && props.imageIcon) {
            void prefetchGameIcons([{ gameId: props.eventGameId, imageIcon: props.imageIcon }]);
        }
    }, [props.eventGameId, props.imageIcon, props.showIcons]);

    const phase = row ? eventPhaseLabel(row, props.newestSiteGameId, language) : "";
    const chips = [phase, row ? eventKindLabel(row, language) : ""].filter(Boolean).join(" · ");
    const dates = row ? eventDatesLabel(row, language) : "";

    let completionLine: ReactNode = null;
    if (props.completion?.kind === "earned") {
        const date = formatUnlockDate(row?.earnedAt, { includeYear: true, dateOnly: true }, language);
        completionLine = (
            <span style={{ color: achievementGreen }}>
                {t(language, "Earned")}
                {date ? <>{" "}<AwardStamp date={date} /></> : null}
            </span>
        );
    }
    else if (props.completion?.kind === "marked") {
        completionLine = t(language, "Marked complete");
    }

    const iconSize = 64;

    return (
        <>
            <PanelSectionRow>
                <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", width: "100%", padding: "6px 0" }}>
                    {props.showIcons && (
                        <div
                            style={{
                                width: `${iconSize}px`,
                                height: `${iconSize}px`,
                                borderRadius: "8px",
                                overflow: "hidden",
                                flexShrink: 0,
                                background: "rgba(255,255,255,0.10)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "26px",
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
                                props.title.charAt(0).toUpperCase() || "?"
                            )}
                        </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
                        <div style={{ fontSize: `${textSize(16)}px`, fontWeight: 800, lineHeight: 1.2, wordBreak: "break-word" }}>
                            {props.title}
                        </div>
                        {chips && <div style={smallTextStyle()}>{chips}</div>}
                        {dates && <div style={smallTextStyle()}>{dates}</div>}
                        {completionLine && (
                            <div style={{ ...smallTextStyle(), fontWeight: 800, opacity: 1 }}>{completionLine}</div>
                        )}
                    </div>
                </div>
            </PanelSectionRow>
            {(props.progressText || props.progressPending) && (
                <PanelSectionRow>
                    <div
                        style={{
                            width: "100%",
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                            padding: "2px 0 6px 0",
                            visibility: props.progressText ? undefined : "hidden"
                        }}
                    >
                        <div style={{ ...smallTextStyle(), fontWeight: 700, opacity: 1 }}>{props.progressText || "\u00a0"}</div>
                        <ProgressBar fraction={props.progressFraction ?? 0} />
                    </div>
                </PanelSectionRow>
            )}
            <Focusable
                flow-children="grid"
                navEntryPreferPosition={NAV_ENTER_MAINTAIN_X}
                style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", width: "100%", margin: "4px 0 10px 0" }}
            >
                {props.buttons.map((button, index) => (
                    <div
                        key={button.key}
                        data-focus-key={`eventviewer:${button.key}`}
                        style={{
                            display: "flex",
                            minWidth: 0,
                            gridColumn: index === props.buttons.length - 1 && index % 2 === 0 ? "1 / -1" : undefined
                        }}
                    >
                        <ClaimedRow claim={props.buttonClaim} slotIndex={index} style={claimCellStyle}>
                            <DialogButton onClick={button.onClick} style={gridButtonStyle}>
                                {button.label}
                            </DialogButton>
                        </ClaimedRow>
                    </div>
                ))}
                {props.tabs}
            </Focusable>
        </>
    );
}
