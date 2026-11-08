import { addEventListener, removeEventListener } from "@decky/api";
import { DialogButton, Focusable } from "@decky/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
// Font Awesome Free icons, CC BY 4.0. See ATTRIBUTIONS.md.
import { FaDoorOpen, FaSignInAlt, FaSignOutAlt, FaUserFriends, FaWifi } from "react-icons/fa";

import { getGameIconCached, multiplayerFriends } from "../../api";
import { useGameIcon } from "../../hooks/useGameIcon";
import { t, type LanguageCode } from "../../locales";
import type { NotificationNav } from "../../notifications/registry";
import type { MultiplayerFriendsState } from "../../types";
import { logError } from "../../utils/errors";
import { hotspotIsOn, leaveHotspot, toggleHotspot, useHotspot } from "../../utils/hotspotState";
import { rememberMultiplayerPage } from "../../utils/multiplayerChoices";
import { endMultiplayerRoom, useMultiplayerRoomMarker } from "../../utils/multiplayerRoomState";
import { modalSize } from "../../utils/scale";
import { achievementGreen, skyBlue } from "../../utils/style";
import { notificationCardMetrics } from "../notifications/NotificationCard";
import { FocusTarget } from "../ui/FocusTarget";
import { openHotspotJoin } from "../hotspot/HotspotJoinModal";

const FRIENDS_EVENT = "cheevodeck_multiplayer_friends";
const ROW_KEY = "notif:multiplayer:room";
const HOTSPOT_KEY = "notif:multiplayer:hotspot";
const JOIN_KEY = "notif:multiplayer:join";
const CLOSE_KEY = "notif:multiplayer:close";
const SIDE_BUTTON = 24;
const SIDE_GAP = 4;
const SIDE_FILL = "rgb(81, 85, 90)";
const TILE_FILL = "rgb(71, 75, 80)";
const TILE_EDGE = "rgb(78, 82, 88)";
const COUNT_MARK = "\u0000";

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

function Counted(props: { language: LanguageCode; text: string; count: number }) {
    const [before, after = ""] = t(props.language, props.text, { count: COUNT_MARK }).split(COUNT_MARK);
    return (
        <span>
            {before}
            <span style={props.count > 0 ? { color: achievementGreen, fontWeight: 700 } : undefined}>{props.count}</span>
            {after}
        </span>
    );
}

function Parts(props: { parts: ReactNode[] }) {
    return (
        <div style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>
            {props.parts.map((part, index) => (
                <span key={index}>
                    {index > 0 && <span style={{ opacity: 0.8 }}>{" · "}</span>}
                    {part}
                </span>
            ))}
        </div>
    );
}

function WaitingLine(props: { language: LanguageCode; waiting: Waiting | null }) {
    const { language, waiting } = props;
    if (!waiting?.on) {
        return null;
    }
    const parts: ReactNode[] = [];
    if (waiting.unread > 0) {
        parts.push(<Counted language={language} text="Unread messages: {{count}}" count={waiting.unread} />);
    }
    if (waiting.requests > 0) {
        parts.push(<Counted language={language} text="Friend requests: {{count}}" count={waiting.requests} />);
    }
    parts.push(<Counted language={language} text="Friends online: {{count}}" count={waiting.online} />);
    return <Parts parts={parts} />;
}

type FocusProps = {
    onMenuButton: () => void;
    onButtonDown: (evt: { detail?: { button?: number } }) => void;
    actionDescriptionMap: Record<number, string>;
};

