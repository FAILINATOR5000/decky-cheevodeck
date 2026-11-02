import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useEffect, useState } from "react";

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
import { PicAvatar, friendGame, friendName, friendStatus } from "./PicAvatar";

function rowKey(friend: MultiplayerFriend): string {
    return `multiplayer:invite:${friend.ulid}`;
}

function InviteFriendsModal(props: { language: LanguageCode; avatars: Record<string, string>; close: () => void }) {
    const { language, close } = props;
    const [friends, setFriends] = useState<MultiplayerFriend[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

    useEffect(() => {
        void (async () => {
            try {
                setFriends((await multiplayerFriends(false)).friends ?? []);
            }
            catch (e) {
                logError("multiplayerFriends", e);
                setFriends([]);
            }
        })();
    }, []);

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
        setBusy(true);
        setResult(null);
        try {
            const sent = await multiplayerFriendInvite(friend.ulid);
            setResult(sent.ok
                ? { ok: true, text: t(language, "Invite sent to {{name}}", { name: friendName(friend) }) }
                : { ok: false, text: friendError(language, sent.error, friendName(friend)) });
        }
        catch (e) {
            logError("multiplayerFriendInvite", e);
            setResult({ ok: false, text: friendError(language, "unavailable") });
        }
        setBusy(false);
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "8px" }}>
                {t(language, "Invite Friends")}
            </div>
            {result && (
                <div style={{ ...modalBodyStyle(), color: result.ok ? achievementGreen : errorRed, opacity: 1, marginBottom: "8px" }}>
                    {result.text}
                </div>
            )}
            {friends === null && <InlineSpinner label={t(language, "Loading...")} />}
            {friends !== null && friends.length === 0 && (
                <div style={modalBodyStyle()}>{t(language, "No friends to invite yet.")}</div>
            )}
            {friends !== null && friends.length > 0 && (
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
                                    disabled={busy}
                                    onGamepadFocus={() => list.onItemFocus(at)}
                                    onGamepadDirection={list.guardTopRow(at)}
                                    onClick={() => void invite(friend)}
                                >
                                    <div style={{ display: "flex", gap: "10px", alignItems: "center", width: "100%", textAlign: "left", ...modalBodyStyle(), opacity: 1 }}>
                                        <PicAvatar uri={props.avatars[friend.pic]} name={friend.name} size={modalSize(32)} />
                                        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                                            <span style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{friendName(friend)}</span>
                                            <span style={{ color: friend.online ? achievementGreen : undefined }}>{friendStatus(language, friend)}</span>
                                            {friendGame(friend) && <span style={{ overflowWrap: "anywhere" }}>{friendGame(friend)}</span>}
                                        </div>
                                    </div>
                                </FocusableItem>
                            </div>
                        );
                    })}
                </SlidingWindowRows>
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
