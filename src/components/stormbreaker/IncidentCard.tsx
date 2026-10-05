import React from "react";
// Font Awesome Free icons, CC BY 4.0. See ATTRIBUTIONS.md.
import { FaHandPaper, FaRedoAlt, FaShieldAlt } from "react-icons/fa";

import { FocusableItem } from "../ui/FocusableItem";
import { t, type LanguageCode } from "../../locales";
import type { FreezeIncident } from "../../types";
import { formatUnlockDate } from "../../utils/achievements";
import { formatRelativeTime } from "../../utils/format";
import { achievementGreen, bodyTextStyle, masteredGold, smallTextStyle } from "../../utils/style";
import { textSize } from "../../utils/scale";

export type IncidentCardProps = {
    incident: FreezeIncident;
    language: LanguageCode;
    index: number;
    onCardFocus: (index: number) => void;
};

const CONTROLLER_LINES: Record<string, string> = {
    deck: "Held on the Steam Deck's controls",
    controller: "Held on a Steam Controller",
    ally: "Held on the ROG Ally's controls"
};

function confirmationLabel(language: LanguageCode, name: string, rssGrowthMb: number): string {
    if (name === "fresh") {
        return t(language, "no fresh connection");
    }
    if (name === "cpu") {
        return t(language, "busy CPU");
    }
    if (name === "memory") {
        return t(language, "memory +{{mb}} MB", { mb: rssGrowthMb });
    }
    return t(language, "focus errors");
}

function captureLine(language: LanguageCode, capture: string | null): string {
    return capture ? t(language, "Recovery log: {{name}}", { name: capture }) : t(language, "No recovery log");
}

function statLines(language: LanguageCode, incident: FreezeIncident): string[] {
    if (incident.kind === "prevented") {
        const lines = [t(language, "{{count}} focus changes in {{ms}} ms", { count: incident.changes, ms: incident.spanMs })];
        if (incident.afterHiding > 0) {
            lines.push(t(language, "Held back {{count}} more", { count: incident.afterHiding }));
        }
        lines.push(incident.endedBy === "quiet"
            ? t(language, "Storm ended by itself, menu hidden {{ms}} ms", { ms: incident.hiddenMs })
            : t(language, "Stopped after {{seconds}} s", { seconds: Math.max(1, Math.round(incident.hiddenMs / 1000)) }));
        if (incident.game) {
            lines.push(t(language, "While playing {{game}}", { game: incident.game }));
        }
        return lines;
    }
    if (incident.kind === "recovered") {
        const lines = [t(language, "Steam silent {{seconds}} s", { seconds: incident.silenceS })];
        if (incident.confirmations.length > 0) {
            const signals = incident.confirmations.map((name) => confirmationLabel(language, name, incident.rssGrowthMb));
            lines.push(t(language, "Confirmed by: {{signals}}", { signals: signals.join(", ") }));
        }
        lines.push(t(language, "Restarted {{count}} Steam processes", { count: incident.killed }));
        if (incident.backAfterS !== null) {
            lines.push(t(language, "Back in {{seconds}} s", { seconds: incident.backAfterS }));
        }
        lines.push(captureLine(language, incident.capture));
        if (incident.pausedAfter) {
            lines.push(t(language, "Automatic Recovery paused until reload"));
        }
        return lines;
    }
    const lines: string[] = [];
    const held = Object.prototype.hasOwnProperty.call(CONTROLLER_LINES, incident.controller)
        ? CONTROLLER_LINES[incident.controller]
        : undefined;
    if (held) {
        lines.push(t(language, held));
    }
    lines.push(t(language, "Restarted {{count}} Steam processes", { count: incident.killed }));
    lines.push(captureLine(language, incident.capture));
    return lines;
}

function heading(language: LanguageCode, incident: FreezeIncident) {
    if (incident.kind === "prevented") {
        return { icon: <FaShieldAlt />, title: t(language, "Freeze Prevented"), color: achievementGreen };
    }
    if (incident.kind === "recovered") {
        return { icon: <FaRedoAlt />, title: t(language, "Freeze Recovered"), color: masteredGold };
    }
    return { icon: <FaHandPaper />, title: t(language, "Manual Recovery"), color: undefined };
}

export const IncidentCard = React.memo(function IncidentCard(props: IncidentCardProps) {
    const { incident, language } = props;
    const { icon, title, color } = heading(language, incident);
    const when = new Date(incident.at * 1000).toISOString();

    function handleFocus() {
        props.onCardFocus(props.index);
    }

    return (
        <FocusableItem
            focusKey={`qamGuard:card:${incident.id}`}
            onFocus={handleFocus}
            onGamepadFocus={handleFocus}
            outerStyle={{ width: "100%", minWidth: 0 }}
        >
            <div
                style={{
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    gap: "3px",
                    textAlign: "left",
                    padding: "3px 0",
                    minWidth: 0
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 800, fontSize: `${textSize(15)}px`, color }}>
                    {icon}
                    <span>{title}</span>
                </div>
                <div style={smallTextStyle()}>
                    {formatUnlockDate(when, {}, language)} · {formatRelativeTime(when, language)}
                </div>
                {statLines(language, incident).map((line) => (
                    <div key={line} style={{ ...bodyTextStyle(), minWidth: 0, wordBreak: "break-word" }}>
                        {line}
                    </div>
                ))}
            </div>
        </FocusableItem>
    );
});
