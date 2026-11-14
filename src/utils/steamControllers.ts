import { findModuleExport, Router } from "@decky/ui";
import { logError } from "./errors";

type ControllerListMessage = {
    BSuccess(): boolean;
    Body(): { toObject(): { controllers?: RawController[] } };
};

type RawController = {
    controller_index?: number;
    xinput_index?: number;
    name?: string;
    vendor_id?: number;
    product_id?: number;
    battery_level?: number;
    is_charging?: boolean;
    is_bluetooth?: boolean;
    is_wireless_steam_dongle?: boolean;
    serial_number?: string;
    firmware_build_time?: string;
};

type Registration = { unregister(): void };

type ControllerService = {
    GetControllerList(request: object): Promise<ControllerListMessage>;
    RegisterForNotifyControllerListChanged(handler: () => number): Registration;
    RegisterForNotifyControllerBatteryState(handler: () => number): Registration;
};

export type SteamPad = {
    index: number;
    slot: number;
    name: string;
    battery: number | null;
    charging: boolean;
    builtIn: boolean;
    vendorId: number;
    productId: number;
    connection: "builtIn" | "bluetooth" | "dongle" | "wired";
    serial: string;
    firmware: string;
};

const DECK_CONTROLLER_VID = 0x28de;
const DECK_CONTROLLER_PID = 0x1205;

const HANDLED = 1;

let cached: ControllerService | null | undefined;

function service(): ControllerService | null {
    if (cached !== undefined) {
        return cached;
    }
    try {
        cached = findModuleExport((e: any) =>
            typeof e?.GetControllerList === "function"
            && typeof e?.RegisterForNotifyControllerListChanged === "function"
            && typeof e?.RegisterForNotifyControllerBatteryState === "function"
        ) ?? null;
    }
    catch (e) {
        logError("finding Steam's controller service", e);
        cached = null;
    }
    return cached ?? null;
}

export async function readSteamPads(): Promise<SteamPad[] | null> {
    const svc = service();
    if (!svc) {
        return null;
    }
    const message = await svc.GetControllerList({});
    if (!message.BSuccess()) {
        return null;
    }
    const pads: SteamPad[] = [];
    for (const raw of message.Body().toObject().controllers ?? []) {
        const slot = raw.xinput_index ?? -1;
        if (!Number.isInteger(slot) || slot < 0 || raw.controller_index === undefined) {
            continue;
        }
        const builtIn = raw.vendor_id === DECK_CONTROLLER_VID && raw.product_id === DECK_CONTROLLER_PID;
        pads.push({
            index: raw.controller_index,
            slot,
            name: raw.name ?? "",
            battery: builtIn || raw.battery_level === undefined ? null : raw.battery_level,
            charging: raw.is_charging === true,
            builtIn,
            vendorId: raw.vendor_id ?? 0,
            productId: raw.product_id ?? 0,
            connection: builtIn
                ? "builtIn"
                : raw.is_bluetooth ? "bluetooth" : raw.is_wireless_steam_dongle ? "dongle" : "wired",
            serial: raw.serial_number ?? "",
            firmware: raw.firmware_build_time ?? ""
        });
    }
    pads.sort((a, b) => a.slot - b.slot || a.index - b.index);
    return pads;
}

export function onSteamPadsChanged(listener: () => void): () => void {
    const svc = service();
    if (!svc) {
        return () => { };
    }
    const handler = () => {
        listener();
        return HANDLED;
    };
    const list = svc.RegisterForNotifyControllerListChanged(handler);
    const battery = svc.RegisterForNotifyControllerBatteryState(handler);
    return () => {
        list.unregister();
        battery.unregister();
    };
}

export type DeckBattery = { level: number; charging: boolean };

export function onDeckBattery(listener: (battery: DeckBattery | null) => void): () => void {
    const handle = SteamClient.System.RegisterForBatteryStateChanges((state: {
        bHasBattery?: boolean;
        flLevel?: number;
        eACState?: number;
    }) => {
        if (!state?.bHasBattery || typeof state.flLevel !== "number") {
            listener(null);
            return;
        }
        listener({ level: Math.round(state.flLevel * 100), charging: (state.eACState ?? 0) >= 2 });
    });
    return () => handle?.unregister?.();
}

export function gameRunning(): boolean {
    return Number(Router.MainRunningApp?.appid ?? 0) > 0;
}

export function swapSteamPads(fromSlot: number, toSlot: number): void {
    SteamClient.Input.SwapControllerOrder(fromSlot, toSlot);
}

export function pingSteamPad(index: number): void {
    SteamClient.Input.IdentifyController(index);
}
