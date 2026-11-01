import { DialogButton, Focusable, PanelSectionRow } from "@decky/ui";
import { useState } from "react";

import { FocusTarget } from "../ui/FocusTarget";
import { SectionTitle } from "../ui/SectionTitle";
import { t, type LanguageCode } from "../../locales";
import { achievementGreen, bodyTextStyle, compactButtonStyle, errorRed, masteredGold } from "../../utils/style";

type RoomTableSeat = { name: string; game: string; tag: "host" | "you" | ""; mark?: "ready" | "cant" | "" };

const STEPPED_ABOVE = 4;

function dropKey(index: number): string {
    return `multiplayer:drop:${index}`;
}

function seatKey(index: number): string {
    return `multiplayer:seat:${index}`;
}

export function RoomTable(props: {
    language: LanguageCode;
    seats: RoomTableSeat[];
    onDrop?: (index: number) => void;
    exitKey: string;
}) {
    const { language, seats, onDrop } = props;
    const [focused, setFocused] = useState(-1);
    const stepped = seats.length > STEPPED_ABOVE;
    const droppable = seats
        .map((seat, index) => (onDrop && index > 0 && seat.name ? index : -1))
        .filter((index) => index > 0);

    function seatHeirs(index: number): string[] {
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
                        const at = droppable.indexOf(index);
                        const heirs = [droppable[at + 1], droppable[at - 1]]
                            .filter((other): other is number => other !== undefined)
                            .map(dropKey);
                        const rowStyle = {
                            display: "grid",
                            gridTemplateColumns: "auto 1fr auto",
                            alignItems: "center",
                            gap: "10px",
                            minHeight: "28px",
                            padding: stepped ? "4px 8px" : "4px 0",
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
                                {at >= 0 && onDrop ? (
                                    <div style={{ display: "flex" }}>
                                        <FocusTarget
                                            focusKey={stepped ? seatKey(index) : dropKey(index)}
                                            focusFallback={stepped ? seatHeirs(index) : [...heirs, props.exitKey]}
                                        >
                                            <DialogButton style={compactButtonStyle} onClick={() => onDrop(index)}>
                                                {t(language, "Drop")}
                                            </DialogButton>
                                        </FocusTarget>
                                    </div>
                                ) : (
                                    <span style={bodyTextStyle()}>
                                        {seat.tag === "host" ? t(language, "Host") : seat.tag === "you" ? t(language, "You") : ""}
                                    </span>
                                )}
                            </>
                        );
                        if (!stepped || (at >= 0 && onDrop)) {
                            return <div key={index} style={rowStyle}>{cells}</div>;
                        }
                        return (
                            <FocusTarget key={index} focusKey={seatKey(index)} focusFallback={seatHeirs(index)} style={{ width: "100%" }}>
                                <Focusable
                                    focusable
                                    noFocusRing
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
