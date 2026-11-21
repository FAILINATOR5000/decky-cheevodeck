import { findModuleExport } from "@decky/ui";
import { logSteamEvent } from "../../api";
import { logError } from "../errors";
import { steamUiKind } from "./build";

const found = new Map<string, unknown>();

export function steamModule<T>(name: string, matches: (value: any) => boolean): T | null {
    if (found.has(name)) {
        return found.get(name) as T | null;
    }
    let value: T | null = null;
    try {
        value = findModuleExport(matches) ?? null;
    }
    catch (e) {
        logError(`steam: looking up ${name}`, e);
    }
    found.set(name, value);
    if (value === null) {
        void logSteamEvent(`${name} unavailable on ${steamUiKind()}`, "feature off").catch(() => { });
    }
    return value;
}
