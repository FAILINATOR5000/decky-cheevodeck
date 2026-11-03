import { DialogButton, Field, Focusable, ModalRoot, SliderField, TextField } from "@decky/ui";
import { useEffect, useRef, useState } from "react";

import { multiplayerHost, multiplayerSetVisible } from "../../api";
import { overrideRecord, topEntryId } from "../../focusRecords";
import { t, type LanguageCode } from "../../locales";
import type { MultiplayerMode, MultiplayerWhere } from "../../types";
import { logError } from "../../utils/errors";
import { multiplayerChoices, rememberMultiplayerHostPicks } from "../../utils/multiplayerChoices";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { achievementGreen, compactButtonStyle, modalBodyStyle, warnAmber } from "../../utils/style";
import { helpDescription } from "../ui/InfoText";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { DialogLine, type DialogLineState } from "./DialogLine";
import { ROOM_STATUSES } from "./roomStatus";

const NAME_MAX = 24;
const PASSWORD_MAX = 32;
const MIN_SEATS = 2;
const MAX_SEATS = 10;

type HostRequest = {
    mode: MultiplayerMode;
    gameId: number;
    hardcore: boolean;
    core: string;
    share: boolean;
    watch: boolean;
};

type HostPlace = {
    online: boolean;
    lanOnly: boolean;
};

const WHERES: { code: MultiplayerWhere; labelKey: string }[] = [
    { code: "local", labelKey: "Local" },
    { code: "online", labelKey: "Online" }
];

type HostRoomModalProps = {
    language: LanguageCode;
    request: HostRequest;
    place: HostPlace;
    describe: (code: string, detail?: Record<string, string>) => string;
    close: () => void;
};

