import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import { useEffect, useRef, useState } from "react";

import { multiplayerJoin, multiplayerSetVisible } from "../../api";
import { overrideRecord, topEntryId } from "../../focusRecords";
import { t, type LanguageCode } from "../../locales";
import type { MultiplayerRoomRow } from "../../types";
import { logError } from "../../utils/errors";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { errorRed, modalBodyStyle } from "../../utils/style";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

const PASSWORD_MAX = 32;
const RENEW_MS = 10000;

type JoinPasswordModalProps = {
    language: LanguageCode;
    row: MultiplayerRoomRow;
    hardcore: boolean;
    describe: (code: string, detail?: Record<string, string>) => string;
    close: () => void;
};

function JoinPasswordModal(props: JoinPasswordModalProps) {
    const { language, row, hardcore, describe, close } = props;
    const [password, setPassword] = useState("");
    const [joining, setJoining] = useState(false);
    const [failure, setFailure] = useState("");
    const [entryId] = useState(topEntryId);
    const fieldRef = useRef<HTMLDivElement | null>(null);
    const canJoin = password.length > 0 && !joining;

    useEffect(() => {
        fieldRef.current?.querySelector("input")?.focus();
        const timer = window.setInterval(() => {
            multiplayerSetVisible(true, false).catch((e) => logError("multiplayerSetVisible", e));
        }, RENEW_MS);
        return () => window.clearInterval(timer);
    }, []);

    async function join() {
        if (!canJoin) {
            return;
        }
        setJoining(true);
        setFailure("");
        try {
            await multiplayerSetVisible(true, true);
            const joined = await multiplayerJoin(row.room, password, hardcore);
            if (joined.ok) {
                overrideRecord(entryId, { focusKey: "multiplayer:leave" });
                close();
                return;
            }
            setFailure(describe(joined.gate ?? joined.error ?? "unavailable", joined.detail));
        }
        catch (e) {
            logError("multiplayerJoin", e);
            setFailure(describe("unavailable"));
        }
        setJoining(false);
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <SaveOnStart canSave={canJoin} label={t(language, "Join Room")} onSave={() => void join()}>
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                    {t(language, "Enter the password for {{name}}'s room", { name: row.user })}
                </div>
                <div ref={fieldRef} data-focus-key="multiplayer:joinroom:password">
                    <TextField
                        label={t(language, "Password")}
                        value={password}
                        bIsPassword
                        disabled={joining}
                        onChange={(e: any) => setPassword(String(e?.target?.value ?? "").slice(0, PASSWORD_MAX))}
                    />
                </div>
                {failure && (
                    <div style={{ ...modalBodyStyle(), color: errorRed, opacity: 1, marginTop: "12px" }}>{failure}</div>
                )}
                <Focusable
                    style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}
                    flow-children="row"
                >
                    <div data-focus-key="multiplayer:joinroom:join">
                        <DialogButton onClick={() => void join()} disabled={!canJoin}>
                            {t(language, "Join Room")}
                        </DialogButton>
                    </div>
                    <div data-focus-key="multiplayer:joinroom:cancel">
                        <DialogButton onClick={close}>
                            {t(language, "Cancel")}
                        </DialogButton>
                    </div>
                </Focusable>
            </SaveOnStart>
        </ModalRoot>
    );
}

export function openJoinPassword(
    language: LanguageCode,
    row: MultiplayerRoomRow,
    hardcore: boolean,
    describe: (code: string, detail?: Record<string, string>) => string
) {
    showManagedModal((close) => (
        <JoinPasswordModal language={language} row={row} hardcore={hardcore} describe={describe} close={close} />
    ));
}
