import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import { useEffect, useRef, useState } from "react";

import {
    multiplayerFriendInvite,
    multiplayerFriendJoin,
    multiplayerFriendRemove,
    multiplayerFriendRename,
    multiplayerSetVisible
} from "../../api";
import { overrideRecord, topEntryId } from "../../focusRecords";
import { t, type LanguageCode } from "../../locales";
import type { MultiplayerFriend } from "../../types";
import { logError } from "../../utils/errors";
import { rememberMultiplayerPage } from "../../utils/multiplayerChoices";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { achievementGreen, modalBodyStyle } from "../../utils/style";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { friendError } from "./AddFriendModal";
import { DialogLine, type DialogLineState } from "./DialogLine";
import { PicAvatar, friendGame, friendName, friendStatus } from "./PicAvatar";

const NICKNAME_MAX = 24;
const PASSWORD_MAX = 32;

type Step = "menu" | "rename" | "remove" | "password";

export type FriendCardOptions = {
    friend: MultiplayerFriend;
    avatar: string | undefined;
    inRoom: boolean;
    hardcore: boolean;
    heirs: string[];
};

function FriendCardModal(props: FriendCardOptions & { language: LanguageCode; close: () => void }) {
    const { language, friend, close } = props;
    const [step, setStep] = useState<Step>("menu");
    const [busy, setBusy] = useState(false);
    const [line, setLine] = useState<DialogLineState>({ tone: "hint", text: "" });
    const [nickname, setNickname] = useState(friend.nickname || friend.name);
    const [password, setPassword] = useState("");
    const [entryId] = useState(() => topEntryId());
    const fieldRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const input = fieldRef.current?.querySelector("input");
        input?.focus();
        if (step === "rename") {
            input?.select();
        }
    }, [step]);

    function message() {
        rememberMultiplayerPage("friends", friend.ulid);
        overrideRecord(entryId, {
            focusKey: "multiplayer:conv:say",
            fallbacks: [`multiplayer:friend:${friend.ulid}`, "multiplayer:friends:add"],
            tabPath: ["friends"]
        });
        close();
    }

    function failed(code: string | undefined) {
        setLine({ tone: "error", text: friendError(language, code, friendName(friend)) });
    }

    async function join() {
        setBusy(true);
        setLine({ tone: "busy", text: t(language, "Joining...") });
        let joinedRunningGame = false;
        try {
            await multiplayerSetVisible(true, true);
            const joined = await multiplayerFriendJoin(friend.ulid, password, props.hardcore);
            if (!joined.ok) {
                setBusy(false);
                if (joined.error === "needs_code" || joined.error === "bad_code") {
                    setStep("password");
                    if (joined.error === "bad_code") {
                        failed("bad_code");
                    }
                    else {
                        setLine({ tone: "hint", text: "" });
                    }
                    return;
                }
                failed(joined.error);
                return;
            }
            const room = joined.room;
            joinedRunningGame = room?.mode === "couch" && room.emulator === "retroarch" && room.state === "playing";
        }
        catch (e) {
            logError("multiplayerFriendJoin", e);
            setBusy(false);
            failed("unavailable");
            return;
        }
        rememberMultiplayerPage("play");
        overrideRecord(entryId, joinedRunningGame
            ? { focusKey: "multiplayer:play", fallbacks: ["multiplayer:leave"], tabPath: ["play"] }
            : { focusKey: "multiplayer:leave", tabPath: ["play"] });
        close();
    }

    async function invite() {
        setBusy(true);
        setLine({ tone: "busy", text: t(language, "Inviting {{name}}...", { name: friendName(friend) }) });
        try {
            const sent = await multiplayerFriendInvite(friend.ulid);
            if (sent.ok) {
                setLine({ tone: "ok", text: t(language, "Invite sent to {{name}}", { name: friendName(friend) }) });
            }
            else {
                failed(sent.error);
            }
        }
        catch (e) {
            logError("multiplayerFriendInvite", e);
            failed("unavailable");
        }
        setBusy(false);
    }

    async function rename() {
        setBusy(true);
        try {
            const kept = nickname.trim() === friend.name ? "" : nickname;
            await multiplayerFriendRename(friend.ulid, kept);
        }
        catch (e) {
            logError("multiplayerFriendRename", e);
        }
        close();
    }

    async function remove() {
        setBusy(true);
        try {
            const removed = await multiplayerFriendRemove(friend.ulid);
            if (removed.ok && props.heirs.length > 0) {
                overrideRecord(entryId, { focusKey: props.heirs[0], fallbacks: props.heirs.slice(1) });
            }
        }
        catch (e) {
            logError("multiplayerFriendRemove", e);
        }
        close();
    }

    function back() {
        if (step === "menu") {
            close();
            return;
        }
        setStep("menu");
        setLine({ tone: "hint", text: "" });
        setBusy(false);
    }

    const buttonColumn = { display: "flex", flexDirection: "column" as const, gap: "8px", marginTop: "16px" };
    const header = (
        <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "8px" }}>
            <PicAvatar uri={props.avatar} name={friend.name} size={modalSize(56)} />
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, overflowWrap: "anywhere" }}>
                    {friendName(friend)}
                </div>
                {friend.nickname && <div style={modalBodyStyle()}>{friend.name}</div>}
                <div style={{ ...modalBodyStyle(), color: friend.online ? achievementGreen : undefined, opacity: 1 }}>
                    {friendStatus(language, friend)}
                </div>
                {friendGame(friend) && <div style={{ ...modalBodyStyle(), overflowWrap: "anywhere" }}>{friendGame(friend)}</div>}
            </div>
        </div>
    );
    const dialogLine = <DialogLine {...line} />;

    if (step === "rename" || step === "password") {
        const renaming = step === "rename";
        return (
            <ModalRoot onCancel={back} onEscKeypress={back}>
                <SnapshotHotkey language={language} />
                <SaveOnStart
                    canSave={!busy}
                    label={t(language, renaming ? "Save" : "Join")}
                    onSave={() => void (renaming ? rename() : join())}
                >
                    {header}
                    <div ref={fieldRef} data-focus-key={renaming ? "multiplayer:friendcard:nickname" : "multiplayer:friendcard:password"}>
                        <TextField
                            label={t(language, renaming ? "Nickname" : "Password")}
                            value={renaming ? nickname : password}
                            type={renaming ? undefined : "password"}
                            bIsPassword={!renaming}
                            disabled={busy}
                            onChange={(e: any) => {
                                const value = String(e?.target?.value ?? "");
                                if (renaming) {
                                    setNickname(value.slice(0, NICKNAME_MAX));
                                }
                                else {
                                    setPassword(value.slice(0, PASSWORD_MAX));
                                    setLine({ tone: "hint", text: "" });
                                }
                            }}
                        />
                    </div>
                    {dialogLine}
                    <Focusable style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }} flow-children="row">
                        <div data-focus-key="multiplayer:friendcard:save">
                            <DialogButton onClick={() => void (renaming ? rename() : join())} disabled={busy || (!renaming && !password)}>
                                {t(language, renaming ? "Save" : "Join")}
                            </DialogButton>
                        </div>
                        <div data-focus-key="multiplayer:friendcard:back">
                            <DialogButton onClick={back}>{t(language, "Cancel")}</DialogButton>
                        </div>
                    </Focusable>
                </SaveOnStart>
            </ModalRoot>
        );
    }

    if (step === "remove") {
        return (
            <ModalRoot onCancel={back} onEscKeypress={back}>
                <SnapshotHotkey language={language} />
                {header}
                <div style={modalBodyStyle()}>
                    {t(language, "Remove {{name}} from your friends? You leave their list too.", { name: friendName(friend) })}
                </div>
                <Focusable style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }} flow-children="row">
                    <div data-focus-key="multiplayer:friendcard:confirm">
                        <DialogButton onClick={() => void remove()} disabled={busy}>{t(language, "Remove")}</DialogButton>
                    </div>
                    <div data-focus-key="multiplayer:friendcard:back">
                        <DialogButton onClick={back}>{t(language, "Cancel")}</DialogButton>
                    </div>
                </Focusable>
            </ModalRoot>
        );
    }

    const canJoin = Boolean(friend.online && friend.room) && !props.inRoom;
    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            {header}
            {dialogLine}
            <Focusable style={buttonColumn} flow-children="column">
                <div data-focus-key="multiplayer:friendcard:message">
                    <DialogButton onClick={message} disabled={busy}>{t(language, "Message")}</DialogButton>
                </div>
                {props.inRoom && (
                    <div data-focus-key="multiplayer:friendcard:invite">
                        <DialogButton onClick={() => void invite()} disabled={busy}>{t(language, "Invite to My Room")}</DialogButton>
                    </div>
                )}
                {canJoin && (
                    <div data-focus-key="multiplayer:friendcard:join">
                        <DialogButton onClick={() => void join()} disabled={busy}>{t(language, "Join Their Room")}</DialogButton>
                    </div>
                )}
                <div data-focus-key="multiplayer:friendcard:rename">
                    <DialogButton onClick={() => setStep("rename")} disabled={busy}>{t(language, "Rename")}</DialogButton>
                </div>
                <div data-focus-key="multiplayer:friendcard:remove">
                    <DialogButton onClick={() => setStep("remove")} disabled={busy}>{t(language, "Remove")}</DialogButton>
                </div>
                <div data-focus-key="multiplayer:friendcard:close">
                    <DialogButton onClick={close}>{t(language, "Close")}</DialogButton>
                </div>
            </Focusable>
        </ModalRoot>
    );
}

export function openFriendCard(language: LanguageCode, options: FriendCardOptions) {
    showManagedModal((close) => <FriendCardModal language={language} {...options} close={close} />);
}
