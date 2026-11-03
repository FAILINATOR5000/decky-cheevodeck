import { addEventListener, removeEventListener } from "@decky/api";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { multiplayerFriendAvatars, multiplayerFriendMessages, multiplayerFriends } from "../../api";
import { useSlidingWindow } from "../../hooks/useSlidingWindow";
import { t, type LanguageCode } from "../../locales";
import type { MultiplayerFriend, MultiplayerMessage } from "../../types";
import { logError } from "../../utils/errors";
import { formatRelativeTime } from "../../utils/format";
import { showManagedModal } from "../../utils/modalRegistry";
import { getCurrentModalScale, modalSize } from "../../utils/scale";
import { achievementGreen, compactButtonStyle, modalBodyStyle } from "../../utils/style";
import { FocusableItem } from "../ui/FocusableItem";
import { SlidingWindowRows } from "../ui/SlidingWindowRows";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { SubTabButton } from "../ui/SubTabButton";
import { openMessageSay } from "./MessageSayModal";
import { PicAvatar, Pill, friendGame, friendName, friendStatus } from "./PicAvatar";

const FRIENDS_EVENT = "cheevodeck_multiplayer_friends";
const NAV_ENTER_MAINTAIN_Y = 3;
const SAY_KEY = "multiplayer:mc:say";
const CLOSE_KEY = "multiplayer:mc:close";
const LAND_TRIES = 3;
const DAY = 86400;
const AGES = [
    { key: "week", labelKey: "Week", seconds: 7 * DAY },
    { key: "month", labelKey: "Month", seconds: 31 * DAY },
    { key: "quarter", labelKey: "3 Months", seconds: 92 * DAY },
    { key: "all", labelKey: "All", seconds: 0 }
];

let ageFilter = "month";

function rowKey(message: { id: string }): string {
    return `multiplayer:mc:msg:${message.id}`;
}

type MessageCenterOptions = {
    friend: MultiplayerFriend;
    avatars: Record<string, string>;
    selfPic: string;
    land?: string;
};

