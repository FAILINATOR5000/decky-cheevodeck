import { useEffect, useRef, useState } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";

import { cancelMemoriesVideoMove, getMemoriesVideoMoveStatus } from "../../api";
import { showManagedModal } from "../../utils/modalRegistry";
import { ProgressBar } from "../ui/ProgressBar";
import { t, type LanguageCode } from "../../locales";
import { modalSize } from "../../utils/scale";
import { logError } from "../../utils/errors";
import { modalBodyStyle } from "../../utils/style";
import type { MemoriesVideoMoveStatus } from "../../types";

const POLL_INTERVAL_MS = 700;

const MEGABYTE = 1024 * 1024;

function useMoveStatus(onFinished: () => void) {
    const [status, setStatus] = useState<MemoriesVideoMoveStatus | null>(null);
    const finishRef = useRef(onFinished);
    finishRef.current = onFinished;

    useEffect(function followTheMove() {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        async function tick() {
            let next: MemoriesVideoMoveStatus | null = null;
            try {
                next = await getMemoriesVideoMoveStatus();
            }
            catch (e) {
                logError("getMemoriesVideoMoveStatus", e);
            }
            if (cancelled) {
                return;
            }
            if (next === null) {
                timer = setTimeout(tick, POLL_INTERVAL_MS);
                return;
            }
            setStatus(next);
            if (next.state === "failed") {
                return;
            }
            if (next.state === "done" || next.state === "canceled" || next.state === "idle") {
                finishRef.current();
                return;
            }
            timer = setTimeout(tick, POLL_INTERVAL_MS);
        }

        void tick();
        return () => {
            cancelled = true;
            if (timer !== null) {
                clearTimeout(timer);
            }
        };
    }, []);

    return status;
}

function phaseLabel(status: MemoriesVideoMoveStatus | null, language: LanguageCode): string {
    if (status === null || status.state === "checking") {
        return t(language, "Checking space");
    }
    if (status.state === "copying") {
        return t(language, "Copying {{done}} of {{total}}", {
            done: status.copied,
            total: status.files
        });
    }
    if (status.state === "verifying" || status.state === "finishing") {
        return t(language, "Checking the copy");
    }
    if (status.state === "failed") {
        return t(language, status.error === "no_space" ? "Not enough room" : "Move failed");
    }
    return t(language, "Checking the copy");
}

function moveFraction(status: MemoriesVideoMoveStatus | null): number | null {
    if (status === null || status.totalBytes <= 0 || status.state === "checking") {
        return null;
    }
    return Math.min(status.bytes / status.totalBytes, 1);
}

function sizeLine(status: MemoriesVideoMoveStatus | null): string {
    if (status === null || status.totalBytes <= 0) {
        return "";
    }
    const done = Math.round(status.bytes / MEGABYTE);
    const total = Math.round(status.totalBytes / MEGABYTE);
    return `${done} / ${total} MB`;
}

type MemoriesVideoMoveModalProps = {
    language: LanguageCode;
    close: () => void;
};

function MemoriesVideoMoveModal(props: MemoriesVideoMoveModalProps) {
    const { language, close } = props;

    const status = useMoveStatus(close);
    const failed = status !== null && status.state === "failed";

    async function stopTheMove() {
        try {
            await cancelMemoriesVideoMove();
        }
        catch (e) {
            logError("cancelMemoriesVideoMove", e);
        }
        close();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <div style={{ fontSize: `${modalSize(18)}px`, fontWeight: 800, marginBottom: "10px" }}>
                {t(language, "Moving Clip Videos")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {!failed && <ProgressBar fraction={moveFraction(status)} />}
                <div style={modalBodyStyle(14)}>{phaseLabel(status, language)}</div>
                {!failed && (
                    <div style={modalBodyStyle()}>{sizeLine(status)}</div>
                )}
                {status !== null && status.target !== "" && (
                    <div style={{ ...modalBodyStyle(), wordBreak: "break-word" }}>{status.target}</div>
                )}
            </div>
            <Focusable
                flow-children="grid"
                style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "16px" }}
            >
                {failed ? (
                    <div data-focus-key="memories:move:close">
                        <DialogButton onClick={close} autoFocus>{t(language, "Close")}</DialogButton>
                    </div>
                ) : (
                    <>
                        <div data-focus-key="memories:move:hide">
                            <DialogButton onClick={close} autoFocus>{t(language, "Hide")}</DialogButton>
                        </div>
                        <div data-focus-key="memories:move:cancel">
                            <DialogButton onClick={stopTheMove}>{t(language, "Cancel Transfer")}</DialogButton>
                        </div>
                    </>
                )}
            </Focusable>
        </ModalRoot>
    );
}

export function openMemoriesVideoMoveModal(language: LanguageCode): void {
    showManagedModal((close) => (
        <MemoriesVideoMoveModal language={language} close={close} />
    ));
}
