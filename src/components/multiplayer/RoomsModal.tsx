import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { multiplayerDiscover, multiplayerJoin, multiplayerLookup, multiplayerRoomsPage, multiplayerSetVisible } from "../../api";
import { overrideRecord, topEntryId } from "../../focusRecords";
import { useSlidingWindow } from "../../hooks/useSlidingWindow";
import { t, type LanguageCode } from "../../locales";
import type { MultiplayerRoomFilter, MultiplayerRoomRow, MultiplayerRoomsPage, MultiplayerRoomsReply } from "../../types";
import { logError } from "../../utils/errors";
import { showManagedModal } from "../../utils/modalRegistry";
import { NO_ROOM_FILTER, multiplayerChoices, rememberMultiplayerRoomFilter, rememberMultiplayerTab } from "../../utils/multiplayerChoices";
import { startReadingLine } from "../../utils/readingLine";
import { getCurrentModalScale, modalSize } from "../../utils/scale";
import { searchKey } from "../../utils/searchText";
import { compactButtonStyle, modalBodyStyle, warnAmber } from "../../utils/style";
import { FocusableItem } from "../ui/FocusableItem";
import { InlineSpinner } from "../ui/InlineSpinner";
import { LabeledRow } from "../ui/LabeledRow";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SlidingWindowRows } from "../ui/SlidingWindowRows";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { DialogLine, type DialogLineState } from "./DialogLine";
import { ModeStateLabel, type ModeState } from "./ModeChart";
import { RoomAccessLabel, roomAccess } from "./roomAccess";
import { RoomVoiceIcon } from "./VoiceIcons";
import { RoomsFilterModal, roomFilterLabel, roomPasses } from "./RoomsFilterModal";
import { ROOM_STATUSES, roomStatusLabelKey } from "./roomStatus";

type Step = "list" | "password" | "ip";

const TICK_MS = 2000;
const DISCOVER_EVERY = 2;
const RENEW_EVERY = 5;
const PASSWORD_MAX = 32;
const ADDRESS_MAX = 15;
const LINE_INSET = "12px";
const ENTRY_MS = 6000;
const SEARCH_SETTLE_MS = 400;
const SPINNER_DELAY_MS = 300;
const SPINNER_MIN_MS = 400;
const QUERY_MAX = 64;
const NO_ROOMS: MultiplayerRoomRow[] = [];

type PageState = { total: number | null; next: string | null; checkHere: boolean; size: number };

const NO_PAGE_STATE: PageState = { total: null, next: null, checkHere: false, size: 64 };

type Entry =
    | { kind: "heading"; key: "local" | "online" }
    | { kind: "room"; row: MultiplayerRoomRow };

const NO_ENTRIES: Entry[] = [];

function entryKey(entry: Entry): string {
    return entry.kind === "heading" ? `heading:${entry.key}` : entry.row.room;
}

function entryFocusKey(entry: Entry): string {
    return entry.kind === "heading" ? `multiplayer:roomsheading:${entry.key}` : rowKey(entry.row);
}

function filterKey(filter: MultiplayerRoomFilter): string {
    return [filter.game, filter.mode, filter.kind, filter.access, filter.where, filter.seats].join("|");
}

function refreshed(shown: MultiplayerRoomRow[] | null, fresh: MultiplayerRoomRow[] | undefined): MultiplayerRoomRow[] | null {
    if (!shown || !fresh) {
        return shown;
    }
    const byId = new Map(fresh.map((row) => [row.room, row]));
    let changed = false;
    const next = shown.map((row) => {
        const update = byId.get(row.room);
        if (!update || JSON.stringify(update) === JSON.stringify(row)) {
            return row;
        }
        changed = true;
        return update;
    });
    return changed ? next : shown;
}

function rowKey(row: MultiplayerRoomRow): string {
    return `multiplayer:rooms:${row.room}`;
}

