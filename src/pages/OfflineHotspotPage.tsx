import { Focusable, PanelSectionRow } from "@decky/ui";
import { useEffect, useState } from "react";

import { hotspotScan, type HotspotDevice, type HotspotRow } from "../api";
import { openHotspotCode } from "../components/hotspot/HotspotCodeModal";
import { skipWhileHidden } from "../components/panel/skipWhileHidden";
import { BackButton } from "../components/ui/BackButton";
import { BottomFocusAnchor } from "../components/ui/BottomFocusAnchor";
import { FocusableItem } from "../components/ui/FocusableItem";
import { InlineSpinner } from "../components/ui/InlineSpinner";
import { LabeledRow } from "../components/ui/LabeledRow";
import { PageNavStrip } from "../components/ui/PageNavStrip";
import { PanelSection } from "../components/ui/PanelSection";
import { SectionTitle } from "../components/ui/SectionTitle";
import { SlidingWindowRows } from "../components/ui/SlidingWindowRows";
import { ToggleRow } from "../components/ui/ToggleRow";
import { pendingLandingKey, subLandingAhead, usePageLanding } from "../focusRecords";
import { useSlidingWindow } from "../hooks/useSlidingWindow";
import { t, type LanguageCode } from "../locales";
import type { ButtonSpacing, ViewKey } from "../types";
import { logError } from "../utils/errors";
import {
    joinHotspot,
    leaveHotspot,
    setHotspotPrivateNext,
    switchDedicatedHotspot,
    switchHotspot,
    useHotspot,
    useHotspotDedicated,
    useHotspotPrivateNext
} from "../utils/hotspotState";
import { textSize } from "../utils/scale";
import { bodyTextStyle, regularButtonSpacingStyle, warnAmber } from "../utils/style";

const BACK_BUTTON_SCROLL_MARGIN_PX = 24;
const TOGGLE_KEY = "offlineHotspot:toggle:on";
const DEDICATED_KEY = "offlineHotspot:toggle:dedicated";
const PRIVATE_KEY = "offlineHotspot:toggle:private";
const LEAVE_KEY = "offlineHotspot:leave";
const DEVICE_PREFIX = "offlineHotspot:device:";
const JOIN_PREFIX = "offlineHotspot:join:";
const SCAN_MS = 5000;
const ROWS_INITIAL = 20;
const ROWS_STEP = 20;
const SENTINEL_ROOT_MARGIN_PX = 600;

const NO_DEVICES: HotspotDevice[] = [];
const NO_HOTSPOTS: HotspotRow[] = [];

type OfflineHotspotPageState = {
    view: ViewKey;
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
};

type OfflineHotspotPageActions = {
    onBack: () => void | Promise<void>;
    onHome: () => void | Promise<void>;
};

type OfflineHotspotPageProps = {
    state: OfflineHotspotPageState;
    actions: OfflineHotspotPageActions;
};

function deviceKey(device: HotspotDevice): string {
    return DEVICE_PREFIX + device.mac;
}

function joinKey(row: HotspotRow): string {
    return JOIN_PREFIX + row.ssid;
}

function formatCode(code: string): string {
    return code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
}

