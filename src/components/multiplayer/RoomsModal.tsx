import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { multiplayerDiscover, multiplayerJoin, multiplayerLookup, multiplayerSetVisible } from "../../api";
import { overrideRecord, topEntryId } from "../../focusRecords";
import { useSlidingWindow } from "../../hooks/useSlidingWindow";
import { t, type LanguageCode } from "../../locales";
import type { MultiplayerRoomRow } from "../../types";
import { logError } from "../../utils/errors";
import { showManagedModal } from "../../utils/modalRegistry";
import { rememberMultiplayerTab } from "../../utils/multiplayerChoices";
import { getCurrentModalScale, modalSize } from "../../utils/scale";
import { searchKey } from "../../utils/searchText";
import { achievementGreen, compactButtonStyle, modalBodyStyle, warnAmber } from "../../utils/style";
import { FocusableItem } from "../ui/FocusableItem";
import { InlineSpinner } from "../ui/InlineSpinner";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SlidingWindowRows } from "../ui/SlidingWindowRows";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { DialogLine, type DialogLineState } from "./DialogLine";
import { DigitPicker } from "./DigitPicker";
import { roomStatusLabelKey } from "./roomStatus";

type Step = "list" | "password" | "ip";

const TICK_MS = 2000;
const DISCOVER_EVERY = 2;
const RENEW_EVERY = 5;
const PASSWORD_MAX = 32;

function rowKey(row: MultiplayerRoomRow): string {
    return `multiplayer:rooms:${row.room}`;
}

function validAddress(digits: string): boolean {
    return [0, 3, 6, 9].every((at) => Number(digits.slice(at, at + 3)) <= 255);
}

function addressOf(digits: string): string {
    return [0, 3, 6, 9].map((at) => String(Number(digits.slice(at, at + 3)))).join(".");
}

type RoomsModalProps = {
    language: LanguageCode;
    hardcore: boolean;
    installedCores: string[];
    describe: (code: string, detail?: Record<string, string>) => string;
    close: () => void;
};

