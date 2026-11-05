import { Focusable, PanelSectionRow } from "@decky/ui";
import { useState } from "react";

import { FocusTarget } from "../ui/FocusTarget";
import { SectionTitle } from "../ui/SectionTitle";
import { t, type LanguageCode } from "../../locales";
import { achievementGreen, bodyTextStyle, errorRed, masteredGold, warnAmber } from "../../utils/style";
import type { VoiceMine } from "../../utils/voiceChat";
import { PicAvatar } from "./PicAvatar";
import { MutedPlayerIcon, OwnMicIcon } from "./VoiceIcons";

type RoomTableSeat = {
    name: string;
    game: string;
    tag: "host" | "";
    mark?: "ready" | "cant" | "";
    activity?: "game" | "watch" | "";
    avatar?: string;
    open: boolean;
};

export type RoomTableVoice = {
    own: number;
    mine: VoiceMine;
    available: boolean;
    speaking: boolean;
    seats: Record<number, { speaking: boolean; mutedByMe: boolean; failed: boolean }>;
};

const AVATAR_PX = 24;

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
    onFocusSeat?: (index: number) => void;
}) {
    const { language, seats, voice } = props;
    const [focused, setFocused] = useState(-1);

    function heirs(index: number): string[] {
        return [index + 1, index - 1]
            .filter((other) => other >= 0 && other < seats.length)
            .map(seatKey)
            .concat(props.exitKey, "multiplayer:back");
    }

    return (
        <>
            <SectionTitle label={t(language, "Room")} />
            <PanelSectionRow>
                <div style={{ display: "flex", flexDirection: "column", width: "100%", paddingBottom: "8px" }}>
                    {seats.map((seat, index) => {
                        const tags = seat.name ? [
                            t(language, seat.tag === "host" ? "Host" : "Guest"),
                            t(language, seat.activity === "game" ? "In-Game" : seat.activity === "watch" ? "Watching" : "In-Lobby")
                        ].join(" · ") : "";
                        const own = voice !== undefined && index === voice.own;
                        const heard = voice?.seats[index];
                        const voiceIcon = !voice || !seat.name ? null
                            : own ? <OwnMicIcon mine={voice.mine} available={voice.available} />
                                : heard?.failed ? <span style={{ color: warnAmber, fontWeight: 800 }}>!</span>
                                    : heard?.mutedByMe ? <MutedPlayerIcon /> : null;
                        const speaking = own ? Boolean(voice?.speaking && voice.mine === "on") : Boolean(heard?.speaking);
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
                                    <span style={{ ...bodyTextStyle(), opacity: 1, color: masteredGold, fontWeight: 800, minWidth: "1em", textAlign: "right" }}>✔</span>
                                ) : seat.mark === "cant" ? (
                                    <span style={{ ...bodyTextStyle(), opacity: 1, color: errorRed, fontWeight: 800, minWidth: "1em", textAlign: "right" }}>✖</span>
                                ) : (
                                    <span style={{ ...bodyTextStyle(), minWidth: "1em", textAlign: "right" }}>{index + 1}</span>
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
                                    onActivate={own ? props.onMic : seat.open ? () => props.onSeat(index) : undefined}
                                    onGamepadFocus={() => {
                                        setFocused(index);
                                        props.onFocusSeat?.(index);
                                    }}
                                    onGamepadBlur={() => {
                                        setFocused((current) => (current === index ? -1 : current));
                                        props.onFocusSeat?.(-1);
                                    }}
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
