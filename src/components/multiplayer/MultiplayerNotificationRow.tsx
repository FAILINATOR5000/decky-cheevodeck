import { addEventListener, removeEventListener } from "@decky/api";
import { DialogButton, Focusable } from "@decky/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
// Font Awesome Free icons, CC BY 4.0. See ATTRIBUTIONS.md.
import { FaDoorOpen, FaSearch, FaSignInAlt, FaSignOutAlt, FaUserFriends, FaWifi } from "react-icons/fa";

import { multiplayerFriends, multiplayerGames } from "../../api";
import { useFocusClaim } from "../../hooks/useFocusClaim";
import { t, type LanguageCode } from "../../locales";
import type { NotificationNav } from "../../notifications/registry";
import type { MultiplayerFriendsState, MultiplayerTab } from "../../types";
import { logError } from "../../utils/errors";
import { hotspotIsOn, leaveHotspot, toggleHotspot, useHotspot } from "../../utils/hotspotState";
import { multiplayerChoices, rememberMultiplayerPage } from "../../utils/multiplayerChoices";
import { problemText } from "../../utils/multiplayerProblems";
import { endMultiplayerRoom, useMultiplayerRoomMarker } from "../../utils/multiplayerRoomState";
import { COLLAGE_ROWS, type CardCollage } from "../../utils/playTogetherCollage";
import { modalSize } from "../../utils/scale";
import { achievementGreen, skyBlue } from "../../utils/style";
import { notificationCardMetrics } from "../notifications/NotificationCard";
import { FocusClaim } from "../ui/FocusClaim";
import { FocusTarget } from "../ui/FocusTarget";
import { openHotspotJoin } from "../hotspot/HotspotJoinModal";
import { openRooms } from "./RoomsModal";

const FRIENDS_EVENT = "cheevodeck_multiplayer_friends";
const ROW_KEY = "notif:multiplayer:room";
const HOTSPOT_KEY = "notif:multiplayer:hotspot";
const JOIN_KEY = "notif:multiplayer:join";
const FRIENDS_KEY = "notif:multiplayer:friends";
const FIND_KEY = "notif:multiplayer:find";
const CLOSE_KEY = "notif:multiplayer:close";
const SIDE_BUTTON = 24;
const SIDE_GAP = 4;
const SIDE_FILL = "rgb(81, 85, 90)";
const TILE_FILL = "rgb(71, 75, 80)";
const TILE_EDGE = "rgb(78, 82, 88)";
const COLLAGE_CELL = 40;
const COLLAGE_OPACITY = 0.3;
const COLLAGE_OPACITY_LIT = 0.16;
const COLLAGE_FADE = "61, 67, 75";
const COLLAGE_FADE_LIT = "255, 255, 255";
const COUNT_MARK = "\u0000";

type Waiting = { on: boolean; unread: number; requests: number; online: number };

let lastWaiting: Waiting | null = null;

function useWaiting(): Waiting | null {
    const [waiting, setWaiting] = useState<Waiting | null>(lastWaiting);
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
                        lastWaiting = count(state);
                        setWaiting(lastWaiting);
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
    if (waiting === null) {
        return <div>{"\u00a0"}</div>;
    }
    if (!waiting.on) {
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
    onCursor: (here: boolean) => void;
    children: ReactNode;
}) {
    const [selected, setSelected] = useState(false);
    const size = modalSize(SIDE_BUTTON);
    return (
        <FocusTarget focusKey={props.focusKey} style={{ position: "relative", display: "flex" }}>
            <DialogButton
                onClick={props.onClick}
                onGamepadFocus={() => {
                    setSelected(true);
                    props.onCursor(true);
                }}
                onGamepadBlur={() => {
                    setSelected(false);
                    props.onCursor(false);
                }}
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

function CollageLayer(props: { image: string; lit: boolean }) {
    const fade = props.lit ? COLLAGE_FADE_LIT : COLLAGE_FADE;
    return (
        <div style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: "inherit", pointerEvents: "none" }}>
            <img
                src={props.image}
                style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    height: `${modalSize(COLLAGE_CELL) * COLLAGE_ROWS}px`,
                    width: "auto",
                    maxWidth: "none",
                    opacity: props.lit ? COLLAGE_OPACITY_LIT : COLLAGE_OPACITY
                }}
            />
            <div
                style={{
                    position: "absolute",
                    inset: 0,
                    background: `linear-gradient(90deg, rgba(${fade}, 0.92), rgba(${fade}, 0.55) 55%, rgba(${fade}, 0.15))`
                }}
            />
        </div>
    );
}

function CollageTile(props: { collage: CardCollage }) {
    return (
        <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: "1px" }}>
            {props.collage.tile.map((uri, index) => (
                <img key={index} src={uri} style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0, objectFit: "cover", display: "block" }} />
            ))}
        </div>
    );
}