function RoomsModal(props: RoomsModalProps) {
    const { language, hardcore, installedCores, describe, close } = props;
    const [rooms, setRooms] = useState<MultiplayerRoomRow[] | null>(null);
    const [onlineError, setOnlineError] = useState("");
    const [visibleError, setVisibleError] = useState("");
    const [query, setQuery] = useState("");
    const [step, setStep] = useState<Step>("list");
    const [picked, setPicked] = useState<MultiplayerRoomRow | null>(null);
    const [password, setPassword] = useState("");
    const [ipDigits, setIpDigits] = useState("192168001000");
    const [busy, setBusy] = useState(false);
    const [line, setLine] = useState<DialogLineState>({ tone: "hint", text: "" });
    const [entryId] = useState(topEntryId);
    const joinedRef = useRef(false);
    const lookingRef = useRef(false);
    const passwordRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        let alive = true;
        let tick = 0;
        async function look() {
            if (lookingRef.current) {
                return;
            }
            lookingRef.current = true;
            try {
                const found = await multiplayerDiscover();
                if (alive && found.ok) {
                    setRooms(found.rooms ?? []);
                    setOnlineError(found.onlineError ?? "");
                }
            }
            catch (e) {
                logError("multiplayerDiscover", e);
            }
            finally {
                lookingRef.current = false;
            }
        }
        void (async () => {
            try {
                const opened = await multiplayerSetVisible(true, true);
                if (!alive) {
                    return;
                }
                setVisibleError(opened.ok ? "" : opened.error ?? "unavailable");
                if (opened.ok) {
                    await look();
                }
            }
            catch (e) {
                logError("multiplayerSetVisible", e);
            }
        })();
        const timer = window.setInterval(() => {
            tick += 1;
            if (tick % RENEW_EVERY === 0) {
                multiplayerSetVisible(true, false)
                    .then((renewed) => {
                        if (alive) {
                            setVisibleError(renewed.ok ? "" : renewed.error ?? "unavailable");
                        }
                    })
                    .catch((e) => logError("multiplayerSetVisible", e));
            }
            if (tick % DISCOVER_EVERY === 0) {
                void look();
            }
        }, TICK_MS);
        return () => {
            alive = false;
            window.clearInterval(timer);
            if (!joinedRef.current) {
                multiplayerSetVisible(false, false).catch((e) => logError("multiplayerSetVisible", e));
            }
        };
    }, []);

    useEffect(() => {
        if (step === "password") {
            passwordRef.current?.querySelector("input")?.focus();
        }
    }, [step]);

    const statusLabel = (code: string) => {
        const key = roomStatusLabelKey(code);
        return key ? t(language, key) : "";
    };

    const listed = rooms ?? [];
    const searched = useMemo(() => {
        const wanted = searchKey(query.trim());
        if (!wanted) {
            return listed;
        }
        return listed.filter((row) => [row.name, row.title, row.user, statusLabel(row.status)]
            .some((text) => searchKey(text).includes(wanted)));
    }, [listed, query, language]);

    const roomWindow = useSlidingWindow({
        items: searched,
        itemKey: (row) => row.room,
        focusKeyFor: rowKey,
        windowId: "multiplayer:roomsmodal",
        heightScope: ["multiplayer:roomsmodal", getCurrentModalScale(), language].join("|"),
        dynamicLoading: true,
        initialRows: 20,
        rowStep: 20,
        fullSteps: true,
        prefetchDistance: 0,
        sentinelRootMarginPx: 600,
        resetKey: `multiplayer:roomsmodal|${query}`
    });

    function backToList() {
        setStep("list");
        setPicked(null);
        setPassword("");
        setLine({ tone: "hint", text: "" });
    }

    function cancel() {
        if (step !== "list") {
            backToList();
            return;
        }
        close();
    }

    async function join(row: MultiplayerRoomRow, typed: string) {
        if (busy) {
            return;
        }
        setBusy(true);
        setLine({ tone: "busy", text: t(language, "Joining...") });
        try {
            const joined = await multiplayerJoin(row.room, typed, hardcore);
            if (joined.ok) {
                joinedRef.current = true;
                rememberMultiplayerTab(row.mode);
                const running = row.mode === "couch" && row.emulator === "retroarch" && row.state === "playing";
                overrideRecord(entryId, running
                    ? { focusKey: "multiplayer:play", fallbacks: ["multiplayer:leave"] }
                    : { focusKey: "multiplayer:leave" });
                close();
                return;
            }
            setLine({ tone: "error", text: describe(joined.gate ?? joined.error ?? "unavailable", joined.detail) });
        }
        catch (e) {
            logError("multiplayerJoin", e);
            setLine({ tone: "error", text: describe("unavailable") });
        }
        setBusy(false);
    }

    function choose(row: MultiplayerRoomRow) {
        setLine({ tone: "hint", text: "" });
        if (row.private) {
            setPicked(row);
            setPassword("");
            setStep("password");
            return;
        }
        void join(row, "");
    }

    async function findByAddress() {
        if (busy || !validAddress(ipDigits)) {
            return;
        }
        setBusy(true);
        setLine({ tone: "busy", text: t(language, "Looking up {{name}}...", { name: addressOf(ipDigits) }) });
        let found: MultiplayerRoomRow | null = null;
        try {
            const answer = await multiplayerLookup(addressOf(ipDigits));
            if (answer.ok && answer.room) {
                found = answer.room;
            }
            else {
                setLine({ tone: "error", text: describe(answer.error ?? "not_found") });
            }
        }
        catch (e) {
            logError("multiplayerLookup", e);
            setLine({ tone: "error", text: describe("not_found") });
        }
        setBusy(false);
        if (found) {
            choose(found);
        }
    }

    const canJoinPicked = picked !== null && password.length > 0 && !busy;
    const dialogLine = <DialogLine {...line} />;

    let body;
    if (step === "password" && picked) {
        body = (
            <Focusable key="password" flow-children="column">
                <div style={{ ...modalBodyStyle(), opacity: 1, marginBottom: "8px" }}>
                    {t(language, "Enter the password for {{name}}'s room", { name: picked.user })}
                </div>
                <div ref={passwordRef} data-focus-key="multiplayer:rooms:password">
                    <TextField
                        label={t(language, "Password")}
                        value={password}
                        type="password"
                        bIsPassword
                        disabled={busy}
                        onChange={(e: any) => setPassword(String(e?.target?.value ?? "").slice(0, PASSWORD_MAX))}
                    />
                </div>
                {dialogLine}
                <Focusable
                    style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}
                    flow-children="row"
                >
                    <div data-focus-key="multiplayer:rooms:passwordjoin">
                        <DialogButton onClick={() => void join(picked, password)} disabled={!canJoinPicked}>
                            {t(language, "Join Room")}
                        </DialogButton>
                    </div>
                    <div data-focus-key="multiplayer:rooms:passwordback">
                        <DialogButton onClick={backToList}>
                            {t(language, "Back")}
                        </DialogButton>
                    </div>
                </Focusable>
            </Focusable>
        );
    }
    else if (step === "ip") {
        const valid = validAddress(ipDigits);
        body = (
            <Focusable key="ip" flow-children="column">
                <DigitPicker
                    language={language}
                    digits={ipDigits}
                    onChange={setIpDigits}
                    focusPrefix="multiplayer:rooms:ip"
                    groupSize={3}
                    fallbacks={["multiplayer:rooms:ipfind", "multiplayer:rooms:ipback"]}
                />
                {valid || busy
                    ? dialogLine
                    : <DialogLine tone="error" text={t(language, "Not a valid address")} />}
                <Focusable
                    style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}
                    flow-children="row"
                >
                    <div data-focus-key="multiplayer:rooms:ipfind">
                        <DialogButton onClick={() => void findByAddress()} disabled={busy || !valid}>
                            {t(language, "Find Room")}
                        </DialogButton>
                    </div>
                    <div data-focus-key="multiplayer:rooms:ipback">
                        <DialogButton onClick={backToList}>
                            {t(language, "Back")}
                        </DialogButton>
                    </div>
                </Focusable>
            </Focusable>
        );
    }
    else {
        body = (
            <Focusable key="list" flow-children="column">
                <div data-focus-key="multiplayer:rooms:search">
                    <TextField
                        label={t(language, "Search rooms")}
                        value={query}
                        onChange={(e: any) => setQuery(String(e?.target?.value ?? ""))}
                    />
                </div>
                {visibleError && (
                    <div style={{ ...modalBodyStyle(), color: warnAmber, opacity: 1, marginTop: "8px" }}>
                        {describe(visibleError)}
                    </div>
                )}
                {dialogLine}
                {onlineError && (
                    <div style={{ ...modalBodyStyle(), color: warnAmber, opacity: 1, marginTop: "8px" }}>
                        {t(language, "Couldn't reach the online lobby. Local rooms still show.")}
                    </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "8px" }}>
                    {rooms === null && !visibleError && (
                        <InlineSpinner label={t(language, "Looking for rooms...")} />
                    )}
                    {rooms !== null && listed.length === 0 && (
                        <div style={modalBodyStyle()}>
                            {t(language, "No rooms yet. Local rooms need the same Wi-Fi; online rooms need the lobby server.")}
                        </div>
                    )}
                    {listed.length > 0 && searched.length === 0 && (
                        <div style={modalBodyStyle()}>{t(language, "Nothing here matches what you typed.")}</div>
                    )}
                    {searched.length > 0 && (
                        <SlidingWindowRows list={roomWindow}>
                            {roomWindow.mountedItems.map((row, index) => {
                                const at = roomWindow.start + index;
                                const neighbors = [searched[at + 1], searched[at - 1]]
                                    .filter((other): other is MultiplayerRoomRow => other !== undefined)
                                    .map(rowKey);
                                const taken = row.seats.filter(Boolean).length;
                                const status = statusLabel(row.status);
                                const tags = [
                                    row.away ? t(language, "Away") : "",
                                    row.private ? t(language, "Private") : "",
                                    row.emulator === "retroarch" && row.core && !installedCores.includes(row.core)
                                        ? t(language, "Core not installed")
                                        : ""
                                ].filter(Boolean).join(" · ");
                                return (
                                    <div key={row.room} style={{ paddingBottom: "4px" }}>
                                        <FocusableItem
                                            focusKey={rowKey(row)}
                                            focusFallback={[...neighbors, "multiplayer:rooms:search", "multiplayer:rooms:joinip"]}
                                            disabled={busy}
                                            onGamepadFocus={() => roomWindow.onItemFocus(at)}
                                            onGamepadDirection={roomWindow.guardTopRow(at)}
                                            onClick={() => choose(row)}
                                        >
                                            <div style={{ display: "flex", flexDirection: "column", gap: "2px", ...modalBodyStyle(), opacity: 1, width: "100%", textAlign: "left" }}>
                                                <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{row.name}</div>
                                                <div style={{ overflowWrap: "anywhere" }}>
                                                    {t(language, "{{name}} · {{title}}", { name: row.user, title: row.title })}
                                                </div>
                                                <div style={{ opacity: 0.8 }}>
                                                    {t(language, row.where === "online" ? "Online" : "Local")}
                                                    {" · "}
                                                    {t(language, row.mode === "link" ? "Link Play" : "Couch Play")}
                                                    {row.coreName ? ` · ${row.coreName}` : ""}
                                                    {" · "}
                                                    {t(language, "{{taken}} of {{count}} seats", { taken, count: row.max })}
                                                    {row.state === "playing" ? ` · ${t(language, "In-Game")}` : ""}
                                                    {row.watch ? ` · ${t(language, "Watch Only")}` : ""}
                                                    {status ? ` · ${status}` : ""}
                                                </div>
                                                {tags && <div style={{ color: warnAmber }}>{tags}</div>}
                                                {row.verdict && (
                                                    <div style={{ color: row.verdict.can ? achievementGreen : warnAmber }}>
                                                        {row.verdict.can
                                                            ? `✔ ${t(language, row.watch ? "You can watch" : "You can play")}`
                                                            : describe(row.verdict.reason, row.verdict.detail)}
                                                    </div>
                                                )}
                                            </div>
                                        </FocusableItem>
                                    </div>
                                );
                            })}
                        </SlidingWindowRows>
                    )}
                </div>
                <Focusable
                    style={{ display: "flex", justifyContent: "flex-start", gap: "8px", marginTop: "16px" }}
                    flow-children="row"
                >
                    <div data-focus-key="multiplayer:rooms:joinip">
                        <DialogButton onClick={() => { setLine({ tone: "hint", text: "" }); setStep("ip"); }} style={compactButtonStyle}>
                            {t(language, "Join by IP")}
                        </DialogButton>
                    </div>
                    <div data-focus-key="multiplayer:rooms:cancel">
                        <DialogButton onClick={close} style={compactButtonStyle}>
                            {t(language, "Cancel")}
                        </DialogButton>
                    </div>
                </Focusable>
            </Focusable>
        );
    }

    return (
        <ModalRoot onCancel={cancel} onEscKeypress={cancel}>
            <SnapshotHotkey language={language} />
            <SaveOnStart
                canSave={step === "password" && canJoinPicked}
                label={t(language, "Join Room")}
                onSave={() => {
                    if (picked) {
                        void join(picked, password);
                    }
                }}
            >
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                    {t(language, "Find a Room")}
                </div>
                {body}
            </SaveOnStart>
        </ModalRoot>
    );
}

export function openRooms(
    language: LanguageCode,
    hardcore: boolean,
    installedCores: string[],
    describe: (code: string, detail?: Record<string, string>) => string
) {
    showManagedModal((close) => (
        <RoomsModal
            language={language}
            hardcore={hardcore}
            installedCores={installedCores}
            describe={describe}
            close={close}
        />
    ));
}
