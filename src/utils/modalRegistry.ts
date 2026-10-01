import { Navigation, QuickAccessTab, showModal } from "@decky/ui";
import { cloneElement, createElement, useEffect, type ReactElement } from "react";
import { logFocusDebug } from "../api";
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

function takeOverQuickAccessReopen(): boolean {
    if (qamReopenDelayMs <= 0 || mountedModals + pendingModals > 1) {
        return false;
    }
    const menus = SteamUIStore?.WindowStore?.GamepadUIMainWindowInstance?.MenuStore;
    try {
        if (menus?.GetLastRequestedSideMenu?.() !== SIDE_MENU_QUICK_ACCESS) {
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
    window.setTimeout(() => {
        try {
            focusOurPlugin();
            Navigation.OpenQuickAccessMenu(QuickAccessTab.Decky);
        }
        catch (e) {
            logError("modalRegistry: couldn't open the QAM again", e);
        }
    }, qamReopenDelayMs);
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
    const entries = Array.from(openModals);
    openModals.clear();
    return entries;
}

export function showManagedModal(
    render: (close: () => void) => ReactElement,
    opts?: { needsMarkSeen?: boolean; onClose?: () => void }
): { Close: () => void } {
    let closeModal = function () { };

    if (!autoCleanupEnabled) {
        const close = () => {
            noteModalClosed();
            if (opts?.onClose) {
                opts.onClose();
            }
            const handOff = takeOverQuickAccessReopen();
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
        const handOff = takeOverQuickAccessReopen();
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
