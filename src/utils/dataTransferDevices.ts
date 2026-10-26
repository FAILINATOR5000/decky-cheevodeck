import type { DataDeviceRow } from "../types";

let lastSeen: DataDeviceRow[] | null = null;

export function lastDataDevices(): DataDeviceRow[] | null {
    return lastSeen;
}

export function rememberDataDevices(rows: DataDeviceRow[] | null): void {
    lastSeen = rows;
}
