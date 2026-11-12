import { Focusable, PanelSectionRow } from "@decky/ui";
import { useEffect, useState, type CSSProperties } from "react";

import { FocusTarget } from "../ui/FocusTarget";
import { t, type LanguageCode } from "../../locales";
import { achievementGreen, bodyTextStyle, masteredGold, warnAmber } from "../../utils/style";
import type { VoiceMine } from "../../utils/voiceChat";
import { PicAvatar } from "./PicAvatar";
import { MutedPlayerIcon, OwnMicIcon } from "./VoiceIcons";
import { STATE_LOOKS } from "./ModeChart";

export type StreamSeatState = "pairing" | "connecting" | "streaming" | "relay" | "failed" | "";

const STREAM_LABELS: Record<string, string> = {
    pairing: "Pairing",
    connecting: "Connecting",
    failed: "Couldn't connect"
};

type RoomTableSeat = {
    name: string;
    game: string;
    tag: "host" | "";
    mark?: "ready" | "setup" | "never" | "";
    activity?: "game" | "watch" | "";
    stream?: StreamSeatState;
    avatar?: string;
    open: boolean;
};

function statusLabel(seat: RoomTableSeat): string {
    const watching = seat.activity === "watch";
    if (seat.stream === "streaming") {
        return watching ? "Watching" : "In-Game";
    }
    if (seat.stream === "relay") {
        return watching ? "Watching (relay)" : "In-Game (relay)";
    }
    if (seat.stream) {
        return STREAM_LABELS[seat.stream];
    }
    return seat.activity === "game" ? "In-Game" : watching ? "Watching" : "In-Lobby";
}

export type RoomTableVoice = {
    own: number;
    mine: VoiceMine;
    available: boolean;
    speaking: boolean;
    seats: Record<number, { speaking: boolean; mutedByMe: boolean; failed: boolean }>;
};

const AVATAR_PX = 24;

function SeatStateIcon(props: { state: "setup" | "never"; style: CSSProperties }) {
    const look = STATE_LOOKS[props.state];
    return (
        <span style={{ ...props.style, color: look.color }}>
            <look.Icon />
        </span>
    );
}

function seatKey(index: number): string {
    return `multiplayer:seat:${index}`;
}

