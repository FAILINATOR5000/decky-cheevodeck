import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import { useEffect, useRef, useState } from "react";

import { multiplayerFriendAdd } from "../../api";
import { overrideRecord, topEntryId } from "../../focusRecords";
import { t, type LanguageCode } from "../../locales";
import { logError } from "../../utils/errors";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { modalBodyStyle } from "../../utils/style";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { DialogLine, type DialogLineState } from "./DialogLine";

const NAME_MAX = 32;

const FRIEND_ERRORS: Record<string, string> = {
    no_user: "No RetroAchievements user has that name",
    self: "That's you",
    already: "Already your friend",
    pending: "A request is already waiting",
    limit: "Too many requests. Try again in an hour.",
    offline: "Couldn't reach the lobby server",
    friends_off: "Turn on Friends in Options first",
    ra_unreachable: "Couldn't reach RetroAchievements",
    host_gone: "Lost the host",
    not_friends: "They aren't friends with you on this device",
    mailbox_full: "Their mailbox is full",
    full: "That room is full",
    dropped: "The host dropped you from the room",
    left_room: "They left the room. Add them by name instead.",
    seat_changed: "Someone else is in that seat now",
    not_online: "{{name}} isn't online",
    no_room: "You're not in a room",
    room_gone: "That room is gone",
    invite_expired: "That invite expired",
    bad_code: "Wrong password",
    needs_code: "This room has a password",
    locked_out: "Too many wrong passwords. Try again in a minute.",
    busy: "Leave your room first",
    unavailable: "Something went wrong. Try again."
};

export function friendError(language: LanguageCode, code: string | undefined, name = ""): string {
    return t(language, FRIEND_ERRORS[code ?? ""] ?? FRIEND_ERRORS.unavailable, { name });
}

function AddFriendModal(props: { language: LanguageCode; close: () => void }) {
    const { language, close } = props;
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    const [line, setLine] = useState<DialogLineState>({ tone: "hint", text: "" });
    const [entryId] = useState(() => topEntryId());
    const fieldRef = useRef<HTMLDivElement | null>(null);
    const canAdd = name.trim().length > 0 && !busy;

    useEffect(() => {
        fieldRef.current?.querySelector("input")?.focus();
    }, []);

    async function add() {
        if (!canAdd) {
            return;
        }
        setBusy(true);
        setLine({ tone: "busy", text: t(language, "Looking up {{name}}...", { name: name.trim() }) });
        try {
            const added = await multiplayerFriendAdd(name.trim());
            if (!added.ok) {
                setLine({ tone: "error", text: friendError(language, added.error) });
                setBusy(false);
                return;
            }
            if (added.ulid) {
                overrideRecord(entryId, {
                    focusKey: `multiplayer:${added.friend ? "friend" : "request"}:${added.ulid}`,
                    fallbacks: ["multiplayer:friends:add"],
                    tabPath: ["friends"]
                });
            }
        }
        catch (e) {
            logError("multiplayerFriendAdd", e);
            setLine({ tone: "error", text: friendError(language, "unavailable") });
            setBusy(false);
            return;
        }
        close();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <SaveOnStart canSave={canAdd} label={t(language, "Send Request")} onSave={() => void add()}>
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                    {t(language, "Add Friend")}
                </div>
                <div ref={fieldRef} data-focus-key="multiplayer:addfriend:name">
                    <TextField
                        label={t(language, "RetroAchievements name")}
                        value={name}
                        disabled={busy}
                        onChange={(e: any) => {
                            setName(String(e?.target?.value ?? "").slice(0, NAME_MAX));
                            setLine({ tone: "hint", text: "" });
                        }}
                    />
                </div>
                <div style={{ ...modalBodyStyle(), marginTop: "8px" }}>
                    {t(language, "help_mp_add_friend")}
                </div>
                <Focusable
                    style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}
                    flow-children="row"
                >
                    <DialogLine {...line} beside />
                    <div data-focus-key="multiplayer:addfriend:send">
                        <DialogButton onClick={() => void add()} disabled={!canAdd} focusable={canAdd || busy}>
                            {t(language, "Send Request")}
                        </DialogButton>
                    </div>
                    <div data-focus-key="multiplayer:addfriend:cancel">
                        <DialogButton onClick={close}>
                            {t(language, "Cancel")}
                        </DialogButton>
                    </div>
                </Focusable>
            </SaveOnStart>
        </ModalRoot>
    );
}

export function openAddFriend(language: LanguageCode) {
    showManagedModal((close) => <AddFriendModal language={language} close={close} />);
}
