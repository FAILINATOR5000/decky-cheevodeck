// Font Awesome Free icons, CC BY 4.0. See ATTRIBUTIONS.md.
import { DialogButton, Focusable, PanelSectionRow } from "@decky/ui";
import { useState } from "react";
import { FaBroadcastTower, FaChessBoard, FaUsers, FaVolumeUp, FaVoteYea } from "react-icons/fa";

import { t, type LanguageCode } from "../../locales";
import type { MultiplayerRoomTab } from "../../types";
import { achievementGreen, bodyTextStyle } from "../../utils/style";
import { FocusTarget } from "../ui/FocusTarget";

export const ROOM_TABS: { tab: MultiplayerRoomTab; Icon: typeof FaUsers; labelKey: string }[] = [
    { tab: "room", Icon: FaUsers, labelKey: "Room" },
    { tab: "vote", Icon: FaVoteYea, labelKey: "Game Vote" },
    { tab: "lounge", Icon: FaChessBoard, labelKey: "Lounge" },
    { tab: "audio", Icon: FaVolumeUp, labelKey: "Audio" },
    { tab: "stream", Icon: FaBroadcastTower, labelKey: "Stream Options" }
];

function roomTabKey(tab: MultiplayerRoomTab): string {
    return `multiplayer:roomtab:${tab}`;
}

export function RoomTabs(props: {
    language: LanguageCode;
    active: MultiplayerRoomTab;
    disabled: Partial<Record<MultiplayerRoomTab, boolean>>;
    dot: Partial<Record<MultiplayerRoomTab, boolean>>;
    onPick: (tab: MultiplayerRoomTab) => void;
    onDisabled: (tab: MultiplayerRoomTab) => void;
    focusFallback: string[];
}) {
    const { language, active } = props;
    const [focused, setFocused] = useState<MultiplayerRoomTab | null>(null);
    const named = ROOM_TABS.find((entry) => entry.tab === (focused ?? active)) ?? ROOM_TABS[0];
    return (
        <PanelSectionRow>
            <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "6px", padding: "10px 0 0 0" }}>
                <Focusable
                    flow-children="row"
                    style={{ display: "flex", gap: "8px", width: "100%", justifyContent: "space-between" }}
                >
                    {ROOM_TABS.map((entry) => {
                        const selected = entry.tab === active;
                        const off = Boolean(props.disabled[entry.tab]);
                        const here = focused === entry.tab;
                        return (
                            <FocusTarget
                                key={entry.tab}
                                focusKey={roomTabKey(entry.tab)}
                                focusFallback={[roomTabKey(active), ...props.focusFallback]}
                                style={{ display: "flex" }}
                            >
                                <DialogButton
                                    onClick={() => (off ? props.onDisabled(entry.tab) : props.onPick(entry.tab))}
                                    onGamepadFocus={() => setFocused(entry.tab)}
                                    onGamepadBlur={() => setFocused((current) => (current === entry.tab ? null : current))}
                                    style={{
                                        position: "relative",
                                        minWidth: 0,
                                        width: "42px",
                                        height: "38px",
                                        padding: "4px 2px",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        opacity: off ? 0.35 : selected || here ? 1 : 0.72,
                                        color: selected && !here ? achievementGreen : undefined,
                                        outline: selected ? `2px solid ${achievementGreen}` : undefined,
                                        background: selected && !here ? "rgba(34, 197, 94, 0.16)" : undefined
                                    }}
                                >
                                    <entry.Icon size={18} />
                                    {props.dot[entry.tab] && (
                                        <span
                                            style={{
                                                position: "absolute",
                                                top: "4px",
                                                right: "5px",
                                                width: "7px",
                                                height: "7px",
                                                borderRadius: "50%",
                                                background: achievementGreen
                                            }}
                                        />
                                    )}
                                </DialogButton>
                            </FocusTarget>
                        );
                    })}
                </Focusable>
                <div style={{ ...bodyTextStyle(), width: "100%", textAlign: "center", fontWeight: 700, opacity: 0.95 }}>
                    {t(language, named.labelKey)}
                </div>
            </div>
        </PanelSectionRow>
    );
}
