import { logError } from "./errors";

const PERF_STATE_LIMITS = 1;
const LIMITS_REFRESH_MAX = 12;
const LIMITS_EXTERNAL_REFRESH_MAX = 20;
const STATE_WAIT_MS = 3000;

let maxRefresh: Promise<number> | null = null;

function readVarint(bytes: Uint8Array, at: number): [number, number] {
    let value = 0;
    let scale = 1;
    let pos = at;
    while (pos < bytes.length) {
        const byte = bytes[pos++];
        value += (byte & 0x7f) * scale;
        scale *= 128;
        if (!(byte & 0x80)) {
            break;
        }
    }
    return [value, pos];
}

function readFields(bytes: Uint8Array): Map<number, number | Uint8Array> {
    const fields = new Map<number, number | Uint8Array>();
    let pos = 0;
    while (pos < bytes.length) {
        const [key, afterKey] = readVarint(bytes, pos);
        const number = Math.floor(key / 8);
        const wire = key % 8;
        if (wire === 0) {
            const [value, afterValue] = readVarint(bytes, afterKey);
            fields.set(number, value);
            pos = afterValue;
        }
        else if (wire === 2) {
            const [length, start] = readVarint(bytes, afterKey);
            fields.set(number, bytes.subarray(start, start + length));
            pos = start + length;
        }
        else if (wire === 5) {
            pos = afterKey + 4;
        }
        else if (wire === 1) {
            pos = afterKey + 8;
        }
        else {
            break;
        }
    }
    return fields;
}

function refreshFrom(state: ArrayBuffer): number {
    const limits = readFields(new Uint8Array(state)).get(PERF_STATE_LIMITS);
    if (!(limits instanceof Uint8Array)) {
        return 0;
    }
    const fields = readFields(limits);
    const builtIn = fields.get(LIMITS_REFRESH_MAX);
    const external = fields.get(LIMITS_EXTERNAL_REFRESH_MAX);
    return Math.max(typeof builtIn === "number" ? builtIn : 0, typeof external === "number" ? external : 0);
}

export function screenMaxRefresh(): Promise<number> {
    if (maxRefresh) {
        return maxRefresh;
    }
    const asked = new Promise<number>((resolve) => {
        let settled = false;
        let handle: { unregister(): void } | null = null;
        const finish = (hz: number) => {
            if (settled) {
                return;
            }
            settled = true;
            handle?.unregister();
            resolve(hz);
        };
        try {
            handle = SteamClient.System.Perf.RegisterForStateChanges((state: ArrayBuffer) => finish(refreshFrom(state)));
            if (settled) {
                handle?.unregister();
            }
        }
        catch (e) {
            logError("screenMaxRefresh", e);
            finish(0);
        }
        window.setTimeout(() => finish(0), STATE_WAIT_MS);
    });
    maxRefresh = asked;
    void asked.then((hz) => {
        if (hz === 0 && maxRefresh === asked) {
            maxRefresh = null;
        }
    });
    return asked;
}
