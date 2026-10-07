import { toaster } from "@decky/api";
import { Navigation, QuickAccessTab, showModal } from "@decky/ui";
import { cloneElement, createElement, useEffect, type ReactElement } from "react";
import { logFocusDebug } from "../api";
import { markCloseTrace, traceModalClose } from "./closeTrace";
import { logError } from "./errors";
import { focusOurPlugin } from "./quickAccess";

type OpenModal = {
    close: () => void;
    needsMarkSeen: boolean;
};

const openModals = new Set<OpenModal>();

let autoCleanupEnabled = true;

export function setModalAutoCleanup(enabled: boolean): void {
    autoCleanupEnabled = enabled;
}

export const MODAL_REAP_DELAY_MS = 80;

const SIDE_MENU_QUICK_ACCESS = 2;

let qamReopenDelayMs = 300;

export function setQamReturnDelay(ms: number): void {
    qamReopenDelayMs = ms;
}

const QAM_SETTLE_MS = 500;

let qamReopenOwed = false;

let qamReopenTimer = 0;

export function cancelQuickAccessReturn(): void {
    window.clearTimeout(qamReopenTimer);
    qamReopenTimer = 0;
    qamReopenOwed = false;
    showHeldToasts(0);
}

function takeOverQuickAccessReopen(skipReturn: boolean): boolean {
    if (mountedModals + pendingModals > 1) {
        return false;
    }
    const menus = SteamUIStore?.WindowStore?.GamepadUIMainWindowInstance?.MenuStore;
    const owed = qamReopenOwed;
    qamReopenOwed = false;
    try {
        if (!owed && menus?.GetLastRequestedSideMenu?.() !== SIDE_MENU_QUICK_ACCESS) {
            return false;
        }
        if (qamReopenDelayMs <= 0) {
            traceModalClose(0);
            return false;
        }
        traceModalClose(skipReturn ? null : qamReopenDelayMs);
        if (skipReturn) {
            menus.ClearLastRequestedSideMenu();
            logFocusDebug("modal-close", "QAM return skipped", "browser");
            return false;
        }
        menus.ClearLastRequestedSideMenu();
        logFocusDebug("modal-close", "QAM held back", `reopen in ${qamReopenDelayMs}ms`);
        return true;
    }
    catch (e) {
        logError("modalRegistry: couldn't hold the QAM back", e);
        return false;
    }
}

function reopenQuickAccessSoon(): void {
    window.clearTimeout(qamReopenTimer);
    qamReopenTimer = window.setTimeout(() => {
        qamReopenTimer = 0;
        if (SteamUIStore?.WindowStore?.GamepadUIMainWindowInstance?.MenuStore?.GetOpenSideMenu?.() === SIDE_MENU_QUICK_ACCESS) {
            noteQuickAccessReturned();
            return;
        }
        if (mountedModals + pendingModals > 0) {
            qamReopenOwed = true;
            logFocusDebug("modal-close", "QAM reopen held", "another modal is open");
            showHeldToasts(0);
            return;
        }
        try {
            markCloseTrace("reopen");
            focusOurPlugin();
            Navigation.OpenQuickAccessMenu(QuickAccessTab.Decky);
            markCloseTrace("reopen called");
            noteQuickAccessReturned();
        }
        catch (e) {
            logError("modalRegistry: couldn't open the QAM again", e);
            showHeldToasts(0);
        }
    }, qamReopenDelayMs);
}

type ToastData = Parameters<typeof toaster.toast>[0];

const DECKY_TOAST_MS = 5000;

let heldToasts: ToastData[] = [];

let shownToast: { toast: ToastData; until: number; dismiss: () => void } | null = null;

let qamReturnedAt = 0;

function showToast(toast: ToastData): void {
    const shown = toaster.toast({ ...toast });
    const menus = SteamUIStore?.WindowStore?.GamepadUIMainWindowInstance?.MenuStore;
    shownToast = menus?.GetOpenSideMenu?.() === SIDE_MENU_QUICK_ACCESS
        ? null
        : { toast, until: Date.now() + (toast.duration ?? DECKY_TOAST_MS), dismiss: shown.dismiss };
}

function showHeldToasts(delayMs: number): void {
    const due = heldToasts;
    heldToasts = [];
    if (due.length === 0) {
        return;
    }
    window.setTimeout(() => {
        for (const toast of due) {
            toastAfterQuickAccessReturn(toast);
        }
    }, delayMs);
}

