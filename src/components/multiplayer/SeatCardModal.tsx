import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useState } from "react";

import { multiplayerDropSeat, multiplayerFriendAddSeat } from "../../api";
import { t, type LanguageCode } from "../../locales";
import { logError } from "../../utils/errors";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { modalBodyStyle } from "../../utils/style";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { friendError } from "./AddFriendModal";
import { DialogLine, type DialogLineState } from "./DialogLine";
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
    openMessages: (() => void) | null;
};

function SeatCardModal(props: SeatCardOptions & { language: LanguageCode; close: () => void }) {
    const { language, close } = props;
    const [busy, setBusy] = useState(false);
    const [line, setLine] = useState<DialogLineState>({ tone: "hint", text: "" });

    async function addFriend() {
        setBusy(true);
        setLine({ tone: "busy", text: t(language, "Sending...") });
        try {
            const asked = await multiplayerFriendAddSeat(props.index, props.ulid);
            if (!asked.ok) {
                setLine({ tone: "error", text: friendError(language, asked.error, props.name) });
                setBusy(false);
                return;
            }
        }
        catch (e) {
            logError("multiplayerFriendAddSeat", e);
            setLine({ tone: "error", text: friendError(language, "unavailable") });
            setBusy(false);
            return;
        }
        close();
    }

    function messages() {
        close();
        props.openMessages?.();
    }

    async function drop() {
        setBusy(true);
        setLine({ tone: "busy", text: t(language, "Working...") });
        try {
            const dropped = await multiplayerDropSeat(props.index, props.name);
            if (!dropped.ok) {
                setLine({ tone: "error", text: friendError(language, dropped.error, props.name) });
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
            <DialogLine {...line} />
            <Focusable style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "16px" }} flow-children="column">
                {canAsk && (
                    <div data-focus-key="multiplayer:seatcard:add">
                        <DialogButton onClick={() => void addFriend()} disabled={busy}>{t(language, "Add Friend")}</DialogButton>
                    </div>
                )}
                {props.openMessages && (
                    <div data-focus-key="multiplayer:seatcard:message">
                        <DialogButton onClick={messages} disabled={busy}>{t(language, "Message Center")}</DialogButton>
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
