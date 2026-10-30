import { DialogButton, PanelSectionRow } from "@decky/ui";

import { FocusTarget } from "../ui/FocusTarget";
import { SectionTitle } from "../ui/SectionTitle";
import { t, type LanguageCode } from "../../locales";
import { achievementGreen, bodyTextStyle, compactButtonStyle } from "../../utils/style";

type RoomTableSeat = { name: string; tag: "host" | "you" | "" };

function dropKey(index: number): string {
    return `multiplayer:drop:${index}`;
}

export function RoomTable(props: {
    language: LanguageCode;
    seats: RoomTableSeat[];
    onDrop?: (index: number) => void;
    exitKey: string;
}) {
    const { language, seats, onDrop } = props;
    const droppable = seats
        .map((seat, index) => (onDrop && index > 0 && seat.name ? index : -1))
        .filter((index) => index > 0);

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
                        return (
                            <div
                                key={index}
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "auto 1fr auto",
                                    alignItems: "center",
                                    gap: "10px",
                                    minHeight: "28px",
                                    padding: "4px 0",
                                    borderTop: index > 0 ? "1px solid rgba(255,255,255,0.12)" : undefined
                                }}
                            >
                                <span style={{ ...bodyTextStyle(), minWidth: "1em", textAlign: "right" }}>{index + 1}</span>
                                <span
                                    style={seat.name
                                        ? { color: achievementGreen, fontWeight: 800, overflowWrap: "anywhere" }
                                        : { ...bodyTextStyle(), fontStyle: "italic" }}
                                >
                                    {seat.name || t(language, "Waiting for player...")}
                                </span>
                                {at >= 0 && onDrop ? (
                                    <div style={{ display: "flex" }}>
                                        <FocusTarget focusKey={dropKey(index)} focusFallback={[...heirs, props.exitKey]}>
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
                            </div>
                        );
                    })}
                </div>
            </PanelSectionRow>
        </>
    );
}
