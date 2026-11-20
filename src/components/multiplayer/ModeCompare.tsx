import { Focusable, ModalRoot } from "@decky/ui";
import { useRef, useState, type ReactNode } from "react";

import { t, type LanguageCode } from "../../locales";
import type { MultiplayerMode } from "../../types";
import { showManagedModal } from "../../utils/modalRegistry";
import { forgetNavAxisMemory, type NavAxisRef } from "../../utils/navAxisMemory";
import { modalSize, textSize } from "../../utils/scale";
import { achievementGreen, bodyTextStyle } from "../../utils/style";
import { ButtonPrompt } from "../ui/ButtonPrompt";
import { FocusTarget } from "../ui/FocusTarget";
import { HeadingStop, focusReticle } from "../ui/HeadingStop";
import { MODE_LABELS } from "./ModeChart";

type CompareRow = {
    id: string;
    label: string;
    cells: Record<MultiplayerMode, string>;
    plain?: boolean;
};

const MODES: MultiplayerMode[] = ["link", "couch", "stream"];

const COMPARE_ROWS: CompareRow[] = [
    {
        id: "summary",
        label: "Summary",
        cells: {
            link: "Simulates linking, such as Game Boy linking or network play between consoles.",
            couch: "Simulates playing one game on one TV together, except playing together remotely.",
            stream: "Like Couch Play, except the host streams the game; guests don't need a copy."
        }
    },
    {
        id: "great",
        label: "Great for…",
        cells: {
            link: "Pokémon trading and simulating GameCube and Wii system linkups.",
            couch: "Games where multiple people played on one TV, such as Super Smash Bros., Mario Party, Secret of Mana, etc.",
            stream: "Games where multiple people played on one TV, such as Super Smash Bros., Mario Party, Secret of Mana, etc."
        }
    },
    {
        id: "players",
        label: "Players",
        plain: true,
        cells: {
            link: "2-4",
            couch: "1-10",
            stream: "1-10"
        }
    },
    {
        id: "devices",
        label: "More Than One Player per Device?",
        cells: {
            link: "No; each device counts as one player.",
            couch: "No; each device counts as one player.",
            stream: "Yes; plug extra controllers into any device in the room, host or guest, and those players join in too. Each extra controller takes one of the game's player slots, so if the room already fills the game's player count, someone ends up only watching."
        }
    },
    {
        id: "copy",
        label: "Friend Needs a Copy?",
        cells: {
            link: "Yes; everyone needs a copy of the game. The guests' games can vary if supported, for games like Pokémon. Revision and hash don't need to match here.",
            couch: "Yes; everyone needs a copy of the game. The games must match exactly down to the hash and revision. For example, if the host is using a Rev 1 version of a game, the guest must have a matching revision. Uses RetroArch's netplay as well as standalone netplay.",
            stream: "No; the benefit here is only the host needs a copy of the game, while the guests do not need it. The game is streamed to them."
        }
    },
    {
        id: "compat",
        label: "Game Compatibility",
        cells: {
            link: "Limited; compatible with games that supported link multiplayer. Even then, the cores only support a limited handful of games. All linkable Pokémon games are supported, from Game Boy to Nintendo DS.",
            couch: "Moderate; almost all of your games should support Couch Play, as RetroArch drives most of it. Some standalone emulators like DuckStation and PCSX2 do not support this. That is where Stream Play steps in.",
            stream: "Full; every single game and emulator is supported."
        }
    },
    {
        id: "achievements",
        label: "Achievement Hunting",
        cells: {
            link: "Yes; host and guests earn their own achievements with their own mode choice, provided the core supports it. Research whether your set plays nice with link trading/play first.",
            couch: "Yes; everyone earns achievements, but the host controls which mode (Hardcore or Softcore). No achievements for N64, due to RMG being required for netplay.",
            stream: "Only the host earns achievements."
        }
    },
    {
        id: "single",
        label: "Single-Player Games?",
        cells: {
            link: "No; requires multiplayer link games for play.",
            couch: "Yes; guests can drop in and join any time while the host plays a single-player game. They can watch or even control the host's controls if enabled.",
            stream: "Yes; guests can drop in and join at any time while the host plays a single-player game, but can only watch. Similar to watching people stream."
        }
    },
    {
        id: "benefits",
        label: "Benefits (Technical)",
        cells: {
            link: "Low bandwidth requirements for the host; feels native when playing.",
            couch: "Low bandwidth requirements for the host; feels native when playing; guests can join at any time after the host starts.",
            stream: "Highest compatibility; works with any game for any emulator; guests can join at any time after the host starts."
        }
    },
    {
        id: "costs",
        label: "Costs (Technical)",
        cells: {
            link: "Only a handful of games support link play. All players have to start around the same time.",
            couch: "Some RetroArch cores can stutter audio whenever RetroArch resyncs everyone's cores for netplay. Mostly resolved by CheevoDeck's recommended cores that reduce or don't have stuttering at all.",
            stream: "Requires the host to have a good internet connection, often requiring 10 Mbps upload per guest (Default - Online Requirements). Playing locally on a modern Wi-Fi network or Offline Hotspot costs next to nothing."
        }
    }
];

const SUMMARY = COMPARE_ROWS[0].cells;