function HostRoomModal(props: HostRoomModalProps) {
    const { language, request, place, describe, close } = props;
    const picks = multiplayerChoices();
    const [where, setWhere] = useState<MultiplayerWhere>(
        () => (place.online && !place.lanOnly ? picks.where : "local")
    );
    const [name, setName] = useState(() => t(language, "Room"));
    const [seats, setSeats] = useState(picks.seats);
    const [password, setPassword] = useState("");
    const [status, setStatus] = useState(picks.status);
    const [hosting, setHosting] = useState(false);
    const [line, setLine] = useState<DialogLineState>({ tone: "hint", text: "" });
    const [entryId] = useState(topEntryId);
    const nameRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const input = nameRef.current?.querySelector("input");
        input?.focus();
        input?.select();
    }, []);

    async function host() {
        if (hosting) {
            return;
        }
        setHosting(true);
        setLine({ tone: "busy", text: t(language, "Hosting...") });
        rememberMultiplayerHostPicks(seats, status, place.online && !place.lanOnly ? where : picks.where);
        try {
            await multiplayerSetVisible(true, true);
            const hosted = await multiplayerHost(request.mode, request.gameId, request.hardcore, request.core,
                request.share, name.trim(), seats, password, status, where, request.watch);
            if (hosted.ok) {
                overrideRecord(entryId, { focusKey: "multiplayer:host" });
                close();
                return;
            }
            setLine({ tone: "error", text: describe(hosted.gate ?? hosted.error ?? "unavailable", hosted.detail) });
        }
        catch (e) {
            logError("multiplayerHost", e);
            setLine({ tone: "error", text: describe("unavailable") });
        }
        setHosting(false);
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <SaveOnStart canSave={!hosting} label={t(language, "Host")} onSave={() => void host()}>
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                    {t(language, "Host a Room")}
                </div>
                <div ref={nameRef} data-focus-key="multiplayer:hostroom:name">
                    <TextField
                        label={t(language, "Room name")}
                        value={name}
                        disabled={hosting}
                        onChange={(e: any) => setName(String(e?.target?.value ?? "").slice(0, NAME_MAX))}
                    />
                </div>
                <div data-focus-key="multiplayer:hostroom:players">
                    <SliderField
                        label={t(language, "Players")}
                        value={seats}
                        min={MIN_SEATS}
                        max={MAX_SEATS}
                        step={1}
                        showValue
                        bottomSeparator="standard"
                        disabled={hosting}
                        onChange={setSeats}
                    />
                </div>
                <Field
                    childrenLayout="below"
                    bottomSeparator="standard"
                    description={helpDescription(t(language, "help_multiplayer_password"), true)}
                >
                    <div data-focus-key="multiplayer:hostroom:password">
                        <TextField
                            label={t(language, "Password")}
                            value={password}
                            type="password"
                            bIsPassword
                            disabled={hosting}
                            onChange={(e: any) => setPassword(String(e?.target?.value ?? "").slice(0, PASSWORD_MAX))}
                        />
                    </div>
                </Field>
                <div style={{ ...modalBodyStyle(15), fontWeight: 600, opacity: 1, margin: "10px 0 6px 0" }}>
                    {t(language, "Room status")}
                </div>
                <Focusable
                    flow-children="grid"
                    style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "8px", alignItems: "center" }}
                >
                    {ROOM_STATUSES.map((entry) => (
                        <div
                            key={entry.labelKey}
                            data-focus-key={`multiplayer:hostroom:status:${entry.code || "none"}`}
                            style={entry.code === status ? { outline: `2px solid ${achievementGreen}`, borderRadius: "4px" } : undefined}
                        >
                            <DialogButton
                                onClick={() => setStatus(entry.code)}
                                disabled={hosting}
                                style={compactButtonStyle}
                            >
                                {t(language, entry.labelKey)}
                            </DialogButton>
                        </div>
                    ))}
                </Focusable>
                {place.online && (
                    <>
                        <div style={{ ...modalBodyStyle(15), fontWeight: 600, opacity: 1, margin: "12px 0 6px 0" }}>
                            {t(language, "Where")}
                        </div>
                        <Focusable
                            flow-children="row"
                            style={{ display: "flex", flexDirection: "row", gap: "8px", alignItems: "center" }}
                        >
                            {WHERES.map((entry) => (
                                <div
                                    key={entry.code}
                                    data-focus-key={`multiplayer:hostroom:where:${entry.code}`}
                                    style={entry.code === where ? { outline: `2px solid ${achievementGreen}`, borderRadius: "4px" } : undefined}
                                >
                                    <DialogButton
                                        onClick={() => setWhere(entry.code)}
                                        disabled={hosting || (entry.code === "online" && place.lanOnly)}
                                        style={compactButtonStyle}
                                    >
                                        {t(language, entry.labelKey)}
                                    </DialogButton>
                                </div>
                            ))}
                        </Focusable>
                        <div style={{ ...modalBodyStyle(), marginTop: "6px", color: place.lanOnly ? warnAmber : undefined, opacity: place.lanOnly ? 1 : undefined }}>
                            {place.lanOnly
                                ? t(language, "This game links over LAN, so it plays Local only.")
                                : t(language, "help_multiplayer_where")}
                        </div>
                    </>
                )}
                <Focusable
                    style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}
                    flow-children="row"
                >
                    <DialogLine {...line} beside />
                    <div data-focus-key="multiplayer:hostroom:host">
                        <DialogButton onClick={() => void host()} disabled={hosting}>
                            {t(language, "Host")}
                        </DialogButton>
                    </div>
                    <div data-focus-key="multiplayer:hostroom:cancel">
                        <DialogButton onClick={close}>
                            {t(language, "Cancel")}
                        </DialogButton>
                    </div>
                </Focusable>
            </SaveOnStart>
        </ModalRoot>
    );
}

export function openHostRoom(
    language: LanguageCode,
    request: HostRequest,
    place: HostPlace,
    describe: (code: string, detail?: Record<string, string>) => string
) {
    showManagedModal((close) => (
        <HostRoomModal language={language} request={request} place={place} describe={describe} close={close} />
    ));
}
