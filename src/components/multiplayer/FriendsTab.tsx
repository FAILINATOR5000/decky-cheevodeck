import { DialogButton, Focusable, PanelSectionRow } from "@decky/ui";
import { useMemo, useState, type MutableRefObject } from "react";

import { multiplayerFriendAdd, multiplayerFriendAlert, multiplayerFriendAnswer } from "../../api";
import { pendingLandingKey, type LandingWindows } from "../../focusRecords";
import { useSlidingWindow } from "../../hooks/useSlidingWindow";
import { t, type LanguageCode } from "../../locales";
import type { MultiplayerFriend, MultiplayerFriendRequest, MultiplayerSuggestion } from "../../types";
import { logError } from "../../utils/errors";
import { formatRelativeTime } from "../../utils/format";
import { textSize } from "../../utils/scale";
import { achievementGreen, bodyTextStyle, compactButtonStyle, warnAmber } from "../../utils/style";
import { FocusableItem } from "../ui/FocusableItem";
import { FocusTarget } from "../ui/FocusTarget";
import { SectionTitle } from "../ui/SectionTitle";
import { SlidingWindowRows } from "../ui/SlidingWindowRows";
import { friendError, openAddFriend } from "./AddFriendModal";
import { openFriendCard } from "./FriendCardModal";
import { openMessageCenter } from "./MessageCenterModal";
import { showMultiplayerProblem } from "./ProblemModal";
import { useMultiplayer } from "./MultiplayerContext";
import { PicAvatar, friendGame, friendName, friendStatus } from "./PicAvatar";

const AVATAR_PX = 32;
const ADD_KEY = "multiplayer:friends:add";
const NAV_ENTER_MAINTAIN_Y = 3;
const ALERTS_SHOWN = 2;

type WindowKnobs = {
    dynamicLoading: boolean;
    initialRows: number;
    rowStep: number;
    prefetchDistance: number;
    sentinelRootMarginPx: number;
};

type Item =
    | { kind: "header"; key: string; labelKey: string }
    | { kind: "suggestion"; row: MultiplayerSuggestion }
    | { kind: "request"; row: MultiplayerFriendRequest }
    | { kind: "friend"; row: MultiplayerFriend };

function itemKey(item: Item): string {
    return item.kind === "header" ? item.key : `${item.kind}:${item.row.ulid}`;
}

function focusKeyFor(item: Item): string {
    return item.kind === "header" ? "" : `multiplayer:${item.kind}:${item.row.ulid}`;
}

type FriendsTabProps = {
    language: LanguageCode;
    knobs: WindowKnobs;
    landingWindows: MutableRefObject<LandingWindows | null>;
};