function verdictState(verdict: NonNullable<MultiplayerRoomRow["verdict"]>): ModeState {
    return verdict.state ?? (verdict.can ? "ready" : "setup");
}

function validAddress(address: string): boolean {
    const parts = address.split(".");
    return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
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
    const [pageState, setPageState] = useState<PageState>(NO_PAGE_STATE);
    const [cursors, setCursors] = useState<(string | null)[]>([null]);
    const [loading, setLoading] = useState(false);
    const [asking, setAsking] = useState(false);
    const [holdPx, setHoldPx] = useState(0);
    const [listSeq, setListSeq] = useState(0);
    const [onlineError, setOnlineError] = useState("");
    const [visibleError, setVisibleError] = useState("");
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState(() => multiplayerChoices().filter);
    const [step, setStep] = useState<Step>("list");
    const [picked, setPicked] = useState<MultiplayerRoomRow | null>(null);
    const [password, setPassword] = useState("");
    const [address, setAddress] = useState("");
    const [busy, setBusy] = useState(false);
    const [visit, setVisit] = useState(0);
    const [settling, setSettling] = useState(true);
    const [backFromIp, setBackFromIp] = useState(false);
    const stopReading = useRef<() => void>(() => { });
    useEffect(() => () => stopReading.current(), []);
    const [line, setLine] = useState<DialogLineState>({ tone: "hint", text: "" });
    const [entryId] = useState(topEntryId);
    const joinedRef = useRef(false);
    const searchRef = useRef<HTMLDivElement | null>(null);
    const passwordRef = useRef<HTMLDivElement | null>(null);
    const addressRef = useRef<HTMLDivElement | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);
    const aliveRef = useRef(true);
    useEffect(() => () => { aliveRef.current = false; }, []);
    const ticketRef = useRef(0);
    const loadingRef = useRef(false);
    const pagedRef = useRef(false);
    const shownCountRef = useRef(-1);
    const queryRef = useRef(query);
    queryRef.current = query;
    const filterRef = useRef(filter);
    filterRef.current = filter;
    const askedRef = useRef({ query: "", filter: filterKey(filter), value: filter });
    const [answered, setAnswered] = useState(() => ({ query: "", filter }));
    const seekRef = useRef(false);
    const searchTimerRef = useRef(0);

    function pageRequest(after: string | null): MultiplayerRoomsPage {
        const wanted = searchKey(queryRef.current.trim()).slice(0, QUERY_MAX);
        const current = filterRef.current;
        askedRef.current = { query: wanted, filter: filterKey(current), value: current };
        return {
            q: wanted,
            statuses: wanted
                ? ROOM_STATUSES.filter((entry) => entry.code && searchKey(t(language, entry.labelKey)).includes(wanted))
                    .map((entry) => entry.code)
                : [],
            mode: current.mode,
            kind: current.kind,
            access: current.access,
            seats: current.seats,
            where: current.where,
            mine: current.game === "mine",
            after
        };
    }

    function show(found: MultiplayerRoomsReply, fresh: boolean) {
        if (fresh || shownCountRef.current <= 0) {
            setListSeq((seq) => seq + 1);
        }
        const shown = found.rooms ?? NO_ROOMS;
        shownCountRef.current = shown.length;
        pagedRef.current = found.total !== null && found.total !== undefined;
        setRooms(shown);
        setPageState({ total: found.total ?? null, next: found.next ?? null, checkHere: found.checkHere === true,
            size: found.size ?? NO_PAGE_STATE.size });
        setOnlineError(found.onlineError ?? "");
    }

    async function askPage(stack: (string | null)[], seek: boolean, quiet = false) {
        const ticket = ++ticketRef.current;
        const asked = askedRef.current;
        seekRef.current = seekRef.current || seek;
        const seeking = seekRef.current;
        loadingRef.current = true;
        setAsking(true);
        let spinnerAt = 0;
        const startLoading = () => {
            if (ticket === ticketRef.current && aliveRef.current) {
                spinnerAt = performance.now();
                setHoldPx(listRef.current?.offsetHeight ?? 0);
                setLoading(true);
            }
        };
        const slow = quiet ? window.setTimeout(startLoading, SPINNER_DELAY_MS) : 0;
        if (!quiet) {
            startLoading();
        }
        try {
            const found = await multiplayerRoomsPage(pageRequest(stack[stack.length - 1]), seeking);
            window.clearTimeout(slow);
            const shownFor = spinnerAt ? performance.now() - spinnerAt : SPINNER_MIN_MS;
            if (shownFor < SPINNER_MIN_MS) {
                await new Promise((done) => window.setTimeout(done, SPINNER_MIN_MS - shownFor));
            }
            if (ticket !== ticketRef.current || !aliveRef.current) {
                return;
            }
            if (!found.ok) {
                askedRef.current = asked;
                return;
            }
            if (seeking) {
                seekRef.current = false;
            }
            const online = (found.rooms ?? NO_ROOMS).filter((row) => row.door === "server").length;
            if (stack.length > 1 && (found.total === null || found.total === undefined || online === 0)) {
                void askPage([null], false);
                return;
            }
            setCursors(stack);
            setAnswered({ query: askedRef.current.query, filter: askedRef.current.value });
            show(found, true);
            const typed = searchKey(queryRef.current.trim()).slice(0, QUERY_MAX) !== askedRef.current.query;
            const filtered = filterKey(filterRef.current) !== askedRef.current.filter;
            if (pagedRef.current && ((typed && !searchTimerRef.current) || filtered)) {
                void askPage([null], false, true);
            }
        }
        catch (e) {
            logError("multiplayerRoomsPage", e);
            if (ticket === ticketRef.current) {
                askedRef.current = asked;
            }
        }
        finally {
            window.clearTimeout(slow);
            if (ticket === ticketRef.current && aliveRef.current) {
                loadingRef.current = false;
                setAsking(false);
                setLoading(false);
                setHoldPx(0);
            }
        }
    }

    useEffect(() => {
        let alive = true;
        let tick = 0;
        let looking = false;
        shownCountRef.current = -1;
        const settleUntil = performance.now() + ENTRY_MS;
        setSettling(true);
        const settled = window.setTimeout(() => setSettling(false), ENTRY_MS);
        async function look() {
            if (looking || loadingRef.current) {
                return;
            }
            looking = true;
            const ticket = ticketRef.current;
            try {
                const found = await multiplayerDiscover();
                if (!alive || !found.ok || ticket !== ticketRef.current || loadingRef.current) {
                    return;
                }
                if (shownCountRef.current <= 0 || performance.now() < settleUntil) {
                    show(found, false);
                }
                else {
                    setRooms((shown) => refreshed(shown, found.rooms));
                }
            }
            catch (e) {
                logError("multiplayerDiscover", e);
            }
            finally {
                looking = false;
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
                    await askPage([null], true);
                }
                else {
                    loadingRef.current = false;
                    setAsking(false);
                    setLoading(false);
                    setHoldPx(0);
                }
            }
            catch (e) {
                logError("multiplayerSetVisible", e);
                loadingRef.current = false;
                setAsking(false);
                setLoading(false);
                setHoldPx(0);
            }
        })();
        const timer = window.setInterval(() => {
            tick += 1;
            if (tick % RENEW_EVERY === 0) {
                multiplayerSetVisible(true, false)
                    .then((renewed) => renewed.ok || renewed.error !== "cap_reached" ? renewed : multiplayerSetVisible(true, true))
                    .then((renewed) => {
                        if (alive) {
                            setVisibleError(renewed.ok ? "" : renewed.error ?? "unavailable");
                        }
                    })
                    .catch((e) => logError("multiplayerSetVisible", e));
            }
            if (tick % DISCOVER_EVERY === 0 || shownCountRef.current <= 0) {
                void look();
            }
        }, TICK_MS);
        return () => {
            alive = false;
            window.clearTimeout(settled);
            window.clearInterval(timer);
            if (!joinedRef.current) {
                multiplayerSetVisible(false, false).catch((e) => logError("multiplayerSetVisible", e));
            }
        };
    }, [visit]);

    function refresh() {
        ticketRef.current += 1;
        seekRef.current = true;
        loadingRef.current = true;
        setAsking(true);
        setHoldPx(listRef.current?.offsetHeight ?? 0);
        setLoading(true);
        setVisibleError("");
        setOnlineError("");
        setRooms(null);
        setCursors([null]);
        setPageState(NO_PAGE_STATE);
        setVisit((count) => count + 1);
    }

    useEffect(() => {
        if (!pagedRef.current || searchKey(query.trim()).slice(0, QUERY_MAX) === askedRef.current.query) {
            return;
        }
        const timer = window.setTimeout(() => {
            searchTimerRef.current = 0;
            if (searchKey(queryRef.current.trim()).slice(0, QUERY_MAX) !== askedRef.current.query) {
                void askPage([null], false, true);
            }
        }, SEARCH_SETTLE_MS);
        searchTimerRef.current = timer;
        return () => {
            window.clearTimeout(timer);
            if (searchTimerRef.current === timer) {
                searchTimerRef.current = 0;
            }
        };
    }, [query]);

    function filterClosed() {
        if (pagedRef.current && filterKey(filterRef.current) !== askedRef.current.filter) {
            void askPage([null], false, true);
        }
    }

    function turnPage(stack: (string | null)[]) {
        if (busy) {
            return;
        }
        searchRef.current?.querySelector("input")?.focus();
        void askPage(stack, false);
    }

    useEffect(() => {
        if (step === "password") {
            passwordRef.current?.querySelector("input")?.focus();
        }
        if (step === "ip") {
            addressRef.current?.querySelector("input")?.focus();
        }
    }, [step]);


    const statusLabel = (code: string) => {
        const key = roomStatusLabelKey(code);
        return key ? t(language, key) : "";
    };

    const listed = rooms ?? NO_ROOMS;
    const paged = pageState.total !== null;
    const firstPage = cursors.length === 1;
    const serverFiltered = paged && !pageState.checkHere;
    const appliedFilter = paged ? answered.filter : filter;
    const appliedQuery = paged ? answered.query : query;
    const filtered = useMemo(() => listed.filter((row) => (serverFiltered && row.door === "server") || roomPasses(row, appliedFilter)),
        [listed, appliedFilter, serverFiltered]);
    const searched = useMemo(() => {
        const wanted = searchKey(appliedQuery.trim());
        if (!wanted) {
            return filtered;
        }
        return filtered.filter((row) => (paged && row.door === "server") || [row.name, row.title, row.user, statusLabel(row.status)]
            .some((text) => searchKey(text).includes(wanted)));
    }, [filtered, appliedQuery, language, paged]);
    const entries = useMemo(() => {
        const local = firstPage ? searched.filter((row) => row.door !== "server") : NO_ROOMS;
        const online = searched.filter((row) => row.door === "server");
        const out: Entry[] = [];
        if (local.length > 0) {
            out.push({ kind: "heading", key: "local" }, ...local.map((row): Entry => ({ kind: "room", row })));
        }
        if (online.length > 0) {
            out.push({ kind: "heading", key: "online" }, ...online.map((row): Entry => ({ kind: "room", row })));
        }
        return out.length > 0 ? out : NO_ENTRIES;
    }, [searched, firstPage]);
    const roomOrder = useMemo(() => {
        const rows = entries.flatMap((entry) => entry.kind === "room" ? [entry.row] : []);
        return { rows, at: new Map(rows.map((row, index) => [row.room, index])) };
    }, [entries]);
    const filterLabel = roomFilterLabel(filter, language);
    const pages = paged ? Math.max(1, Math.ceil((pageState.total ?? 0) / pageState.size)) : 1;

    const roomWindow = useSlidingWindow({
        items: entries,
        itemKey: entryKey,
        focusKeyFor: entryFocusKey,
        windowId: "multiplayer:roomsmodal",
        heightScope: ["multiplayer:roomsmodal", getCurrentModalScale(), language].join("|"),
        dynamicLoading: true,
        initialRows: 20,
        rowStep: 20,
        fullSteps: true,
        prefetchDistance: 0,
        sentinelRootMarginPx: 600,
        resetKey: `multiplayer:roomsmodal|${listSeq}|${cursors[cursors.length - 1] ?? ""}|${query}|${filterLabel}`
    });

    function openFilter() {
        showManagedModal((closeFilter) => (
            <RoomsFilterModal
                filter={filter}
                language={language}
                onChange={(next) => {
                    filterRef.current = next;
                    setFilter(next);
                    rememberMultiplayerRoomFilter(next);
                }}
                close={() => {
                    closeFilter();
                    filterClosed();
                }}
            />
        ));
    }

    function backToList() {
        setBackFromIp(step === "ip");
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
        stopReading.current = row.mode === "couch"
            ? startReadingLine(language, (text) => setLine({ tone: "busy", text }))
            : () => { };
        try {
            const joined = await multiplayerJoin(row.room, typed, hardcore);
            stopReading.current();
            if (joined.ok) {
                joinedRef.current = true;
                rememberMultiplayerTab(row.mode);
                overrideRecord(entryId, { focusKey: "multiplayer:play", fallbacks: ["multiplayer:leave"] });
                close();
                return;
            }
            setLine({ tone: "error", text: describe(joined.gate ?? joined.error ?? "unavailable", joined.detail) });
        }
        catch (e) {
            stopReading.current();
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
        const typed = address.trim();
        if (busy || !validAddress(typed)) {
            return;
        }
        setBusy(true);
        setLine({ tone: "busy", text: t(language, "Looking up {{name}}...", { name: typed }) });
        let found: MultiplayerRoomRow | null = null;
        try {
            const answer = await multiplayerLookup(typed);
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

    const looking = !visibleError && (rooms === null || loading || (settling && listed.length === 0));
    let emptyText = "";
    if (!looking && rooms !== null && entries.length === 0) {
        if (paged) {
            emptyText = answered.query
                ? t(language, "Nothing here matches what you typed.")
                : filterKey(answered.filter) !== filterKey(NO_ROOM_FILTER)
                    ? t(language, "No rooms match the filter.")
                    : t(language, "No rooms yet. Local rooms need the same Wi-Fi; online rooms need the lobby server.");
        }
        else if (listed.length === 0) {
            emptyText = settling ? "" : t(language, "No rooms yet. Local rooms need the same Wi-Fi; online rooms need the lobby server.");
        }
        else {
            emptyText = filtered.length === 0
                ? t(language, "No rooms match the filter.")
                : t(language, "Nothing here matches what you typed.");
        }
    }
    const firstMountedRoom = roomWindow.mountedItems.findIndex((entry) => entry.kind === "room");
    const canJoinPicked = picked !== null && password.length > 0 && !busy;
    const dialogLine = <DialogLine {...line} beside />;

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
                <Focusable
                    style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}
                    flow-children="row"
                >
                    {dialogLine}
                    <div data-focus-key="multiplayer:rooms:passwordjoin">
                        <DialogButton onClick={() => void join(picked, password)} disabled={!canJoinPicked} focusable={canJoinPicked || busy}>
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
        const valid = validAddress(address.trim());
        const shown: DialogLineState = valid || busy || !address.trim()
            ? line
            : { tone: "error", text: t(language, "Not a valid address") };
        body = (
            <Focusable key="ip" flow-children="column">
                <div ref={addressRef} data-focus-key="multiplayer:rooms:address">
                    <TextField
                        label={t(language, "IP address")}
                        value={address}
                        disabled={busy}
                        onChange={(e: any) => {
                            setAddress(String(e?.target?.value ?? "").slice(0, ADDRESS_MAX));
                            setLine({ tone: "hint", text: "" });
                        }}
                    />
                </div>
                <Focusable
                    style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}
                    flow-children="row"
                >
                    <DialogLine {...shown} beside />
                    <div data-focus-key="multiplayer:rooms:ipfind">
                        <DialogButton onClick={() => void findByAddress()} disabled={busy || !valid} focusable={valid || busy}>
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
                <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div ref={searchRef} data-focus-key="multiplayer:rooms:search" style={{ flex: 1, minWidth: 0 }}>
                        <TextField
                            label={t(language, "Search rooms")}
                            value={query}
                            onChange={(e: any) => setQuery(String(e?.target?.value ?? ""))}
                        />
                    </div>
                    <div data-focus-key="multiplayer:rooms:joinip">
                        <DialogButton onClick={() => { setLine({ tone: "hint", text: "" }); setStep("ip"); }} style={compactButtonStyle} autoFocus={backFromIp}>
                            {t(language, "Join by IP")}
                        </DialogButton>
                    </div>
                    <div data-focus-key="multiplayer:rooms:refresh">
                        <DialogButton onClick={refresh} style={compactButtonStyle}>
                            {t(language, "Refresh List")}
                        </DialogButton>
                    </div>
                </Focusable>
                <LabeledRow
                    focusKey="multiplayer:rooms:filter"
                    focusFallback={["multiplayer:rooms:search", "multiplayer:rooms:joinip"]}
                    label={t(language, "Filter")}
                    value={filterLabel}
                    onClick={openFilter}
                    bottomSeparator="none"
                />
                {visibleError && (
                    <div style={{ ...modalBodyStyle(), color: warnAmber, opacity: 1, marginTop: "8px", paddingLeft: LINE_INSET }}>
                        {describe(visibleError)}
                    </div>
                )}
                {onlineError && (
                    <div style={{ ...modalBodyStyle(), color: warnAmber, opacity: 1, marginTop: "8px", paddingLeft: LINE_INSET }}>
                        {t(language, "Couldn't reach the online lobby. Local rooms still show.")}
                    </div>
                )}
                <div
                    ref={listRef}
                    style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "8px", minHeight: loading && holdPx > 0 ? `${holdPx}px` : undefined }}
                >
                    {looking && (
                        <div style={{ paddingLeft: LINE_INSET }}>
                            <InlineSpinner label={t(language, "Looking for rooms...")} />
                        </div>
                    )}
                    {emptyText && (
                        <div style={{ ...modalBodyStyle(), paddingLeft: LINE_INSET }}>{emptyText}</div>
                    )}
                    {!looking && entries.length > 0 && (
                        <SlidingWindowRows list={roomWindow}>
                            {roomWindow.mountedItems.map((entry, index) => {
                                const at = roomWindow.start + index;
                                if (entry.kind === "heading") {
                                    return (
                                        <div
                                            key={entryKey(entry)}
                                            style={{ ...modalBodyStyle(13), opacity: 1, fontWeight: 700, paddingLeft: LINE_INSET, paddingTop: at === 0 ? 0 : "8px", paddingBottom: "4px" }}
                                        >
                                            {t(language, entry.key === "local" ? "On Your Network" : "Online")}
                                        </div>
                                    );
                                }
                                const row = entry.row;
                                const place = roomOrder.at.get(row.room) ?? 0;
                                const neighbors = [roomOrder.rows[place + 1], roomOrder.rows[place - 1]]
                                    .filter((other): other is MultiplayerRoomRow => other !== undefined)
                                    .map(rowKey);
                                const taken = row.seats.filter(Boolean).length;
                                const status = statusLabel(row.status);
                                const tags = [
                                    row.away ? t(language, "Away") : "",
                                    row.emulator === "retroarch" && row.core && !installedCores.includes(row.core)
                                        ? t(language, "Core not installed")
                                        : ""
                                ].filter(Boolean).join(" · ");
                                return (
                                    <div key={row.room} style={{ paddingBottom: "4px" }}>
                                        <FocusableItem
                                            focusKey={rowKey(row)}
                                            focusFallback={[...neighbors, "multiplayer:rooms:filter", "multiplayer:rooms:search", "multiplayer:rooms:joinip"]}
                                            disabled={busy}
                                            onGamepadFocus={() => roomWindow.onItemFocus(at)}
                                            onGamepadDirection={roomWindow.guardTopRow(index === firstMountedRoom ? roomWindow.start : at)}
                                            onClick={() => choose(row)}
                                        >
                                            <div style={{ display: "flex", flexDirection: "column", gap: "2px", ...modalBodyStyle(), opacity: 1, width: "100%", textAlign: "left" }}>
                                                <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>
                                                    {row.name}
                                                    {row.voice && (
                                                        <span style={{ marginLeft: "6px", opacity: 0.8 }}><RoomVoiceIcon /></span>
                                                    )}
                                                </div>
                                                <div style={{ overflowWrap: "anywhere" }}>
                                                    {t(language, "{{name}} · {{title}}", { name: row.user, title: row.title })}
                                                </div>
                                                <div style={{ opacity: 0.8 }}>
                                                    <RoomAccessLabel access={roomAccess(row)} language={language} />
                                                    {" · "}
                                                    {t(language, row.where === "online" ? "Online" : "Local")}
                                                    {" · "}
                                                    {t(language, row.mode === "link" ? "Link Play" : row.mode === "stream" ? "Stream Play" : "Couch Play")}
                                                    {row.coreName ? ` · ${row.coreName}` : ""}
                                                    {" · "}
                                                    {t(language, "{{taken}} of {{count}} seats", { taken, count: row.max })}
                                                    {row.state === "playing" ? ` · ${t(language, "In-Game")}` : ""}
                                                    {row.watch ? ` · ${t(language, "Watch Only")}` : ""}
                                                    {status ? ` · ${status}` : ""}
                                                </div>
                                                {tags && <div style={{ color: warnAmber }}>{tags}</div>}
                                                {row.verdict && (
                                                    <div>
                                                        <ModeStateLabel language={language} state={verdictState(row.verdict)} />
                                                    </div>
                                                )}
                                            </div>
                                        </FocusableItem>
                                    </div>
                                );
                            })}
                        </SlidingWindowRows>
                    )}
                    {!looking && !asking && paged && pages > 1 && firstMountedRoom >= 0 && (
                        <Focusable flow-children="row" style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: "8px" }}>
                            <div data-focus-key="multiplayer:rooms:prevpage" style={{ justifySelf: "start" }}>
                                <DialogButton
                                    onClick={() => turnPage(cursors.slice(0, -1))}
                                    disabled={firstPage}
                                    focusable={!firstPage}
                                    style={compactButtonStyle}
                                >
                                    {t(language, "Previous Page")}
                                </DialogButton>
                            </div>
                            <div style={{ ...modalBodyStyle(), textAlign: "center" }}>
                                {t(language, "Page {{n}} of {{m}}", { n: cursors.length, m: Math.max(pages, cursors.length) })}
                            </div>
                            <div data-focus-key="multiplayer:rooms:nextpage" style={{ justifySelf: "end" }}>
                                <DialogButton
                                    onClick={() => turnPage([...cursors, pageState.next])}
                                    disabled={pageState.next === null}
                                    focusable={pageState.next !== null}
                                    style={compactButtonStyle}
                                >
                                    {t(language, "Next Page")}
                                </DialogButton>
                            </div>
                        </Focusable>
                    )}
                </div>
                <div style={{ display: "flex", marginTop: "8px" }}>
                    {dialogLine}
                </div>
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