export function MultiplayerNotificationRow(props: FocusProps & {
    collage: CardCollage | null;
    language: LanguageCode;
    nav: NotificationNav;
    close: () => void;
}) {
    const { collage, language, nav, close } = props;
    const room = useMultiplayerRoomMarker();
    const hotspot = useHotspot();
    const waiting = useWaiting();
    const inRoom = room.role !== null;
    const hotspotOn = hotspotIsOn(hotspot);
    const joined = hotspot.role === "guest" && hotspot.state !== "stopping";
    const hosting = hotspot.role === "host" && hotspot.state !== "stopping";
    const box = useRef<HTMLDivElement>(null);
    const finding = useRef(false);
    const metrics = notificationCardMetrics();
    const [onCard, setOnCard] = useState(false);

    const onSide = useRef(false);
    const moves = useRef(0);
    function sideCursor(here: boolean) {
        const move = ++moves.current;
        if (here) {
            onSide.current = true;
            return;
        }
        queueMicrotask(() => {
            if (moves.current === move) {
                onSide.current = false;
            }
        });
    }
    function cardCursor() {
        moves.current += 1;
        onSide.current = false;
        setOnCard(true);
    }
    const cardClaim = useFocusClaim();
    const layout = `${inRoom}|${joined}`;
    const lastLayout = useRef(layout);
    useEffect(() => {
        if (lastLayout.current === layout) {
            return;
        }
        lastLayout.current = layout;
        if (onSide.current) {
            cardClaim.claimSlot(0);
        }
    }, [layout, cardClaim.claimSlot]);

    function open(page: MultiplayerTab) {
        rememberMultiplayerPage(page);
        nav.openMultiplayer?.();
        close();
    }

    async function findRoom() {
        if (finding.current) {
            return;
        }
        finding.current = true;
        let cores: string[] = [];
        try {
            cores = (await multiplayerGames()).installedCores ?? [];
        }
        catch (e) {
            logError("notifications: Find a Room's installed cores", e);
        }
        openRooms(language, multiplayerChoices().hardcore, cores, (code, detail) => problemText(language, code, detail), () => {
            rememberMultiplayerPage("play");
            nav.openMultiplayer?.("multiplayer:play");
        });
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
    const buttons = 4;

    return (
        <div ref={box}>
            <Focusable
                flow-children="row"
                onMenuButton={props.onMenuButton}
                onButtonDown={props.onButtonDown}
                actionDescriptionMap={props.actionDescriptionMap}
                style={{ position: "relative", display: "flex", flexDirection: "row", marginBottom: "12px" }}
            >
                <FocusTarget focusKey={ROW_KEY} style={{ flex: 1, minWidth: 0, display: "flex", isolation: "isolate" }}>
                    <FocusClaim
                        token={cardClaim.claim?.token ?? 0}
                        armed={cardClaim.claim?.armed ?? false}
                        onSpent={cardClaim.spend}
                        style={{ flex: 1, minWidth: 0, display: "flex" }}
                    >
                        <DialogButton
                            onClick={() => open("play")}
                            onGamepadFocus={cardCursor}
                            onGamepadBlur={() => setOnCard(false)}
                            style={{
                                position: "relative",
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
                            {collage && <CollageLayer image={collage.image} lit={onCard} />}
                            <div
                                style={{
                                    position: "relative",
                                    zIndex: 1,
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
                                {collage
                                    ? <CollageTile collage={collage} />
                                    : <FaUserFriends style={{ width: "50%", height: "50%", opacity: 0.85 }} />}
                            </div>
                            <div
                                style={{
                                    position: "relative",
                                    zIndex: 1,
                                    minWidth: 0,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: `${metrics.contentGap}px`,
                                    fontSize: `${metrics.bodyFontSize}px`,
                                    lineHeight: metrics.bodyLineHeight
                                }}
                            >
                                <div style={{ fontSize: `${metrics.titleFontSize}px`, fontWeight: 800, lineHeight: metrics.titleLineHeight }}>
                                    {t(language, "Play Together")}
                                </div>
                                {inRoom && <Parts parts={roomParts} />}
                                <WaitingLine language={language} waiting={waiting} />
                            </div>
                        </DialogButton>
                    </FocusClaim>
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
                        onCursor={sideCursor}
                        focusKey={FRIENDS_KEY}
                        label={t(language, "Play Together Friends")}
                        lit={false}
                        onClick={() => open("friends")}
                    >
                        <FaUserFriends style={{ width: "60%", height: "60%" }} />
                    </SideButton>
                    {!inRoom && (
                        <SideButton
                            {...props}
                            onCursor={sideCursor}
                            focusKey={FIND_KEY}
                            label={t(language, "Find a Room")}
                            lit={false}
                            onClick={() => void findRoom()}
                        >
                            <FaSearch style={{ width: "60%", height: "60%" }} />
                        </SideButton>
                    )}
                    <SideButton
                        {...props}
                        onCursor={sideCursor}
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
                    {!hosting && (
                        <SideButton
                            {...props}
                            onCursor={sideCursor}
                            focusKey={JOIN_KEY}
                            label={t(language, joined ? "Leave Offline Hotspot" : "Join Offline Hotspot")}
                            lit={false}
                            onClick={joined ? () => void leaveHotspot() : openHotspotJoin}
                        >
                            {joined
                                ? <FaSignOutAlt style={{ width: "60%", height: "60%" }} />
                                : <FaSignInAlt style={{ width: "60%", height: "60%" }} />}
                        </SideButton>
                    )}
                    {inRoom && (
                        <SideButton
                            {...props}
                            onCursor={sideCursor}
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
