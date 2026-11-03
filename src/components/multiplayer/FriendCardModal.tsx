import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import { useEffect, useRef, useState } from "react";

import {
    multiplayerFriendInvite,
    multiplayerFriendJoin,
    multiplayerFriendRemove,
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
import { NewPill, PicAvatar, friendGame, friendName, friendStatus } from "./PicAvatar";

const PASSWORD_MAX = 32;

type Step = "menu" | "remove" | "password";

export type FriendCardOptions = {
    friend: MultiplayerFriend;
    avatar: string | undefined;
    inRoom: boolean;
    linkUp: boolean;
    hardcore: boolean;
    heirs: string[];
    openMessages: () => void;
};

function FriendCardModal(props: FriendCardOptions & { language: LanguageCode; close: () => void }) {
    const { language, friend, close } = props;
    const [step, setStep] = useState<Step>("menu");
    const [busy, setBusy] = useState(false);
    const [line, setLine] = useState<DialogLineState>({ tone: "hint", text: "" });
    const [password, setPassword] = useState("");
    const [entryId] = useState(() => topEntryId());
    const fieldRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        fieldRef.current?.querySelector("input")?.focus();
    }, [step]);

    function messages() {
        close();
        props.openMessages();
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
    const gameLine = [
        friendGame(language, friend),
        friend.online && friend.room ? t(language, "Room “{{room}}”", { room: friend.room.name }) : ""
    ].filter(Boolean).join(" · ");
    const header = (
        <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "8px" }}>
            <PicAvatar uri={props.avatar} name={friend.name} size={modalSize(56)} />
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, overflowWrap: "anywhere" }}>
                    {friendName(friend)}
                </div>
                <div style={{ ...modalBodyStyle(), color: friend.online ? achievementGreen : undefined, opacity: 1 }}>
                    {friendStatus(language, friend)}
                </div>
                {gameLine && <div style={{ ...modalBodyStyle(), overflowWrap: "anywhere" }}>{gameLine}</div>}
                {friend.raFriend && <div style={modalBodyStyle()}>{t(language, "RA friend")}</div>}
            </div>
        </div>
    );
    const dialogLine = <DialogLine {...line} />;

    if (step === "password") {
        return (
            <ModalRoot onCancel={back} onEscKeypress={back}>
                <SnapshotHotkey language={language} />
                <SaveOnStart canSave={!busy} label={t(language, "Join")} onSave={() => void join()}>
                    {header}
                    <div ref={fieldRef} data-focus-key="multiplayer:friendcard:password">
                        <TextField
                            label={t(language, "Password")}
                            value={password}
                            type="password"
                            bIsPassword
                            disabled={busy}
                            onChange={(e: any) => {
                                setPassword(String(e?.target?.value ?? "").slice(0, PASSWORD_MAX));
                                setLine({ tone: "hint", text: "" });
                            }}
                        />
                    </div>
                    {dialogLine}
                    <Focusable style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }} flow-children="row">
                        <div data-focus-key="multiplayer:friendcard:save">
                            <DialogButton onClick={() => void join()} disabled={busy || !password}>
                                {t(language, "Join")}
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
    const offlineInvite = props.inRoom && props.linkUp && !friend.online && friend.seen > 0;
    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            {header}
            <Focusable style={buttonColumn} flow-children="column">
                <div data-focus-key="multiplayer:friendcard:message">
                    <DialogButton onClick={messages} disabled={busy}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                            {t(language, "Message Center")}
                            {friend.unread > 0 && <NewPill language={language} count={friend.unread} />}
                        </span>
                    </DialogButton>
                </div>
                {props.inRoom && (
                    <div data-focus-key="multiplayer:friendcard:invite">
                        <DialogButton onClick={() => void invite()} disabled={busy || offlineInvite}>{t(language, "Invite to My Room")}</DialogButton>
                    </div>
                )}
                {canJoin && (
                    <div data-focus-key="multiplayer:friendcard:join">
                        <DialogButton onClick={() => void join()} disabled={busy}>{t(language, "Join Their Room")}</DialogButton>
                    </div>
                )}
                <div data-focus-key="multiplayer:friendcard:remove">
                    <DialogButton onClick={() => setStep("remove")} disabled={busy}>{t(language, "Remove")}</DialogButton>
                </div>
                <div data-focus-key="multiplayer:friendcard:close">
                    <DialogButton onClick={close}>{t(language, "Close")}</DialogButton>
                </div>
            </Focusable>
            {offlineInvite && !line.text
                ? <DialogLine tone="hint" text={t(language, "{{name}} is offline. Invites reach online friends only.", { name: friendName(friend) })} />
                : dialogLine}
        </ModalRoot>
    );
}

export function openFriendCard(language: LanguageCode, options: FriendCardOptions) {
    showManagedModal((close) => <FriendCardModal language={language} {...options} close={close} />);
}
