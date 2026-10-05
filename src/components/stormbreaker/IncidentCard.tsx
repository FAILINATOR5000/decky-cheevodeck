import React from "react";
// Font Awesome Free icons, CC BY 4.0. See ATTRIBUTIONS.md.
import { FaHandPaper, FaRedoAlt, FaShieldAlt } from "react-icons/fa";

import { FocusableItem } from "../ui/FocusableItem";
import { t, type LanguageCode } from "../../locales";
import type { FreezeIncident } from "../../types";
import { formatUnlockDate } from "../../utils/achievements";
import { achievementGreen, bodyTextStyle, masteredGold } from "../../utils/style";
import { textSize } from "../../utils/scale";

export type IncidentCardProps = {
    incident: FreezeIncident;
    language: LanguageCode;
    index: number;
    onCardFocus: (index: number) => void;
};

const CONTROLLER_LINES: Record<string, string> = {
    deck: "Button combo held on the Steam Deck",
    controller: "Button combo held on a Steam Controller",
    ally: "Button combo held on the ROG Ally"
};

function confirmationLabel(language: LanguageCode, name: string, rssGrowthMb: number): string {
    if (name === "fresh") {
        return t(language, "no response on a new connection");
    }
    if (name === "cpu") {
        return t(language, "high CPU use");
    }
    if (name === "memory") {
        return t(language, "memory growth of {{mb}} MB", { mb: rssGrowthMb });
    }
    return t(language, "repeated focus errors");
}

function captureLine(language: LanguageCode, capture: string | null): string {
    return capture ? t(language, "Recovery log: {{name}}", { name: capture }) : t(language, "Recovery log: none");
}

function cardDate(at: number, language: LanguageCode): string {
    const iso = new Date(at * 1000).toISOString();
    return formatUnlockDate(iso, { includeYear: true, numericDate: true, shortYear: true }, language).replace(", ", " ");
}

function statLines(language: LanguageCode, incident: FreezeIncident): string[] {
    if (incident.kind === "prevented") {
        const lines = [t(language, "Detected: {{count}} focus changes in {{ms}} ms", { count: incident.changes, ms: incident.spanMs })];
        if (incident.afterHiding > 0) {
            lines.push(t(language, "Focus changes while hidden: {{count}}", { count: incident.afterHiding }));
        }
        lines.push(incident.endedBy === "quiet"
            ? t(language, "Menu hidden for {{ms}} ms, until the storm stopped", { ms: incident.hiddenMs })
            : t(language, "Menu hidden for {{seconds}} s; storm still active when restored", { seconds: Math.max(1, Math.round(incident.hiddenMs / 1000)) }));
        if (incident.game) {
            lines.push(t(language, "Game: {{game}}", { game: incident.game }));
        }
        return lines;
    }
    if (incident.kind === "recovered") {
        const lines = [t(language, "No response to pings for {{seconds}} s", { seconds: incident.silenceS })];
        if (incident.confirmations.length > 0) {
            const signals = incident.confirmations.map((name) => confirmationLabel(language, name, incident.rssGrowthMb));
            lines.push(t(language, "Also confirmed by: {{signals}}", { signals: signals.join(", ") }));
        }
        lines.push(t(language, "Steam processes restarted: {{count}}", { count: incident.killed }));
        if (incident.backAfterS !== null) {
            lines.push(t(language, "Responding again {{seconds}} s after the restart", { seconds: incident.backAfterS }));
        }
        lines.push(captureLine(language, incident.capture));
        if (incident.pausedAfter) {
            lines.push(t(language, "Automatic Recovery paused until the plugin reloads"));
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
    lines.push(t(language, "Steam processes restarted: {{count}}", { count: incident.killed }));
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
                <div style={{ ...bodyTextStyle(), fontWeight: 700, opacity: 1 }}>
                    {cardDate(incident.at, language)}
                </div>
                {statLines(language, incident).map((line) => (
                    <div key={line} style={{ ...bodyTextStyle(), display: "flex", gap: "6px", minWidth: 0 }}>
                        <span>•</span>
                        <span style={{ minWidth: 0, wordBreak: "break-word" }}>{line}</span>
                    </div>
                ))}
            </div>
        </FocusableItem>
    );
});
