import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useEffect, useRef, useState } from "react";

import { multiplayerFriendInvite, multiplayerFriends } from "../../api";
import { useSlidingWindow } from "../../hooks/useSlidingWindow";
import { t, type LanguageCode } from "../../locales";
import type { MultiplayerFriend } from "../../types";
import { logError } from "../../utils/errors";
import { showManagedModal } from "../../utils/modalRegistry";
import { getCurrentModalScale, modalSize } from "../../utils/scale";
import { achievementGreen, compactButtonStyle, errorRed, modalBodyStyle } from "../../utils/style";
import { FocusableItem } from "../ui/FocusableItem";
import { InlineSpinner } from "../ui/InlineSpinner";
import { SlidingWindowRows } from "../ui/SlidingWindowRows";
import { friendError } from "./AddFriendModal";
import { DialogLine, type DialogLineState } from "./DialogLine";
import { PicAvatar, friendGame, friendName, friendStatus } from "./PicAvatar";

function rowKey(friend: MultiplayerFriend): string {
    return `multiplayer:invite:${friend.ulid}`;
}

function InviteFriendsModal(props: { language: LanguageCode; avatars: Record<string, string>; close: () => void }) {
    const { language, close } = props;
    const [friends, setFriends] = useState<MultiplayerFriend[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [marks, setMarks] = useState<Record<string, "sent" | "failed">>({});
    const [linkUp, setLinkUp] = useState(false);
    const rowsRef = useRef<HTMLDivElement | null>(null);
    const landed = useRef(false);
    const [line, setLine] = useState<DialogLineState>(
        () => ({ tone: "hint", text: t(language, "Pick a friend to invite to your room.") })
    );

    useEffect(() => {
        void (async () => {
            try {
                const state = await multiplayerFriends();
                setFriends(state.friends ?? []);
                setLinkUp(Boolean(state.up));
            }
            catch (e) {
                logError("multiplayerFriends", e);
                setFriends([]);
            }
        })();
    }, []);

    useEffect(() => {
        if (landed.current || !friends || friends.length === 0) {
            return;
        }
        landed.current = true;
        const row = rowsRef.current?.querySelector(`[data-focus-key="${rowKey(friends[0])}"]`);
        (row?.querySelector("button, [tabindex]") as HTMLElement | null | undefined)?.focus();
    }, [friends]);

    const list = useSlidingWindow({
        items: friends ?? [],
        itemKey: (friend) => friend.ulid,
        focusKeyFor: rowKey,
        windowId: "multiplayer:invitepicker",
        heightScope: ["multiplayer:invitepicker", getCurrentModalScale(), language].join("|"),
        dynamicLoading: true,
        initialRows: 20,
        rowStep: 20,
        fullSteps: true,
        prefetchDistance: 0,
        sentinelRootMarginPx: 600,
        resetKey: "multiplayer:invitepicker"
    });

    async function invite(friend: MultiplayerFriend) {
        if (busy) {
            return;
        }
        setBusy(true);
        setLine({ tone: "busy", text: t(language, "Inviting {{name}}...", { name: friendName(friend) }) });
        try {
            const sent = await multiplayerFriendInvite(friend.ulid);
            setMarks((current) => ({ ...current, [friend.ulid]: sent.ok ? "sent" : "failed" }));
            setLine(sent.ok
                ? { tone: "ok", text: t(language, "Invite sent to {{name}}", { name: friendName(friend) }) }
                : { tone: "error", text: friendError(language, sent.error, friendName(friend)) });
        }
        catch (e) {
            logError("multiplayerFriendInvite", e);
            setMarks((current) => ({ ...current, [friend.ulid]: "failed" }));
            setLine({ tone: "error", text: friendError(language, "unavailable") });
        }
        setBusy(false);
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700 }}>
                {t(language, "Invite Friends")}
            </div>
            <DialogLine {...line} />
            {friends === null && <InlineSpinner label={t(language, "Loading...")} />}
            {friends !== null && friends.length === 0 && (
                <div style={modalBodyStyle()}>{t(language, "No friends to invite yet.")}</div>
            )}
            {friends !== null && friends.length > 0 && (
                <div ref={rowsRef}>
                    <SlidingWindowRows list={list}>
                        {list.mountedItems.map((friend, index) => {
                            const at = list.start + index;
                            const neighbors = [friends[at + 1], friends[at - 1]]
                                .filter((other): other is MultiplayerFriend => other !== undefined)
                                .map(rowKey);
                            return (
                                <div key={friend.ulid} style={{ paddingBottom: "4px" }}>
                                    <FocusableItem
                                        focusKey={rowKey(friend)}
                                        focusFallback={[...neighbors, "multiplayer:invitepicker:close"]}
                                        disabled={linkUp && !friend.online && friend.seen > 0}
                                        onGamepadFocus={() => list.onItemFocus(at)}
                                        onGamepadDirection={list.guardTopRow(at)}
                                        onClick={() => void invite(friend)}
                                    >
                                        <div style={{ display: "flex", gap: "10px", alignItems: "center", width: "100%", textAlign: "left", ...modalBodyStyle(), opacity: 1 }}>
                                            <PicAvatar uri={props.avatars[friend.pic]} name={friend.name} size={modalSize(32)} />
                                            <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                                                <span style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{friendName(friend)}</span>
                                                <span style={{ color: friend.online ? achievementGreen : undefined }}>{friendStatus(language, friend)}</span>
                                                {friendGame(language, friend) && <span style={{ overflowWrap: "anywhere" }}>{friendGame(language, friend)}</span>}
                                            </div>
                                            {marks[friend.ulid] === "sent" && (
                                                <span style={{ color: achievementGreen, fontWeight: 800 }}>✔</span>
                                            )}
                                            {marks[friend.ulid] === "failed" && (
                                                <span style={{ color: errorRed, fontWeight: 800 }}>✖</span>
                                            )}
                                        </div>
                                    </FocusableItem>
                                </div>
                            );
                        })}
                    </SlidingWindowRows>
                </div>
            )}
            <Focusable style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }} flow-children="row">
                <div data-focus-key="multiplayer:invitepicker:close">
                    <DialogButton onClick={close} style={compactButtonStyle}>{t(language, "Close")}</DialogButton>
                </div>
            </Focusable>
        </ModalRoot>
    );
}

export function openInviteFriends(language: LanguageCode, avatars: Record<string, string>) {
    showManagedModal((close) => <InviteFriendsModal language={language} avatars={avatars} close={close} />);
}