export function FriendsTab(props: FriendsTabProps) {
    const { language, knobs } = props;
    const { state: mp, friends } = useMultiplayer();
    const data = friends.state.data;
    const avatars = friends.state.avatars;
    const [busy, setBusy] = useState(false);
    const [openFirst] = useState(() => pendingLandingKey("multiplayer") ?? undefined);

    const items = useMemo(() => {
        const out: Item[] = [];
        if (!data) {
            return out;
        }
        if (data.suggestions.length > 0) {
            out.push({ kind: "header", key: "header:suggestions", labelKey: "Suggested" });
            out.push(...data.suggestions.map((row) => ({ kind: "suggestion" as const, row })));
        }
        if (data.requests.length > 0) {
            out.push({ kind: "header", key: "header:requests", labelKey: "Requests" });
            out.push(...data.requests.map((row) => ({ kind: "request" as const, row })));
        }
        if (data.friends.length > 0) {
            out.push({ kind: "header", key: "header:friends", labelKey: "Friends" });
            out.push(...data.friends.map((row) => ({ kind: "friend" as const, row })));
        }
        return out;
    }, [data]);

    const list = useSlidingWindow({
        items,
        itemKey,
        focusKeyFor,
        windowId: "multiplayer:friends",
        heightScope: ["multiplayer:friends", language, textSize(12)].join("|"),
        dynamicLoading: knobs.dynamicLoading,
        initialRows: knobs.initialRows,
        rowStep: knobs.rowStep,
        prefetchDistance: knobs.prefetchDistance,
        sentinelRootMarginPx: knobs.sentinelRootMarginPx,
        resetKey: "multiplayer:friends",
        openFirst
    });
    props.landingWindows.current = {
        holds: (key) => items.some((item) => focusKeyFor(item) === key),
        open: (key) => list.openAt(key)
    };

    function heirs(at: number, kind: Item["kind"]): string[] {
        const keys = [items[at + 1], items[at - 1]]
            .filter((other): other is Item => other !== undefined && other.kind === kind)
            .map(focusKeyFor);
        return [...keys, ADD_KEY, "multiplayer:back"];
    }

    async function act(task: () => Promise<{ ok: boolean; error?: string }>) {
        setBusy(true);
        try {
            const done = await task();
            if (!done.ok) {
                showMultiplayerProblem(language, "Couldn't Update Your Friends", friendError(language, done.error ?? "unavailable"));
            }
        }
        catch (e) {
            logError("multiplayer friends", e);
            showMultiplayerProblem(language, "Couldn't Update Your Friends", friendError(language, "unavailable"));
        }
        setBusy(false);
        await friends.actions.reload();
    }

    const inRoom = mp.hosted !== null || mp.joined !== null;
    const status = !data ? ""
        : !data.on ? "Friends are off. Turn them on in Options, Social."
            : !data.server ? "Set a lobby server in Options first"
                : data.refused ? "The lobby server refused this device"
                    : !data.up ? "Connecting to the lobby server..." : "";

    return (
        <>
            <PanelSectionRow>
                <div style={bodyTextStyle()}>{t(language, "help_mp_friends_tab")}</div>
            </PanelSectionRow>
            {status && (
                <PanelSectionRow>
                    <div style={{ ...bodyTextStyle(), color: warnAmber, opacity: 1 }}>{t(language, status)}</div>
                </PanelSectionRow>
            )}
            <PanelSectionRow>
                <FocusableItem
                    focusKey={ADD_KEY}
                    focusFallback={["multiplayer:tab:friends", "multiplayer:back"]}
                    disabled={!data?.on || !data.server}
                    onClick={() => openAddFriend(language)}
                >
                    {t(language, "Add Friend")}
                </FocusableItem>
            </PanelSectionRow>
            {(data?.alerts ?? []).slice(-ALERTS_SHOWN).map((alert) => (
                <PanelSectionRow key={alert.device}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%", padding: "4px 0" }}>
                        <div style={{ ...bodyTextStyle(), color: warnAmber, opacity: 1 }}>
                            {t(language, "Your account went online on another device {{when}}.", {
                                when: formatRelativeTime(new Date(alert.at * 1000).toISOString(), language)
                            })}
                        </div>
                        <Focusable flow-children="row" style={{ display: "flex", gap: "8px" }}>
                            <FocusTarget
                                focusKey={`multiplayer:alert:${alert.device}`}
                                focusFallback={[ADD_KEY, "multiplayer:back"]}
                                style={{ display: "flex", flex: 1 }}
                            >
                                <DialogButton
                                    style={{ ...compactButtonStyle, width: "100%" }}
                                    disabled={busy}
                                    onClick={() => void act(() => multiplayerFriendAlert(alert.device, true))}
                                >
                                    {t(language, "That Wasn't Me")}
                                </DialogButton>
                            </FocusTarget>
                            <FocusTarget
                                focusKey={`multiplayer:alertok:${alert.device}`}
                                focusFallback={[ADD_KEY, "multiplayer:back"]}
                                style={{ display: "flex", flex: 1 }}
                            >
                                <DialogButton
                                    style={{ ...compactButtonStyle, width: "100%" }}
                                    disabled={busy}
                                    onClick={() => void act(() => multiplayerFriendAlert(alert.device, false))}
                                >
                                    {t(language, "That Was Me")}
                                </DialogButton>
                            </FocusTarget>
                        </Focusable>
                    </div>
                </PanelSectionRow>
            ))}
            {data && items.length === 0 && (
                <PanelSectionRow>
                    <div style={bodyTextStyle()}>{t(language, "No friends yet. Add someone by their RetroAchievements name.")}</div>
                </PanelSectionRow>
            )}
            <Focusable flow-children="column" resetNavOnEntry navEntryPreferPosition={NAV_ENTER_MAINTAIN_Y}>
                <SlidingWindowRows list={list}>
                    {list.mountedItems.map((item, index) => {
                        const at = list.start + index;
                        if (item.kind === "header") {
                            return <SectionTitle key={item.key} label={t(language, item.labelKey)} />;
                        }
                        const row = item.row;
                        const key = focusKeyFor(item);
                        const nameLine = (
                            <div style={{ display: "flex", gap: "10px", alignItems: "center", minWidth: 0, width: "100%", textAlign: "left" }}>
                                <PicAvatar uri={avatars[row.pic]} name={row.name} size={AVATAR_PX} />
                                <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                                    <span style={{ fontWeight: 800, overflowWrap: "anywhere" }}>
                                        {item.kind === "friend" ? friendName(item.row) : row.name}
                                    </span>
                                    {item.kind === "friend" && (
                                        <span style={bodyTextStyle()}>
                                            <span style={{ opacity: 1, color: item.row.online ? achievementGreen : undefined }}>
                                                {friendStatus(language, item.row)}
                                            </span>
                                            {item.row.raFriend && ` · ${t(language, "RA friend")}`}
                                            {friendGame(item.row) && <div style={{ overflowWrap: "anywhere" }}>{friendGame(item.row)}</div>}
                                            {item.row.unread > 0 && (
                                                <span style={{ color: achievementGreen, fontWeight: 800 }}>
                                                    {` · ${t(language, "{{count}} new", { count: item.row.unread })}`}
                                                </span>
                                            )}
                                        </span>
                                    )}
                                    {item.kind === "request" && (
                                        <span style={bodyTextStyle()}>
                                            {t(language, item.row.way === "in" ? "Wants to be friends" : "Request sent")}
                                        </span>
                                    )}
                                    {item.kind === "suggestion" && (
                                        <span style={bodyTextStyle()}>{t(language, "RA friend · Online")}</span>
                                    )}
                                </div>
                            </div>
                        );
                        if (item.kind === "friend") {
                            const friend = item.row;
                            return (
                                <PanelSectionRow key={key}>
                                    <FocusableItem
                                        focusKey={key}
                                        focusFallback={heirs(at, "friend")}
                                        onGamepadFocus={() => list.onItemFocus(at)}
                                        onGamepadDirection={list.guardTopRow(at)}
                                        onClick={() => openFriendCard(language, {
                                            friend,
                                            avatar: avatars[friend.pic],
                                            inRoom,
                                            hardcore: mp.hardcore,
                                            heirs: heirs(at, "friend"),
                                            openMessages: () => openMessageCenter(language, {
                                                friend,
                                                avatars,
                                                selfPic: data?.selfPic ?? ""
                                            })
                                        })}
                                    >
                                        {nameLine}
                                    </FocusableItem>
                                </PanelSectionRow>
                            );
                        }
                        if (item.kind === "suggestion") {
                            return (
                                <PanelSectionRow key={key}>
                                    <FocusableItem
                                        focusKey={key}
                                        focusFallback={heirs(at, "suggestion")}
                                        disabled={busy}
                                        onGamepadFocus={() => list.onItemFocus(at)}
                                        onGamepadDirection={list.guardTopRow(at)}
                                        onClick={() => void act(() => multiplayerFriendAdd(item.row.name))}
                                    >
                                        {nameLine}
                                    </FocusableItem>
                                </PanelSectionRow>
                            );
                        }
                        const request = item.row;
                        const after = [`multiplayer:friend:${request.ulid}`, ...heirs(at, "request")];
                        return (
                            <PanelSectionRow key={key}>
                                <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%", padding: "4px 0" }}>
                                    {nameLine}
                                    <Focusable flow-children="row" style={{ display: "flex", gap: "8px" }}>
                                        <FocusTarget key={key} focusKey={key} focusFallback={after} style={{ display: "flex", flex: 1 }}>
                                            <DialogButton
                                                style={{ ...compactButtonStyle, width: "100%" }}
                                                disabled={busy}
                                                onGamepadFocus={() => list.onItemFocus(at)}
                                                onGamepadDirection={list.guardTopRow(at)}
                                                onClick={() => void act(() => multiplayerFriendAnswer(request.ulid, request.way === "in"))}
                                            >
                                                {t(language, request.way === "in" ? "Accept" : "Cancel Request")}
                                            </DialogButton>
                                        </FocusTarget>
                                        {request.way === "in" && (
                                            <FocusTarget
                                                focusKey={`multiplayer:decline:${request.ulid}`}
                                                focusFallback={[key, ...after]}
                                                style={{ display: "flex", flex: 1 }}
                                            >
                                                <DialogButton
                                                    style={{ ...compactButtonStyle, width: "100%" }}
                                                    disabled={busy}
                                                    onGamepadFocus={() => list.onItemFocus(at)}
                                                    onGamepadDirection={list.guardTopRow(at)}
                                                    onClick={() => void act(() => multiplayerFriendAnswer(request.ulid, false))}
                                                >
                                                    {t(language, "Decline")}
                                                </DialogButton>
                                            </FocusTarget>
                                        )}
                                    </Focusable>
                                </div>
                            </PanelSectionRow>
                        );
                    })}
                </SlidingWindowRows>
            </Focusable>
        </>
    );
}
