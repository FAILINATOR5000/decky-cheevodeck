import { useCallback, useEffect, useRef, useState } from "react";

import {
    addSmbShare,
    deleteSmbShare,
    listSmbShares,
    setSmbShareEnabled,
    updateSmbShare
} from "../api";
import type { SmbShare, SmbSharePayload } from "../types";
import { logError } from "../utils/errors";

type UseSmbSharesControllerArgs = {
    isActive: boolean;
};

const STATUS_POLL_MS = 5000;

export type SmbRowError = {
    id: string;
    code: string;
    blockedBy?: string[];
};

export function useSmbSharesController({ isActive }: UseSmbSharesControllerArgs) {
    const [shares, setShares] = useState<SmbShare[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [pendingId, setPendingId] = useState<string | null>(null);
    const [rowError, setRowError] = useState<SmbRowError | null>(null);

    const busyRef = useRef(false);
    const loadingRef = useRef(false);

    const clearRowError = useCallback(() => {
        setRowError(null);
    }, []);

    const showRowError = useCallback((error: SmbRowError) => {
        setRowError(error);
    }, []);

    const reload = useCallback(async (probe: boolean, rehydrate = true) => {
        loadingRef.current = true;
        try {
            const result = await listSmbShares(probe, rehydrate);
            setShares(result?.shares ?? []);
            setLoaded(true);
        }
        catch (e) {
            logError("listSmbShares", e);
            setLoaded(true);
        }
        finally {
            loadingRef.current = false;
        }
    }, []);

    useEffect(() => {
        if (!isActive || loaded) {
            return;
        }
        void reload(true);
    }, [isActive, loaded, reload]);

    useEffect(() => {
        if (!isActive || !loaded) {
            return;
        }
        const timer = window.setInterval(() => {
            if (document.visibilityState !== "visible") {
                return;
            }
            if (busyRef.current || loadingRef.current) {
                return;
            }
            void reload(true, false);
        }, STATUS_POLL_MS);
        return () => window.clearInterval(timer);
    }, [isActive, loaded, reload]);

    const toggleEnabled = useCallback(async (share: SmbShare, next: boolean) => {
        clearRowError();
        busyRef.current = true;
        setPendingId(share.id);
        try {
            const result = await setSmbShareEnabled(share.id, next);
            if (!result?.ok) {
                showRowError({ id: share.id, code: result?.error ?? "generic" });
            }
        }
        catch (e) {
            logError("setSmbShareEnabled", e);
            showRowError({ id: share.id, code: "generic" });
        }
        finally {
            busyRef.current = false;
            setPendingId(null);
        }
        await reload(true);
    }, [clearRowError, reload, showRowError]);

    const removeShare = useCallback(async (share: SmbShare, force: boolean) => {
        clearRowError();
        busyRef.current = true;
        setPendingId(share.id);
        let ok = false;
        try {
            const result = await deleteSmbShare(share.id, force);
            ok = Boolean(result?.ok);
            if (!ok) {
                showRowError({
                    id: share.id,
                    code: result?.error ?? "generic",
                    blockedBy: result?.blockedBy
                });
            }
        }
        catch (e) {
            logError("deleteSmbShare", e);
            showRowError({ id: share.id, code: "generic" });
        }
        finally {
            busyRef.current = false;
            setPendingId(null);
        }
        await reload(false);
        return ok;
    }, [clearRowError, reload, showRowError]);

    const createShare = useCallback(async (payload: SmbSharePayload) => {
        busyRef.current = true;
        try {
            const result = await addSmbShare(payload);
            if (result?.ok) {
                await reload(false);
            }
            return result;
        }
        catch (e) {
            logError("addSmbShare", e);
            return { ok: false, error: "generic" };
        }
        finally {
            busyRef.current = false;
        }
    }, [reload]);

    const editShare = useCallback(async (id: string, payload: SmbSharePayload) => {
        busyRef.current = true;
        try {
            const result = await updateSmbShare(id, payload);
            if (result?.ok) {
                await reload(false);
            }
            return result;
        }
        catch (e) {
            logError("updateSmbShare", e);
            return { ok: false, error: "generic" };
        }
        finally {
            busyRef.current = false;
        }
    }, [reload]);

    return {
        shares,
        loaded,
        pendingId,
        rowError,
        clearRowError,
        reload,
        toggleEnabled,
        removeShare,
        createShare,
        editShare
    };
}