function OfflineHotspotPage(props: OfflineHotspotPageProps) {
    const { state, actions } = props;
    const { language } = state;
    const visible = state.view === "offlineHotspot";
    const hotspot = useHotspot();
    const privateNext = useHotspotPrivateNext();
    const dedicated = useHotspotDedicated();
    const hosting = hotspot.role === "host" && hotspot.state !== "stopping";
    const [found, setFound] = useState<HotspotRow[] | null>(null);
    const [joining, setJoining] = useState("");

    useEffect(() => {
        if (!visible || hosting) {
            return;
        }
        let alive = true;
        async function scan() {
            try {
                const result = await hotspotScan();
                if (alive && result.ok) {
                    setFound(result.hotspots);
                }
            }
            catch (e) {
                logError("offline hotspot: scanning", e);
            }
        }
        void scan();
        const timer = setInterval(() => void scan(), SCAN_MS);
        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, [visible, hosting]);

    const devices = hosting ? hotspot.devices : NO_DEVICES;
    const hotspots = hosting ? NO_HOTSPOTS : (found ?? NO_HOTSPOTS);
    const deviceWindow = useSlidingWindow({
        items: devices,
        itemKey: (device) => device.mac,
        focusKeyFor: deviceKey,
        windowId: "offlineHotspot:devices",
        heightScope: ["offlineHotspot:devices", language, textSize(12)].join("|"),
        dynamicLoading: true,
        initialRows: ROWS_INITIAL,
        rowStep: ROWS_STEP,
        prefetchDistance: 0,
        sentinelRootMarginPx: SENTINEL_ROOT_MARGIN_PX,
        resetKey: `offlineHotspot:devices|${hotspot.ssid}`,
        openFirst: pendingLandingKey("offlineHotspot") ?? undefined
    });
    const joinWindow = useSlidingWindow({
        items: hotspots,
        itemKey: (row) => row.ssid,
        focusKeyFor: joinKey,
        windowId: "offlineHotspot:join",
        heightScope: ["offlineHotspot:join", language, textSize(12)].join("|"),
        dynamicLoading: true,
        initialRows: ROWS_INITIAL,
        rowStep: ROWS_STEP,
        prefetchDistance: 0,
        sentinelRootMarginPx: SENTINEL_ROOT_MARGIN_PX,
        resetKey: `offlineHotspot:join|${hosting}`,
        openFirst: pendingLandingKey("offlineHotspot") ?? undefined
    });

    usePageLanding({
        view: "offlineHotspot",
        active: visible,
        defaultKey: "offlineHotspot:back",
        ready: hosting || found !== null,
        holds: (key) => devices.some((device) => deviceKey(device) === key) || hotspots.some((row) => joinKey(row) === key),
        open: (key) => (key.startsWith(DEVICE_PREFIX) ? deviceWindow.openAt(key) : joinWindow.openAt(key))
    });

    if (!visible) {
        return null;
    }

    async function join(row: HotspotRow, code: string) {
        setJoining(row.ssid);
        try {
            await joinHotspot(row.ssid, code);
        }
        finally {
            setJoining("");
        }
    }

    const joiningSsid = joining || (hotspot.state === "joining" ? hotspot.ssid : "");

    function pick(row: HotspotRow) {
        if (joiningSsid) {
            return;
        }
        if (row.private) {
            openHotspotCode(language, row.ssid, (code) => void join(row, code));
            return;
        }
        void join(row, "");
    }

    const guest = hotspot.role === "guest" && hotspot.state === "guest";
    const guestNow = hotspot.role === "guest" && hotspot.state !== "stopping";
    const lines: { text: string; warn?: boolean }[] = [];
    if (hosting && hotspot.state === "host") {
        if (hotspot.uplink) {
            lines.push({ text: hotspot.sharing
                ? t(language, "Staying on {{network}}. Nearby devices share its internet.", { network: hotspot.uplink })
                : t(language, "Staying on {{network}}.", { network: hotspot.uplink }) });
        }
        else if (hotspot.sharing) {
            lines.push({ text: t(language, "Sharing this device's internet with nearby devices.") });
        }
        if (hotspot.paused && hotspot.dfs) {
            lines.push({ text: t(language, "Your network's channel can't carry a hotspot, so it's paused while the hotspot is on."), warn: true });
        }
        else if (hotspot.paused && hotspot.sharing) {
            lines.push({ text: t(language, "Your Wi-Fi network is paused while the hotspot is on.") });
        }
        else if (hotspot.paused) {
            lines.push({ text: t(language, "Your Wi-Fi network is paused while the hotspot is on, so there's no internet."), warn: true });
        }
    }
    if ((hotspot.state === "host" || guest) && !hotspot.internet) {
        lines.push({ text: t(language, "Achievements won't load in a game started with no internet."), warn: true });
    }

    const scopeKey = `offlineHotspot:view:${hosting ? "host" : "join"}`;

    return (
        <Focusable flow-children="column">
            <PanelSection>
                <PageNavStrip title={t(language, "Offline Hotspot")} buttonSpacing={state.buttonSpacing} onHome={actions.onHome} />

                <BackButton
                    label={t(language, "Back")}
                    focusKey="offlineHotspot:back"
                    navAutoFocus
                    standDown={subLandingAhead("offlineHotspot", 0)}
                    buttonSpacing={state.buttonSpacing}
                    onClick={actions.onBack}
                    scrollMarginTop={BACK_BUTTON_SCROLL_MARGIN_PX}
                />

                <PanelSectionRow>
                    <ToggleRow
                        label={t(language, "Offline Hotspot")}
                        value={hosting}
                        controlled
                        disabled={guestNow}
                        onChange={(next) => void switchHotspot(next)}
                        help={t(language, "Makes a Wi-Fi network for nearby devices running CheevoDeck.")}
                        focusKey={TOGGLE_KEY}
                    />
                </PanelSectionRow>
                {hosting && hotspot.canStay && (
                    <PanelSectionRow>
                        <ToggleRow
                            label={t(language, "Dedicated Hotspot")}
                            value={dedicated}
                            controlled
                            onChange={(next) => void switchDedicatedHotspot(next)}
                            help={t(language, "help_dedicated_hotspot")}
                            focusKey={DEDICATED_KEY}
                            focusFallback={[TOGGLE_KEY]}
                        />
                    </PanelSectionRow>
                )}
                <PanelSectionRow>
                    <ToggleRow
                        label={t(language, "Private Hotspot")}
                        value={privateNext}
                        onChange={setHotspotPrivateNext}
                        help={t(language, "Asks for an 8-digit code to join. Applies the next time it turns on.")}
                        focusKey={PRIVATE_KEY}
                    />
                </PanelSectionRow>

                {lines.map((line) => (
                    <PanelSectionRow key={line.text}>
                        <div style={{ ...bodyTextStyle(), marginTop: "8px", color: line.warn ? warnAmber : undefined }}>{line.text}</div>
                    </PanelSectionRow>
                ))}

                <Focusable key={scopeKey} flow-children="column">
                    {hosting && (
                        <>
                            {hotspot.state === "starting" && (
                                <PanelSectionRow>
                                    <InlineSpinner label={t(language, "Offline Hotspot")} />
                                </PanelSectionRow>
                            )}
                            {hotspot.ssid && (
                                <LabeledRow
                                    focusKey="offlineHotspot:ssid"
                                    label={t(language, "Network name")}
                                    value={hotspot.private ? `${hotspot.ssid} · ${t(language, "tag_private_hotspot")}` : hotspot.ssid}
                                />
                            )}
                            {hotspot.code && <LabeledRow focusKey="offlineHotspot:code" label={t(language, "Hotspot code")} value={formatCode(hotspot.code)} />}

                            <SectionTitle label={t(language, "Connected Devices")} />
                            {devices.length > 0 && (
                                <SlidingWindowRows list={deviceWindow}>
                                    {deviceWindow.mountedItems.map((device, index) => {
                                        const at = deviceWindow.start + index;
                                        const neighbors = [devices[at + 1], devices[at - 1]]
                                            .filter((other): other is HotspotDevice => other !== undefined)
                                            .map(deviceKey);
                                        return (
                                            <PanelSectionRow key={device.mac}>
                                                <FocusableItem
                                                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                                    focusKey={deviceKey(device)}
                                                    focusFallback={[...neighbors, PRIVATE_KEY, TOGGLE_KEY]}
                                                    onGamepadFocus={() => deviceWindow.onItemFocus(at)}
                                                    onGamepadDirection={deviceWindow.guardTopRow(at)}
                                                >
                                                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                                        <div>{device.name || device.address || device.mac}</div>
                                                        {device.name && device.address && <div style={bodyTextStyle()}>{device.address}</div>}
                                                    </div>
                                                </FocusableItem>
                                            </PanelSectionRow>
                                        );
                                    })}
                                </SlidingWindowRows>
                            )}
                            {devices.length === 0 && (
                                <PanelSectionRow>
                                    <div style={bodyTextStyle()}>{t(language, "No devices connected yet.")}</div>
                                </PanelSectionRow>
                            )}
                            {hotspot.example && (
                                <PanelSectionRow>
                                    <div style={{ ...bodyTextStyle(), marginTop: "8px" }}>
                                        {t(language, "Devices without CheevoDeck: set the address by hand, for example {{address}}, mask 255.255.255.0.", { address: hotspot.example })}
                                    </div>
                                </PanelSectionRow>
                            )}
                        </>
                    )}

                    {!hosting && (
                        <>
                            <SectionTitle label={t(language, "Join a Hotspot")} />
                            {guest && (
                                <>
                                    <PanelSectionRow>
                                        <div style={bodyTextStyle()}>
                                            {t(language, "Connected to {{network}}", { network: hotspot.host ? `${hotspot.ssid} (${hotspot.host})` : hotspot.ssid })}
                                        </div>
                                    </PanelSectionRow>
                                    <PanelSectionRow>
                                        <FocusableItem
                                            outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                            focusKey={LEAVE_KEY}
                                            focusFallback={[TOGGLE_KEY]}
                                            onClick={() => void leaveHotspot()}
                                        >
                                            {t(language, "Leave Hotspot")}
                                        </FocusableItem>
                                    </PanelSectionRow>
                                </>
                            )}
                            {hotspots.length > 0 && (
                                <SlidingWindowRows list={joinWindow}>
                                    {joinWindow.mountedItems.map((row, index) => {
                                        const at = joinWindow.start + index;
                                        const neighbors = [hotspots[at + 1], hotspots[at - 1]]
                                            .filter((other): other is HotspotRow => other !== undefined)
                                            .map(joinKey);
                                        const here = guest && hotspot.ssid === row.ssid;
                                        return (
                                            <PanelSectionRow key={row.ssid}>
                                                <FocusableItem
                                                    outerStyle={regularButtonSpacingStyle(state.buttonSpacing)}
                                                    focusKey={joinKey(row)}
                                                    focusFallback={[...neighbors, PRIVATE_KEY, TOGGLE_KEY]}
                                                    disabled={here}
                                                    onGamepadFocus={() => joinWindow.onItemFocus(at)}
                                                    onGamepadDirection={joinWindow.guardTopRow(at)}
                                                    onClick={() => pick(row)}
                                                >
                                                    <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                                                        <span>{row.private ? `${row.ssid} · ${t(language, "tag_private_hotspot")}` : row.ssid}</span>
                                                        <span style={bodyTextStyle()}>
                                                            {joiningSsid === row.ssid ? t(language, "Joining...") : `${row.strength}%`}
                                                        </span>
                                                    </div>
                                                </FocusableItem>
                                            </PanelSectionRow>
                                        );
                                    })}
                                </SlidingWindowRows>
                            )}
                            {hotspots.length === 0 && (
                                <PanelSectionRow>
                                    {found === null
                                        ? <InlineSpinner label={t(language, "Searching for hotspots...")} />
                                        : <div style={bodyTextStyle()}>{t(language, "No CheevoDeck hotspots nearby.")}</div>}
                                </PanelSectionRow>
                            )}
                        </>
                    )}

                </Focusable>

                <BottomFocusAnchor focusKey="offlineHotspot:bottom:anchor" />
            </PanelSection>
        </Focusable>
    );
}

export default skipWhileHidden(OfflineHotspotPage, (props) => props.state.view === "offlineHotspot");
