import { t, type LanguageCode } from "../locales";
import type { NearbyDeviceRow, NearbyPeer } from "../types";

let lastSeen: NearbyDeviceRow[] | null = null;

export function lastNearbyDevices(): NearbyDeviceRow[] | null {
    return lastSeen;
}

export function rememberNearbyDevices(rows: NearbyDeviceRow[] | null): void {
    lastSeen = rows;
}

const PRODUCTS: Record<string, string> = {
    Jupiter: "Steam Deck LCD",
    Galileo: "Steam Deck OLED",
    Fremont: "Steam Machine"
};

const DEFAULT_HOST = "steamdeck";

export function nearbyDeviceName(peer: NearbyPeer, language: LanguageCode): string {
    const name = PRODUCTS[peer.model] ?? t(language, "SteamOS Device");
    return peer.host && peer.host !== DEFAULT_HOST ? `${name} · ${peer.host}` : name;
}

export function nearbyDeviceLabel(peer: NearbyPeer, language: LanguageCode): string {
    const name = nearbyDeviceName(peer, language);
    if (peer.host && peer.host !== DEFAULT_HOST) {
        return name;
    }
    const octet = peer.address.split(".").pop() ?? "";
    return octet ? `${name} · .${octet}` : name;
}

export function nearbyDeviceAddressLabel(peer: NearbyPeer, language: LanguageCode): string {
    const name = nearbyDeviceName(peer, language);
    if (peer.host && peer.host !== DEFAULT_HOST) {
        return name;
    }
    return peer.address ? `${name} · ${peer.address}` : name;
}
