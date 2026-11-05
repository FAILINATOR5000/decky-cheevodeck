import { DialogButton, Focusable, ModalRoot, SliderField } from "@decky/ui";
import { useState } from "react";

import { multiplayerDropSeat, multiplayerFriendAddSeat } from "../../api";
import { t, type LanguageCode } from "../../locales";
import { logError } from "../../utils/errors";
import { showManagedModal } from "../../utils/modalRegistry";
import { requestRoute } from "../../utils/pendingPanelEntry";
import { modalSize } from "../../utils/scale";
import { modalBodyStyle, warnAmber } from "../../utils/style";
import { retryPeer, setPeerMuted, setPeerVolume, useVoiceChat } from "../../utils/voiceChat";
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
    voice: boolean;
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

    function viewProfile() {
        requestRoute({ kind: "profile", username: props.name, ulid: props.ulid, backSource: "multiplayer" });
        close();
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
    const voice = useVoiceChat();
    const heard = props.voice && voice.on ? voice.seats[props.index] : undefined;
    const inVoice = Boolean(heard?.inVoice);
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
            {inVoice && heard?.failed && (
                <div style={{ ...modalBodyStyle(), color: warnAmber, opacity: 1, marginTop: "8px" }}>
                    {t(language, "Voice couldn't connect to {{name}}.", { name: props.name })}
                </div>
            )}
            <Focusable style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "16px" }} flow-children="column">
                {canAsk && (
                    <div data-focus-key="multiplayer:seatcard:add">
                        <DialogButton onClick={() => void addFriend()} disabled={busy}>{t(language, "Add Friend")}</DialogButton>
                    </div>
                )}
                {props.ulid && (
                    <div data-focus-key="multiplayer:seatcard:profile">
                        <DialogButton onClick={viewProfile} disabled={busy}>{t(language, "View Profile")}</DialogButton>
                    </div>
                )}
                {props.openMessages && (
                    <div data-focus-key="multiplayer:seatcard:message">
                        <DialogButton onClick={messages} disabled={busy}>{t(language, "Message Center")}</DialogButton>
                    </div>
                )}
                {inVoice && heard?.failed && (
                    <div data-focus-key="multiplayer:seatcard:retry">
                        <DialogButton onClick={() => retryPeer(props.index)} disabled={busy}>{t(language, "Try Again")}</DialogButton>
                    </div>
                )}
                {inVoice && (
                    <div data-focus-key="multiplayer:seatcard:mute">
                        <DialogButton onClick={() => setPeerMuted(props.index, !heard?.mutedByMe)} disabled={busy}>
                            {t(language, heard?.mutedByMe ? "Unmute" : "Mute")}
                        </DialogButton>
                    </div>
                )}
                {inVoice && (
                    <div data-focus-key="multiplayer:seatcard:volume">
                        <SliderField
                            label={t(language, "Volume")}
                            value={heard?.volume ?? 100}
                            min={0}
                            max={200}
                            step={25}
                            showValue
                            valueSuffix="%"
                            layout="below"
                            bottomSeparator="none"
                            disabled={busy}
                            onChange={(value) => setPeerVolume(props.index, value)}
                        />
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
