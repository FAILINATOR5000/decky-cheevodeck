import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useState } from "react";

import { multiplayerDropSeat, multiplayerFriendAddSeat } from "../../api";
import { overrideRecord, topEntryId } from "../../focusRecords";
import { t, type LanguageCode } from "../../locales";
import { logError } from "../../utils/errors";
import { rememberMultiplayerPage } from "../../utils/multiplayerChoices";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { errorRed, modalBodyStyle } from "../../utils/style";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { friendError } from "./AddFriendModal";
import { PicAvatar } from "./PicAvatar";

export type SeatCardOptions = {
    index: number;
    name: string;
    game: string;
    ulid: string;
    avatar: string | undefined;
    relation: "friend" | "pending" | "none";
    canDrop: boolean;
    friendsOn: boolean;
};

function SeatCardModal(props: SeatCardOptions & { language: LanguageCode; close: () => void }) {
    const { language, close } = props;
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState("");
    const [entryId] = useState(() => topEntryId());

    async function addFriend() {
        setBusy(true);
        setFailure("");
        try {
            const asked = await multiplayerFriendAddSeat(props.index, props.ulid);
            if (!asked.ok) {
                setFailure(asked.error ?? "unavailable");
                setBusy(false);
                return;
            }
        }
        catch (e) {
            logError("multiplayerFriendAddSeat", e);
            setFailure("unavailable");
            setBusy(false);
            return;
        }
        close();
    }

    function message() {
        rememberMultiplayerPage("friends", props.ulid);
        overrideRecord(entryId, {
            focusKey: "multiplayer:conv:say",
            fallbacks: [`multiplayer:friend:${props.ulid}`, "multiplayer:friends:add"],
            tabPath: ["friends"]
        });
        close();
    }

    async function drop() {
        setBusy(true);
        try {
            const dropped = await multiplayerDropSeat(props.index, props.name);
            if (!dropped.ok) {
                setFailure(dropped.error ?? "unavailable");
                setBusy(false);
                return;
            }
        }
        catch (e) {
            logError("multiplayerDropSeat", e);
        }
        close();
    }

    const canAsk = props.friendsOn && Boolean(props.ulid) && props.relation === "none";
    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "8px" }}>
                <PicAvatar uri={props.avatar} name={props.name} size={modalSize(56)} />
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, overflowWrap: "anywhere" }}>{props.name}</div>
                    {props.game && <div style={modalBodyStyle()}>{props.game}</div>}
                    {props.relation === "pending" && (
                        <div style={modalBodyStyle()}>{t(language, "Friend request waiting")}</div>
                    )}
                </div>
            </div>
            {failure && (
                <div style={{ ...modalBodyStyle(), color: errorRed, opacity: 1, marginTop: "8px" }}>
                    {friendError(language, failure)}
                </div>
            )}
            <Focusable style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "16px" }} flow-children="column">
                {canAsk && (
                    <div data-focus-key="multiplayer:seatcard:add">
                        <DialogButton onClick={() => void addFriend()} disabled={busy}>{t(language, "Add Friend")}</DialogButton>
                    </div>
                )}
                {props.relation === "friend" && (
                    <div data-focus-key="multiplayer:seatcard:message">
                        <DialogButton onClick={message} disabled={busy}>{t(language, "Message")}</DialogButton>
                    </div>
                )}
                {props.canDrop && (
                    <div data-focus-key="multiplayer:seatcard:drop">
                        <DialogButton onClick={() => void drop()} disabled={busy}>{t(language, "Drop")}</DialogButton>
                    </div>
                )}
                <div data-focus-key="multiplayer:seatcard:close">
                    <DialogButton onClick={close}>{t(language, "Close")}</DialogButton>
                </div>
            </Focusable>
        </ModalRoot>
    );
}

export function openSeatCard(language: LanguageCode, options: SeatCardOptions) {
    showManagedModal((close) => <SeatCardModal language={language} {...options} close={close} />);
}
