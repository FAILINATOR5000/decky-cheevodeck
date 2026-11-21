import { Router } from "@decky/ui";

export function mainRunningApp(): { appid?: number | string; display_name?: string } | undefined {
    return (Router ?? (window as any).SteamUIStore)?.MainRunningApp;
}

export function runningAppId(): number {
    return Number(mainRunningApp()?.appid ?? 0);
}
