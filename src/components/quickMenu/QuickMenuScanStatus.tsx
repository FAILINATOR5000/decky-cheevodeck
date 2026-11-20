import { Focusable, PanelSectionRow } from "@decky/ui";
import { useEffect, useState } from "react";

import { getCheevoCheckScanStatus, getFileWatcherPassStatus } from "../../api";
import { t, type LanguageCode } from "../../locales";
import { logError } from "../../utils/errors";
import { bodyTextStyle } from "../../utils/style";
import { FocusTarget } from "../ui/FocusTarget";
import { focusReticle } from "../ui/HeadingStop";
import { ProgressBar } from "../ui/ProgressBar";

const POLL_MS = 1000;

const ROW_STYLES = `
.da-qm-scan.gpfocus .da-progress-track {
    background: rgba(255, 255, 255, 0.14) !important;
}
`;

const CHEEVO_KEY = "quickmenu:scan:cheevocheck";
const WATCH_KEY = "quickmenu:scan:filewatcher";

type CheevoStatus = Awaited<ReturnType<typeof getCheevoCheckScanStatus>>;
type WatchStatus = Awaited<ReturnType<typeof getFileWatcherPassStatus>>;

export type ScanSnapshot = { cheevo: CheevoStatus; watch: WatchStatus };

type RowState = "running" | "scheduled" | "paused" | "complete" | "failed";

type Row = {
    state: RowState;
    fraction: number;
    dueAt: number;
};

export async function readScanStatus(): Promise<ScanSnapshot | null> {
    try {
        const [cheevo, watch] = await Promise.all([getCheevoCheckScanStatus(), getFileWatcherPassStatus()]);
        return { cheevo, watch };
    }
    catch (e) {
        logError("quick menu scan status read", e);
        return null;
    }
}

function ratio(done: unknown, total: unknown): number | null {
    const d = Number(done);
    const n = Number(total);
    if (!Number.isFinite(d) || !Number.isFinite(n) || n <= 0) {
        return null;
    }
    return Math.min(1, Math.max(0, d / n));
}

function isFinal(row: Row | null) {
    return row === null || row.state === "complete" || row.state === "failed";
}

function cheevoRow(status: CheevoStatus, prev: Row | null): Row | null {
    if (prev !== null && isFinal(prev)) {
        return prev;
    }
    if (status?.running) {
        return { state: "running", fraction: ratio(status.progress?.done, status.progress?.total) ?? 0, dueAt: 0 };
    }
    if (status?.scheduled) {
        return { state: "scheduled", fraction: 0, dueAt: Number(status.scheduledAt) || 0 };
    }
    if (prev === null) {
        return null;
    }
    if (status?.error) {
        return { state: "failed", fraction: prev.fraction, dueAt: 0 };
    }
    return { state: "complete", fraction: 1, dueAt: 0 };
}

function watchRow(status: WatchStatus, prev: Row | null): Row | null {
    if (prev !== null && isFinal(prev)) {
        return prev;
    }
    const pass = status?.pass;
    if (pass) {
        const fraction = ratio(pass.doneBytes, pass.totalBytes) ?? 0;
        return { state: pass.active ? "running" : "paused", fraction, dueAt: 0 };
    }
    if (prev === null) {
        return null;
    }
    return { state: "complete", fraction: 1, dueAt: 0 };
}

function cheevoText(language: LanguageCode, row: Row) {
    switch (row.state) {
        case "scheduled":
            return t(language, "Cheevo Check: In {{seconds}}s...", {
                seconds: Math.max(0, Math.ceil(row.dueAt - Date.now() / 1000))
            });
        case "complete":
            return t(language, "Cheevo Check: Complete");
        case "failed":
            return t(language, "Cheevo Check: Failed");
        default:
            return t(language, "Cheevo Check: Running");
    }
}

function watchText(language: LanguageCode, row: Row) {
    switch (row.state) {
        case "paused":
            return t(language, "File Watcher: Paused");
        case "complete":
            return t(language, "File Watcher: Complete");
        default:
            return t(language, "File Watcher: Running");
    }
}

function StatusRow(props: {
    focusKey: string;
    focusFallback: string[];
    text: string;
    fraction: number;
    onPress: () => void;
}) {
    const [focused, setFocused] = useState(false);
    return (
        <PanelSectionRow>
            <div style={{ width: "100%", padding: "4px 0" }}>
                <FocusTarget
                    focusKey={props.focusKey}
                    focusFallback={props.focusFallback}
                    style={{ display: "flex", width: "100%" }}
                >
                    <Focusable
                        className="da-qm-scan"
                        onActivate={props.onPress}
                        noFocusRing
                        onGamepadFocus={() => setFocused(true)}
                        onGamepadBlur={() => setFocused(false)}
                        style={{ width: "100%", padding: "4px 6px", boxSizing: "border-box", ...focusReticle(focused, false) }}
                    >
                        <div style={bodyTextStyle()}>{props.text}</div>
                        <div style={{ marginTop: "6px" }}>
                            <ProgressBar fraction={props.fraction} />
                        </div>
                    </Focusable>
                </FocusTarget>
            </div>
        </PanelSectionRow>
    );
}

export function QuickMenuScanStatus(props: {
    language: LanguageCode;
    snapshot: ScanSnapshot;
    onLeave: () => void;
    openCheevoCheck: () => void | Promise<void>;
    openFileWatcher: () => void | Promise<void>;
}) {
    const { language } = props;
    const [cheevo, setCheevo] = useState<Row | null>(() => cheevoRow(props.snapshot.cheevo, null));
    const [watch, setWatch] = useState<Row | null>(() => watchRow(props.snapshot.watch, null));
    const moving = !isFinal(cheevo) || !isFinal(watch);

    useEffect(() => {
        if (!moving) {
            return;
        }
        let live = true;
        const timer = window.setInterval(() => {
            void readScanStatus().then((snapshot) => {
                if (!live || snapshot === null) {
                    return;
                }
                setCheevo((prev) => (prev === null ? null : cheevoRow(snapshot.cheevo, prev)));
                setWatch((prev) => (prev === null ? null : watchRow(snapshot.watch, prev)));
            });
        }, POLL_MS);
        return () => {
            live = false;
            window.clearInterval(timer);
        };
    }, [moving]);

    if (cheevo === null && watch === null) {
        return null;
    }
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", paddingBottom: "8px" }}>
            <style>{ROW_STYLES}</style>
            {cheevo !== null && (
                <StatusRow
                    focusKey={CHEEVO_KEY}
                    focusFallback={watch !== null ? [WATCH_KEY, "quickmenu:search"] : ["quickmenu:search"]}
                    text={cheevoText(language, cheevo)}
                    fraction={cheevo.fraction}
                    onPress={() => {
                        props.onLeave();
                        void props.openCheevoCheck();
                    }}
                />
            )}
            {watch !== null && (
                <StatusRow
                    focusKey={WATCH_KEY}
                    focusFallback={cheevo !== null ? [CHEEVO_KEY, "quickmenu:search"] : ["quickmenu:search"]}
                    text={watchText(language, watch)}
                    fraction={watch.fraction}
                    onPress={() => {
                        props.onLeave();
                        void props.openFileWatcher();
                    }}
                />
            )}
        </div>
    );
}