function SideButton(props: FocusProps & {
    focusKey: string;
    label: string;
    lit: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    const [selected, setSelected] = useState(false);
    const size = modalSize(SIDE_BUTTON);
    return (
        <FocusTarget focusKey={props.focusKey} style={{ position: "relative", display: "flex" }}>
            <DialogButton
                onClick={props.onClick}
                onGamepadFocus={() => setSelected(true)}
                onGamepadBlur={() => setSelected(false)}
                onMenuButton={props.onMenuButton}
                onButtonDown={props.onButtonDown}
                actionDescriptionMap={props.actionDescriptionMap}
                style={{
                    width: `${size}px`,
                    height: `${size}px`,
                    minWidth: 0,
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: selected ? undefined : SIDE_FILL,
                    color: props.lit ? skyBlue : selected ? undefined : "#fff"
                }}
            >
                {props.children}
            </DialogButton>
            {selected && (
                <div
                    style={{
                        position: "absolute",
                        right: `${size + modalSize(6)}px`,
                        top: "50%",
                        transform: "translateY(-50%)",
                        whiteSpace: "nowrap",
                        pointerEvents: "none",
                        padding: `${modalSize(5)}px ${modalSize(10)}px`,
                        borderRadius: `${modalSize(16)}px`,
                        background: "rgba(14, 20, 27, 0.92)",
                        color: "#fff",
                        fontSize: `${modalSize(14)}px`
                    }}
                >
                    {props.label}
                </div>
            )}
        </FocusTarget>
    );
}

export function MultiplayerNotificationRow(props: FocusProps & { language: LanguageCode; nav: NotificationNav; close: () => void }) {
    const { language, nav, close } = props;
    const room = useMultiplayerRoomMarker();
    const hotspot = useHotspot();
    const waiting = useWaiting();
    const inRoom = room.role !== null;
    const box = useRef<HTMLDivElement>(null);
    const metrics = notificationCardMetrics();
    const game = room.own ?? (room.gameId ? { gameId: room.gameId, title: room.title, imageIcon: room.imageIcon } : null);
    const iconGame = inRoom && game ? game.gameId : null;
    const { iconDataUri } = useGameIcon(iconGame, game?.imageIcon, "notifications: EZ card icon");
    useEffect(() => {
        if (iconGame !== null) {
            getGameIconCached(iconGame, game?.imageIcon).catch((e) => logError("notifications: EZ card icon", e));
        }
    }, [iconGame, game?.imageIcon]);

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
        const target = box.current?.querySelector(`[data-focus-key="${HOTSPOT_KEY}"]`);
        (target?.querySelector("button, [tabindex]") as HTMLElement | null | undefined)?.focus();
    }, [inRoom]);

    function open() {
        rememberMultiplayerPage(inRoom ? "play" : "friends");
        nav.openMultiplayer?.();
        close();
    }

    const players = room.size > 0 ? t(language, "{{taken}}/{{count}} players", { taken: room.taken, count: room.size }) : "";
    const gameText = room.own
        ? t(language, "{{game}} · linked with {{other}}", { game: room.own.title, other: room.title })
        : room.title;
    const roomParts: ReactNode[] = inRoom
        ? [
            <span style={{ color: achievementGreen, fontWeight: 700 }}>
                {room.role === "host" ? t(language, "Room open") : t(language, "In {{name}}'s room", { name: room.host })}
            </span>,
            gameText,
            ...(players ? [players] : [])
        ]
        : [];
    const button = modalSize(SIDE_BUTTON);
    const gap = modalSize(SIDE_GAP);
    const inset = modalSize(8);
    const buttons = inRoom ? 3 : 2;
    const hotspotOn = hotspotIsOn(hotspot);
    const joined = hotspot.role === "guest" && hotspot.state !== "stopping";

    return (
        <div ref={box}>
            <Focusable
                flow-children="row"
                onMenuButton={props.onMenuButton}
                onButtonDown={props.onButtonDown}
                actionDescriptionMap={props.actionDescriptionMap}
                style={{ position: "relative", display: "flex", flexDirection: "row", marginBottom: "12px" }}
            >
                <FocusTarget focusKey={ROW_KEY} style={{ flex: 1, minWidth: 0, display: "flex" }}>
                    <DialogButton
                        onClick={open}
                        style={{
                            width: "100%",
                            minWidth: 0,
                            minHeight: `${button * buttons + gap * (buttons - 1) + modalSize(6) * 2}px`,
                            textAlign: "left",
                            paddingRight: `${button + inset * 2}px`,
                            display: "flex",
                            alignItems: "center",
                            gap: `${metrics.iconGap}px`
                        }}
                    >
                        <div
                            style={{
                                width: `${metrics.iconSize}px`,
                                height: `${metrics.iconSize}px`,
                                flex: "none",
                                borderRadius: "7px",
                                overflow: "hidden",
                                background: TILE_FILL,
                                border: `1px solid ${TILE_EDGE}`,
                                boxSizing: "border-box",
                                color: "#dcdedf",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center"
                            }}
                        >
                            {inRoom && iconDataUri
                                ? <img src={iconDataUri} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                : <FaUserFriends style={{ width: "50%", height: "50%", opacity: 0.85 }} />}
                        </div>
                        <div
                            style={{
                                minWidth: 0,
                                display: "flex",
                                flexDirection: "column",
                                gap: `${metrics.contentGap}px`,
                                fontSize: `${metrics.bodyFontSize}px`,
                                lineHeight: metrics.bodyLineHeight
                            }}
                        >
                            <div style={{ fontSize: `${metrics.titleFontSize}px`, fontWeight: 800, lineHeight: metrics.titleLineHeight }}>
                                {t(language, "EZ Multiplayer")}
                            </div>
                            {inRoom && <Parts parts={roomParts} />}
                            <WaitingLine language={language} waiting={waiting} />
                        </div>
                    </DialogButton>
                </FocusTarget>
                <Focusable
                    flow-children="column"
                    style={{
                        position: "absolute",
                        right: `${inset}px`,
                        top: 0,
                        bottom: 0,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        gap: `${gap}px`
                    }}
                >
                    <SideButton
                        {...props}
                        focusKey={HOTSPOT_KEY}
                        label={t(language, joined ? "Connected to Offline Hotspot" : hotspotOn ? "Offline Hotspot On" : "Offline Hotspot Off")}
                        lit={hotspotOn}
                        onClick={() => {
                            if (!joined) {
                                void toggleHotspot();
                            }
                        }}
                    >
                        <FaWifi style={{ width: "60%", height: "60%" }} />
                    </SideButton>
                    <SideButton
                        {...props}
                        focusKey={JOIN_KEY}
                        label={t(language, joined ? "Leave Offline Hotspot" : "Join Offline Hotspot")}
                        lit={false}
                        onClick={joined ? () => void leaveHotspot() : openHotspotJoin}
                    >
                        {joined
                            ? <FaSignOutAlt style={{ width: "60%", height: "60%" }} />
                            : <FaSignInAlt style={{ width: "60%", height: "60%" }} />}
                    </SideButton>
                    {inRoom && (
                        <SideButton
                            {...props}
                            focusKey={CLOSE_KEY}
                            label={t(language, room.role === "host" ? "Close Room" : "Leave Room")}
                            lit={false}
                            onClick={() => void endMultiplayerRoom()}
                        >
                            <FaDoorOpen style={{ width: "60%", height: "60%" }} />
                        </SideButton>
                    )}
                </Focusable>
            </Focusable>
        </div>
    );
}
