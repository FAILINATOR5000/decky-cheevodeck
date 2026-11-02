import { Focusable, PanelSectionRow } from "@decky/ui";
import { useState } from "react";

import { FocusTarget } from "../ui/FocusTarget";
import { SectionTitle } from "../ui/SectionTitle";
import { t, type LanguageCode } from "../../locales";
import { achievementGreen, bodyTextStyle, errorRed, masteredGold } from "../../utils/style";
import { PicAvatar } from "./PicAvatar";

type RoomTableSeat = {
    name: string;
    game: string;
    tag: "host" | "you" | "";
    mark?: "ready" | "cant" | "";
    activity?: "game" | "watch" | "";
    avatar?: string;
    open: boolean;
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
}) {
    const { language, seats } = props;
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
                        const rowStyle = {
                            display: "grid",
                            gridTemplateColumns: "auto auto 1fr auto",
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
                                {seat.name ? <PicAvatar uri={seat.avatar} name={seat.name} size={AVATAR_PX} /> : <span />}
                                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                                    <span
                                        style={seat.name
                                            ? { color: achievementGreen, fontWeight: 800, overflowWrap: "anywhere" }
                                            : { ...bodyTextStyle(), fontStyle: "italic" }}
                                    >
                                        {seat.name || t(language, "Waiting for player...")}
                                    </span>
                                    {seat.name && seat.game && (
                                        <span style={{ ...bodyTextStyle(), overflowWrap: "anywhere" }}>{seat.game}</span>
                                    )}
                                </div>
                                <span style={{ ...bodyTextStyle(), textAlign: "right" }}>
                                    {[
                                        seat.tag === "host" ? t(language, "Host") : seat.tag === "you" ? t(language, "You") : "",
                                        seat.activity === "game" ? t(language, "In-Game")
                                            : seat.activity === "watch" ? t(language, "Watching") : ""
                                    ].filter(Boolean).join(" · ")}
                                </span>
                            </>
                        );
                        return (
                            <FocusTarget key={index} focusKey={seatKey(index)} focusFallback={heirs(index)} style={{ width: "100%" }}>
                                <Focusable
                                    focusable
                                    noFocusRing
                                    onActivate={seat.open ? () => props.onSeat(index) : undefined}
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
