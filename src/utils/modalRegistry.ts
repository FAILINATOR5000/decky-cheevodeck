import { showModal } from "@decky/ui";
import type { ReactElement } from "react";

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
            closeModal();
        };
        const modal = showModal(render(close), window);
        closeModal = modal.Close;
        return modal;
    }

    let entry: OpenModal | null = null;

    const close = () => {
        noteModalClosed();
        if (opts?.onClose) {
            opts.onClose();
        }
        closeModal();
        if (entry) {
            unregisterModal(entry);
        }
    };

    const modal = showModal(render(close), window);
    closeModal = modal.Close;
    entry = registerModal(modal.Close, opts?.needsMarkSeen ?? false);
    return modal;
}