const CARD_TEXT = { color: "rgb(220, 222, 223)", opacity: 1 };

const MODAL_WIDTH_CSS = `
.cheevo-mode-compare-dialog.DialogContent, .cheevo-mode-compare-dialog {
    width: min(94vw, 1100px);
}`;

export function ModeSummaryCard(props: {
    language: LanguageCode;
    mode: MultiplayerMode;
    onDirection?: (evt: { detail?: { button?: number } }) => boolean;
}) {
    const { language, mode } = props;
    const [focused, setFocused] = useState(false);
    return (
        <FocusTarget
            focusKey="multiplayer:mode:summary"
            focusFallback={[`multiplayer:mode:${mode}`, "multiplayer:notes", "multiplayer:back"]}
            style={{ display: "flex", width: "100%" }}
        >
            <Focusable
                onActivate={() => showModeCompare(language, mode)}
                noFocusRing
                onGamepadFocus={() => setFocused(true)}
                onGamepadBlur={() => setFocused(false)}
                onGamepadDirection={props.onDirection}
                style={{ width: "100%", padding: "4px 6px", boxSizing: "border-box", ...focusReticle(focused, false) }}
            >
                <div style={{ ...bodyTextStyle(), ...CARD_TEXT }}>{t(language, SUMMARY[mode])}</div>
                <div style={{ ...bodyTextStyle(), ...CARD_TEXT, lineHeight: 1, marginTop: "6px" }}>
                    <ButtonPrompt language={language} textKey="{{button}} View More" button="a" fontSize={textSize(12)} />
                </div>
            </Focusable>
        </FocusTarget>
    );
}

function CompareCell(props: { focusKey: string; row: number; column: number; bold: boolean; onMoved: () => void; children: ReactNode }) {
    const [focused, setFocused] = useState(false);
    return (
        <div style={{ gridRow: props.row, gridColumn: props.column, display: "flex", minWidth: 0, padding: "8px" }}>
            <FocusTarget focusKey={props.focusKey} style={{ display: "flex", flex: 1, minWidth: 0 }}>
                <Focusable
                    onActivate={() => { }}
                    noFocusRing
                    onGamepadFocus={() => {
                        setFocused(true);
                        props.onMoved();
                    }}
                    onGamepadBlur={() => {
                        setFocused(false);
                        props.onMoved();
                    }}
                    style={{
                        flex: 1,
                        minWidth: 0,
                        padding: "4px 6px",
                        fontSize: `${modalSize(14)}px`,
                        lineHeight: 1.35,
                        fontWeight: props.bold ? 700 : 400,
                        overflowWrap: "anywhere",
                        ...focusReticle(focused, false)
                    }}
                >
                    {props.children}
                </Focusable>
            </FocusTarget>
        </div>
    );
}

function ModeCompareModal(props: { language: LanguageCode; mode: MultiplayerMode; close: () => void }) {
    const { language, mode, close } = props;
    const navRef = useRef(null) as NavAxisRef;

    function moved() {
        forgetNavAxisMemory(navRef);
    }

    const cells: ReactNode[] = MODES.map((each, index) => (
        <CompareCell key={`head:${each}`} focusKey={`modecompare:head:${each}`} row={1} column={index + 2} bold onMoved={moved}>
            {t(language, MODE_LABELS[each])}
        </CompareCell>
    ));
    COMPARE_ROWS.forEach((row, rowIndex) => {
        cells.push(
            <CompareCell key={`${row.id}:label`} focusKey={`modecompare:${row.id}:label`} row={rowIndex + 2} column={1} bold onMoved={moved}>
                {t(language, row.label)}
            </CompareCell>
        );
        MODES.forEach((each, index) => {
            cells.push(
                <CompareCell key={`${row.id}:${each}`} focusKey={`modecompare:${row.id}:${each}`} row={rowIndex + 2} column={index + 2}
                    bold={false} onMoved={moved}>
                    {row.plain ? row.cells[each] : t(language, row.cells[each])}
                </CompareCell>
            );
        });
    });

    return (
        <ModalRoot onCancel={close} onEscKeypress={close} className="cheevo-mode-compare-dialog">
            <style>{MODAL_WIDTH_CSS}</style>
            <HeadingStop focusKey="modecompare:title" autoFocus tint={false} outerStyle={{ marginBottom: "12px" }}
                style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700 }}>
                {t(language, "Play Mode Comparison")}
            </HeadingStop>
            <Focusable
                navRef={navRef}
                flow-children="grid"
                resetNavOnEntry
                style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 0.75fr) repeat(3, minmax(0, 1fr))",
                    alignItems: "stretch"
                }}
            >
                {cells}
                <div
                    style={{
                        gridRow: `1 / ${COMPARE_ROWS.length + 2}`,
                        gridColumn: MODES.indexOf(mode) + 2,
                        border: `2px solid ${achievementGreen}`,
                        borderRadius: "4px",
                        pointerEvents: "none"
                    }}
                />
            </Focusable>
        </ModalRoot>
    );
}

function showModeCompare(language: LanguageCode, mode: MultiplayerMode) {
    showManagedModal((close) => <ModeCompareModal language={language} mode={mode} close={close} />);
}