export function RoomTable(props: {
    language: LanguageCode;
    seats: RoomTableSeat[];
    onSeat: (index: number) => void;
    exitKey: string;
    voice?: RoomTableVoice;
    onMic?: () => void;
    prompts?: boolean;
    footer?: boolean;
    ownPress?: boolean;
    onFocusAction?: (label: string | null, own: boolean) => void;
}) {
    const { language, seats, voice } = props;
    const [focused, setFocused] = useState(-1);

    function pressable(index: number): boolean {
        return voice !== undefined && index === voice.own ? Boolean(props.ownPress) : seats[index].open;
    }

    function action(index: number): string | undefined {
        if (!props.prompts || !seats[index]?.name || !pressable(index)) {
            return undefined;
        }
        if (voice !== undefined && index === voice.own) {
            return t(language, voice.mine === "off" ? "Unmute" : "Mute");
        }
        return t(language, "Options");
    }

    const focusedAction = focused >= 0 && focused < seats.length ? action(focused) ?? null : null;
    const focusedOwn = voice !== undefined && focused === voice.own;
    useEffect(() => {
        props.onFocusAction?.(focusedAction, focusedOwn);
    }, [focusedAction, focusedOwn]);
    useEffect(() => () => props.onFocusAction?.(null, false), []);

    function heirs(index: number): string[] {
        return [index + 1, index - 1]
            .filter((other) => other >= 0 && other < seats.length)
            .map(seatKey)
            .concat(props.exitKey, "multiplayer:back");
    }

    return (
        <>
            <PanelSectionRow>
                <div style={{ display: "flex", flexDirection: "column", width: "100%", paddingBottom: "8px" }}>
                    {seats.map((seat, index) => {
                        const tags = seat.name ? [
                            t(language, seat.tag === "host" ? "Host" : "Guest"),
                            t(language, statusLabel(seat))
                        ].join(" · ") : "";
                        const own = voice !== undefined && index === voice.own;
                        const heard = voice?.seats[index];
                        const voiceIcon = !voice || !seat.name ? null
                            : own ? <OwnMicIcon mine={voice.mine} available={voice.available} />
                                : heard?.failed ? <span style={{ color: warnAmber, fontWeight: 800 }}>!</span>
                                    : heard?.mutedByMe ? <MutedPlayerIcon /> : null;
                        const speaking = own ? Boolean(voice?.speaking && voice.mine === "on") : Boolean(heard?.speaking);
                        const seatCell: CSSProperties = {
                            alignSelf: seat.name ? "start" : "center",
                            height: `${AVATAR_PX}px`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            minWidth: "1em"
                        };
                        const rowStyle = {
                            display: "grid",
                            gridTemplateColumns: "auto auto 1fr",
                            alignItems: "center",
                            gap: "10px",
                            minHeight: "28px",
                            padding: "4px 8px",
                            borderTop: index > 0 ? "1px solid rgba(255,255,255,0.12)" : undefined
                        };
                        const cells = (
                            <>
                                {seat.mark === "ready" ? (
                                    <span style={{ ...bodyTextStyle(), ...seatCell, opacity: 1, color: masteredGold, fontWeight: 800 }}>✔</span>
                                ) : seat.mark === "setup" || seat.mark === "never" ? (
                                    <SeatStateIcon state={seat.mark} style={{ ...bodyTextStyle(), ...seatCell, opacity: 1 }} />
                                ) : (
                                    <span style={{ ...bodyTextStyle(), ...seatCell }}>{index + 1}</span>
                                )}
                                {seat.name ? (
                                    <div
                                        style={voice
                                            ? { alignSelf: "start", borderRadius: "6px", boxShadow: speaking ? `0 0 0 2px ${achievementGreen}` : undefined }
                                            : { alignSelf: "start" }}
                                    >
                                        <PicAvatar uri={seat.avatar} name={seat.name} size={AVATAR_PX} />
                                    </div>
                                ) : <span />}
                                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                                    <span
                                        style={seat.name
                                            ? { color: achievementGreen, fontWeight: 800, overflowWrap: "anywhere" }
                                            : { ...bodyTextStyle(), fontStyle: "italic" }}
                                    >
                                        {seat.name || t(language, "Waiting for player...")}
                                    </span>
                                    {voiceIcon ? (
                                        <span style={{ display: "flex", alignItems: "center", gap: "5px", minWidth: 0 }}>
                                            <span style={{ ...bodyTextStyle(), opacity: 1, flexShrink: 0, display: "flex" }}>{voiceIcon}</span>
                                            {seat.game && (
                                                <span style={{ ...bodyTextStyle(), overflowWrap: "anywhere", minWidth: 0 }}>{seat.game}</span>
                                            )}
                                        </span>
                                    ) : seat.name && seat.game && (
                                        <span style={{ ...bodyTextStyle(), overflowWrap: "anywhere" }}>{seat.game}</span>
                                    )}
                                    {tags && <span style={bodyTextStyle()}>{tags}</span>}
                                </div>
                            </>
                        );
                        return (
                            <FocusTarget key={index} focusKey={seatKey(index)} focusFallback={heirs(index)} style={{ width: "100%" }}>
                                <Focusable
                                    focusable
                                    noFocusRing
                                    onActivate={!pressable(index) ? undefined : own ? props.onMic : () => props.onSeat(index)}
                                    onOKActionDescription={props.footer ? action(index) : undefined}
                                    onGamepadFocus={() => setFocused(index)}
                                    onGamepadBlur={() => setFocused((current) => (current === index ? -1 : current))}
                                    style={{
                                        ...rowStyle,
                                        borderRadius: "4px",
                                        background: focused === index ? "rgba(255,255,255,0.14)" : undefined
                                    }}
                                >
                                    {cells}
                                </Focusable>
                            </FocusTarget>
                        );
                    })}
                </div>
            </PanelSectionRow>
        </>
    );
}