function MessageCenterModal(props: MessageCenterOptions & { language: LanguageCode; close: () => void }) {
    const { language, close } = props;
    const ulid = props.friend.ulid;
    const [friend, setFriend] = useState(props.friend);
    const known = useRef(props.avatars);
    const [avatars, setAvatars] = useState(props.avatars);
    const [messages, setMessages] = useState<MultiplayerMessage[] | null>(null);
    const [readBefore, setReadBefore] = useState<number | null>(null);
    const [age, setAge] = useState(ageFilter);

    useEffect(() => {
        let alive = true;
        let running = false;
        let again = false;
        let readNewest = -1;

        async function loadMessages() {
            try {
                const loaded = await multiplayerFriendMessages(ulid);
                if (!alive) {
                    return;
                }
                setMessages(loaded.messages ?? []);
                setReadBefore((before) => before ?? loaded.readBefore ?? 0);
            }
            catch (e) {
                logError("multiplayerFriendMessages", e);
                if (alive) {
                    setMessages((before) => before ?? []);
                }
            }
        }

        async function loadFriend() {
            try {
                const state = await multiplayerFriends();
                const row = state.friends?.find((entry) => entry.ulid === ulid);
                if (alive && row) {
                    setFriend(row);
                }
                const missing = [row?.pic ?? "", props.selfPic].filter((pic) => pic && !(pic in known.current));
                if (missing.length > 0) {
                    const fetched = (await multiplayerFriendAvatars(missing)).avatars ?? {};
                    known.current = { ...known.current, ...Object.fromEntries(missing.map((pic) => [pic, fetched[pic] ?? ""])) };
                    if (alive) {
                        setAvatars(known.current);
                    }
                }
                return row;
            }
            catch (e) {
                logError("multiplayerFriends", e);
                return undefined;
            }
        }

        async function load() {
            if (running) {
                again = true;
                return;
            }
            running = true;
            try {
                let pass = readNewest >= 0;
                if (!pass) {
                    await loadMessages();
                    readNewest = (await loadFriend())?.newest ?? 0;
                }
                while ((pass || again) && alive) {
                    pass = false;
                    again = false;
                    const row = await loadFriend();
                    if (alive && row && (row.newest !== readNewest || row.unread > 0)) {
                        readNewest = row.newest;
                        await loadMessages();
                    }
                }
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
    }, [ulid]);

    const limit = AGES.find((entry) => entry.key === age)?.seconds ?? 0;
    const shown = useMemo(() => {
        const since = limit > 0 ? Date.now() / 1000 - limit : 0;
        return (messages ?? []).filter((message) => message.at >= since).reverse();
    }, [messages, limit]);

    const list = useSlidingWindow({
        items: shown,
        itemKey: (message) => message.id,
        focusKeyFor: rowKey,
        windowId: "multiplayer:messagecenter",
        heightScope: ["multiplayer:messagecenter", ulid, getCurrentModalScale(), language].join("|"),
        dynamicLoading: true,
        initialRows: 20,
        rowStep: 20,
        fullSteps: true,
        prefetchDistance: 0,
        sentinelRootMarginPx: 600,
        resetKey: `multiplayer:messagecenter|${ulid}|${age}|${messages === null ? "loading" : "loaded"}`
    });

    const root = useRef<HTMLDivElement>(null);
    const landing = useRef(props.land ?? null);
    const opened = useRef(0);
    useEffect(() => {
        const id = landing.current;
        if (id === null || messages === null) {
            return;
        }
        if (!shown.some((message) => message.id === id)) {
            landing.current = null;
            return;
        }
        const key = rowKey({ id });
        const row = root.current?.querySelector(`[data-focus-key="${key}"]`);
        const target = row?.querySelector("button, [tabindex]") as HTMLElement | null | undefined;
        if (target || opened.current >= LAND_TRIES) {
            landing.current = null;
            target?.focus();
        }
        else {
            opened.current += 1;
            list.openAt(key);
        }
    });

    const name = friendName(friend);
    const say = () => openMessageSay(language, ulid, name);
    const rowAvatar = modalSize(44);

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <Focusable
                flow-children="column"
                onSecondaryButton={say}
                onSecondaryActionDescription={t(language, "Say Something")}
            >
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "8px" }}>
                    {t(language, "Message Center")}
                </div>
                <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "12px" }}>
                    <PicAvatar uri={avatars[friend.pic]} name={friend.name} size={modalSize(56)} />
                    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                        <div style={{ fontSize: `${modalSize(18)}px`, fontWeight: 800, overflowWrap: "anywhere" }}>{name}</div>
                        <div style={{ ...modalBodyStyle(), color: friend.online ? achievementGreen : undefined, opacity: 1 }}>
                            {friendStatus(language, friend)}
                        </div>
                        {friendGame(language, friend) && <div style={{ ...modalBodyStyle(), overflowWrap: "anywhere" }}>{friendGame(language, friend)}</div>}
                    </div>
                </div>
                <div data-focus-key={SAY_KEY} style={{ display: "flex" }}>
                    <DialogButton onClick={say} style={{ width: "100%" }}>{t(language, "Say Something")}</DialogButton>
                </div>
                <Focusable flow-children="row" style={{ width: "100%", display: "flex", gap: "6px", margin: "10px 0 6px 0" }}>
                    {AGES.map((entry) => (
                        <SubTabButton
                            key={entry.key}
                            label={t(language, entry.labelKey)}
                            active={age === entry.key}
                            onClick={() => {
                                ageFilter = entry.key;
                                setAge(entry.key);
                            }}
                            focusKey={`multiplayer:mc:age:${entry.key}`}
                            focusFallback={[SAY_KEY]}
                        />
                    ))}
                </Focusable>
                {messages !== null && shown.length === 0 && (
                    <div style={{ ...modalBodyStyle(), fontStyle: "italic", margin: "6px 0" }}>
                        {t(language, messages.length === 0 ? "No messages yet" : "No messages in this time")}
                    </div>
                )}
                <div ref={root}>
                    <Focusable flow-children="column" resetNavOnEntry navEntryPreferPosition={NAV_ENTER_MAINTAIN_Y}>
                        <SlidingWindowRows list={list}>
                            {list.mountedItems.map((message, index) => {
                                const at = list.start + index;
                                const neighbors = [shown[at + 1], shown[at - 1]]
                                    .filter((other): other is MultiplayerMessage => other !== undefined)
                                    .map(rowKey);
                                const fresh = !message.mine && readBefore !== null && message.at > readBefore;
                                return (
                                    <div key={message.id} style={{ paddingBottom: "4px" }}>
                                        <FocusableItem
                                            focusKey={rowKey(message)}
                                            focusFallback={[...neighbors, `multiplayer:mc:age:${age}`, SAY_KEY]}
                                            onGamepadFocus={() => list.onItemFocus(at)}
                                            onGamepadDirection={list.guardTopRow(at)}
                                        >
                                            <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", width: "100%", textAlign: "left", ...modalBodyStyle(), opacity: 1 }}>
                                                <PicAvatar
                                                    uri={message.mine ? avatars[props.selfPic] : avatars[friend.pic]}
                                                    name={message.mine ? "?" : friend.name}
                                                    size={rowAvatar}
                                                />
                                                <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: 1 }}>
                                                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: "8px", minWidth: 0 }}>
                                                        <span style={{ fontWeight: 800, color: message.mine ? undefined : achievementGreen, overflowWrap: "anywhere" }}>
                                                            {message.mine ? t(language, "You") : name}
                                                        </span>
                                                        <span style={{ ...modalBodyStyle(), fontWeight: 400 }}>
                                                            {formatRelativeTime(new Date(message.at * 1000).toISOString(), language)}
                                                        </span>
                                                        {fresh && <Pill>{t(language, "NEW")}</Pill>}
                                                    </div>
                                                    <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{message.text}</div>
                                                </div>
                                            </div>
                                        </FocusableItem>
                                    </div>
                                );
                            })}
                        </SlidingWindowRows>
                    </Focusable>
                </div>
                <Focusable style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }} flow-children="row">
                    <div data-focus-key={CLOSE_KEY}>
                        <DialogButton onClick={close} style={compactButtonStyle}>{t(language, "Close")}</DialogButton>
                    </div>
                </Focusable>
            </Focusable>
        </ModalRoot>
    );
}

export function openMessageCenter(language: LanguageCode, options: MessageCenterOptions) {
    showManagedModal((close) => <MessageCenterModal language={language} {...options} close={close} />);
}
