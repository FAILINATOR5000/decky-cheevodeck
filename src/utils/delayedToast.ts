import { toaster } from "@decky/api";

type ToastData = Parameters<typeof toaster.toast>[0];

export const AFTER_DIALOG_TOAST_DELAY_MS = 2000;

export function showToastAfter(toast: ToastData, delayMs: number) {
    window.setTimeout(() => toaster.toast(toast), delayMs);
}
