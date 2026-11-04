import { addEventListener, removeEventListener } from "@decky/api";
import { DialogButton, Focusable } from "@decky/ui";
import { useEffect, useRef, useState } from "react";

import { multiplayerFriends } from "../../api";
import { t, type LanguageCode } from "../../locales";
import type { NotificationNav } from "../../notifications/registry";
import type { MultiplayerFriendsState } from "../../types";
import { logError } from "../../utils/errors";
import { rememberMultiplayerPage } from "../../utils/multiplayerChoices";
import { endMultiplayerRoom, useMultiplayerRoomMarker } from "../../utils/multiplayerRoomState";
import { achievementGreen } from "../../utils/style";
import { FocusTarget } from "../ui/FocusTarget";

const FRIENDS_EVENT = "cheevodeck_multiplayer_friends";
const ROW_KEY = "notif:multiplayer:room";

type Waiting = { on: boolean; unread: number; requests: number; online: number };

function useWaiting(): Waiting | null {
    const [waiting, setWaiting] = useState<Waiting | null>(null);
    useEffect(() => {
        let alive = true;
        let running = false;
        let again = false;
        const count = (state: MultiplayerFriendsState): Waiting => ({
            on: state.on,
            unread: (state.friends ?? []).reduce((sum, friend) => sum + friend.unread, 0),
            requests: (state.requests ?? []).filter((request) => request.way === "in").length,
            online: (state.friends ?? []).filter((friend) => friend.online).length
        });
        async function load() {
            if (running) {
                again = true;
                return;
            }
            running = true;
            try {
                do {
                    again = false;
                    const state = await multiplayerFriends();
                    if (alive && state.ok) {
                        setWaiting(count(state));
                    }
                } while (again && alive);
            }
            catch (e) {
                logError("multiplayerFriends", e);
            }
            finally {
                running = false;
            }
        }
        void load();
        const onChanged = () => {
            void load();
        };
        addEventListener(FRIENDS_EVENT, onChanged);
        return () => {
            alive = false;
            removeEventListener(FRIENDS_EVENT, onChanged);
        };
    }, []);
    return waiting;
}

function WaitingLine(props: { language: LanguageCode; waiting: Waiting | null }) {
    const { language, waiting } = props;
    if (!waiting?.on) {
        return null;
    }
    const parts = [
        waiting.unread > 0 ? { text: t(language, "Unread messages: {{count}}", { count: waiting.unread }), lit: true } : null,
        waiting.requests > 0 ? { text: t(language, "Friend requests: {{count}}", { count: waiting.requests }), lit: true } : null,
        { text: t(language, "Friends online: {{count}}", { count: waiting.online }), lit: waiting.online > 0 }
    ].filter((part): part is { text: string; lit: boolean } => part !== null);
    return (
        <div style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>
            {parts.map((part, index) => (
                <span key={part.text}>
                    {index > 0 && <span style={{ opacity: 0.8 }}>{" · "}</span>}
                    <span style={part.lit ? { color: achievementGreen } : { opacity: 0.8 }}>{part.text}</span>
                </span>
            ))}
        </div>
    );
}

type FocusProps = {
    onMenuButton: () => void;
    onButtonDown: (evt: { detail?: { button?: number } }) => void;
    actionDescriptionMap: Record<number, string>;
};

export function MultiplayerNotificationRow(props: FocusProps & { language: LanguageCode; nav: NotificationNav; close: () => void }) {
    const { language, nav, close } = props;
    const room = useMultiplayerRoomMarker();
    const waiting = useWaiting();
    const inRoom = room.role !== null;
    const box = useRef<HTMLDivElement>(null);

    const wasInRoom = useRef(inRoom);
    useEffect(() => {
        const was = wasInRoom.current;
        wasInRoom.current = inRoom;
        if (inRoom || !was) {
            return;
        }
        const doc = box.current?.ownerDocument;
        const active = doc?.activeElement;
        if (!doc || (active && active !== doc.body && active.isConnected)) {
            return;
        }
        const row = box.current?.querySelector(`[data-focus-key="${ROW_KEY}"]`);
        (row?.querySelector("button, [tabindex]") as HTMLElement | null | undefined)?.focus();
    }, [inRoom]);

    function open() {
        rememberMultiplayerPage(inRoom ? "play" : "friends");
        nav.openMultiplayer?.();
        close();
    }

    return (
        <div ref={box}>
            <Focusable
                flow-children="row"
                onMenuButton={props.onMenuButton}
                onButtonDown={props.onButtonDown}
                actionDescriptionMap={props.actionDescriptionMap}
                style={{ display: "flex", flexDirection: "row", alignItems: "stretch", gap: "8px", marginBottom: "12px" }}
            >
                <FocusTarget focusKey={ROW_KEY} style={{ flex: 1, minWidth: 0, display: "flex" }}>
                    <DialogButton onClick={open} style={{ width: "100%", minWidth: 0, textAlign: "left" }}>
                        <div style={{ color: inRoom ? achievementGreen : undefined, fontWeight: 700, whiteSpace: "normal", overflowWrap: "anywhere" }}>
                            {room.role === "host"
                                ? t(language, "EZ Multiplayer room open")
                                : room.role === "guest"
                                    ? t(language, "In {{name}}'s EZ Multiplayer room", { name: room.host })
                                    : t(language, "EZ Multiplayer")}
                        </div>
                        {inRoom && (
                            <div style={{ opacity: 0.8, whiteSpace: "normal", overflowWrap: "anywhere" }}>{room.title}</div>
                        )}
                        <WaitingLine language={language} waiting={waiting} />
                    </DialogButton>
                </FocusTarget>
                {inRoom && (
                    <FocusTarget focusKey="notif:multiplayer:close" style={{ display: "flex" }}>
                        <DialogButton onClick={() => void endMultiplayerRoom()} style={{ minWidth: 0, width: "auto" }}>
                            {t(language, room.role === "host" ? "Close Room" : "Leave Room")}
                        </DialogButton>
                    </FocusTarget>
                )}
            </Focusable>
        </div>
    );
}