function noteQuickAccessReturned(): void {
    qamReturnedAt = Date.now();
    if (shownToast && shownToast.until > qamReturnedAt) {
        shownToast.dismiss();
        heldToasts.unshift(shownToast.toast);
        logFocusDebug("modal-close", "toast raised again", "it was on screen as the QAM came back");
    }
    shownToast = null;
    showHeldToasts(QAM_SETTLE_MS);
}

export function toastAfterQuickAccessReturn(toast: ToastData): void {
    if (qamReopenTimer !== 0) {
        heldToasts.push(toast);
        logFocusDebug("modal-close", "toast held", "until the QAM is back");
        return;
    }
    const settling = qamReturnedAt + QAM_SETTLE_MS - Date.now();
    if (settling > 0) {
        window.setTimeout(() => toastAfterQuickAccessReturn(toast), settling);
        return;
    }
    showToast(toast);
}

let lastModalCloseAt = 0;

let modalClosePending = false;

const MODAL_ARM_MAX_AGE_MS = 3000;

export const MODAL_ECHO_WINDOW_MS = 300;

function noteModalClosed(): void {
    lastModalCloseAt = Date.now();
    modalClosePending = true;
}

export function modalEchoPending(): boolean {
    return Date.now() - lastModalCloseAt < MODAL_ECHO_WINDOW_MS;
}

export function consumeModalCloseArm(): boolean {
    if (!modalClosePending) {
        return false;
    }
    modalClosePending = false;
    return Date.now() - lastModalCloseAt < MODAL_ARM_MAX_AGE_MS;
}

function registerModal(close: () => void, needsMarkSeen: boolean): OpenModal {
    const entry: OpenModal = { close, needsMarkSeen };
    openModals.add(entry);
    return entry;
}

function unregisterModal(entry: OpenModal): void {
    openModals.delete(entry);
}

let mountedModals = 0;

let pendingModals = 0;

type ClosableElement = ReactElement<{ closeModal?: () => void }>;

function ModalPresence(props: { children: ClosableElement; closeModal?: () => void }) {
    useEffect(() => {
        pendingModals = Math.max(0, pendingModals - 1);
        mountedModals += 1;
        return () => {
            mountedModals -= 1;
        };
    }, []);
    if (props.closeModal) {
        return cloneElement(props.children, { closeModal: props.closeModal });
    }
    return props.children;
}

export function cheevoModalOpen(): boolean {
    return mountedModals > 0 || pendingModals > 0;
}

export function cheevoModalCount(): number {
    return mountedModals + pendingModals;
}

function showCountedModal(element: ReactElement): { Close: () => void } {
    pendingModals += 1;
    try {
        return showModal(createElement(ModalPresence, null, element), window);
    }
    catch (e) {
        pendingModals -= 1;
        throw e;
    }
}

export function drainOpenModals(): OpenModal[] {
    if (qamReopenTimer !== 0 || shownToast) {
        noteQuickAccessReturned();
    }
    qamReopenOwed = false;
    window.clearTimeout(qamReopenTimer);
    qamReopenTimer = 0;
    const entries = Array.from(openModals);
    openModals.clear();
    return entries;
}

export function showManagedModal(
    render: (close: () => void) => ReactElement,
    opts?: { needsMarkSeen?: boolean; onClose?: () => void; skipQamReturn?: boolean }
): { Close: () => void } {
    let closeModal = function () { };

    if (!autoCleanupEnabled) {
        const close = () => {
            noteModalClosed();
            if (opts?.onClose) {
                opts.onClose();
            }
            const handOff = takeOverQuickAccessReopen(opts?.skipQamReturn ?? false);
            closeModal();
            if (handOff) {
                reopenQuickAccessSoon();
            }
        };
        const modal = showCountedModal(render(close));
        closeModal = modal.Close;
        return modal;
    }

    let entry: OpenModal | null = null;

    const close = () => {
        noteModalClosed();
        if (opts?.onClose) {
            opts.onClose();
        }
        const handOff = takeOverQuickAccessReopen(opts?.skipQamReturn ?? false);
        closeModal();
        if (entry) {
            unregisterModal(entry);
        }
        if (handOff) {
            reopenQuickAccessSoon();
        }
    };

    const modal = showCountedModal(render(close));
    closeModal = modal.Close;
    entry = registerModal(modal.Close, opts?.needsMarkSeen ?? false);
    return modal;
}
