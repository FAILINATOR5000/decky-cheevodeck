import { useCallback, useEffect, useRef, useState } from "react";
import { toaster } from "@decky/api";

import {
    applyDolphinMapping,
    deleteDolphinMapping,
    getDeckControllerStatus,
    loadDolphinMappings,
    reorderDolphinMappings,
    saveDolphinCollapsedTags,
    saveDolphinMapping,
    setDeckControllerDisabled
} from "../api";
import { t } from "../locales";
import type { LanguageCode } from "../locales";
import type {
    DeckControllerStatus,
    DolphinMapping,
    DolphinMappingInput,
    DolphinMappingResponse,
    ReorderDirection
} from "../types";
import { logError } from "../utils/errors";
import { landOn, liveOrder, orderAfterGroupMove, stepTo } from "../utils/reorderOrder";


const ORDER_WRITE_SETTLE_MS = 250;


type UseDolphinMapperControllerArgs = {
    isActive: boolean;
    language: LanguageCode;
};

export function useDolphinMapperController({ isActive, language }: UseDolphinMapperControllerArgs) {
    const [mappings, setMappings] = useState<DolphinMapping[]>([]);
    const [collapsedTags, setCollapsedTags] = useState<string[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [reorderTargetId, setReorderTargetId] = useState<string | null>(null);
    const [reorderViaSwap, setReorderViaSwap] = useState(false);
    const [deckControllerStatus, setDeckControllerStatus] = useState<DeckControllerStatus | null>(null);

    const pendingOrderRef = useRef<string[] | null>(null);
    const orderWriteTimerRef = useRef(0);

    const flushOrderWrite = useCallback(async () => {
        if (orderWriteTimerRef.current !== 0) {
            window.clearTimeout(orderWriteTimerRef.current);
            orderWriteTimerRef.current = 0;
        }
        const ids = pendingOrderRef.current;
        if (ids === null) {
            return;
        }
        pendingOrderRef.current = null;
        try {
            await reorderDolphinMappings(ids);
        }
        catch (e) {
            logError("reorderDolphinMappings", e);
        }
    }, []);

    const reload = useCallback(async () => {
        await flushOrderWrite();
        setLoading(true);
        setLoadFailed(false);
        try {
            const result = await loadDolphinMappings();
            setMappings(result?.mappings ?? []);
            setCollapsedTags(result?.collapsedTags ?? []);
            setLoaded(true);
        }
        catch (e) {
            logError("loadDolphinMappings", e);
            setLoadFailed(true);
        }
        finally {
            setLoading(false);
        }
    }, [flushOrderWrite]);

    useEffect(() => {
        if (!isActive) {
            return;
        }
        setReorderTargetId(null);
        setReorderViaSwap(false);
        void reload();
    }, [isActive, reload]);

    useEffect(function writeAnyUnsettledOrderOnTheWayOut() {
        return () => {
            if (orderWriteTimerRef.current === 0) {
                return;
            }
            window.clearTimeout(orderWriteTimerRef.current);
            orderWriteTimerRef.current = 0;
            const ids = pendingOrderRef.current;
            if (ids === null) {
                return;
            }
            pendingOrderRef.current = null;
            void reorderDolphinMappings(ids).catch((e) => {
                logError("reorderDolphinMappings (on the way out)", e);
            });
        };
    }, []);

    const refreshDeckControllerStatus = useCallback(async () => {
        try {
            const status = await getDeckControllerStatus();
            setDeckControllerStatus(status ?? null);
        }
        catch (e) {
            logError("getDeckControllerStatus", e);
        }
    }, []);

    useEffect(() => {
        if (!isActive) {
            return;
        }
        void refreshDeckControllerStatus();
    }, [isActive, refreshDeckControllerStatus]);

    const setDeckDisabled = async (disabled: boolean) => {
        try {
            const result = await setDeckControllerDisabled(disabled);
            if (result?.status) {
                setDeckControllerStatus(result.status);
            }
            if (!result?.ok) {
                toaster.toast({
                    title: t(language, "Dolphin Mapper"),
                    body: result?.detail || t(language, "Couldn't change the controller.")
                });
            }
            return result;
        }
        catch (e) {
            logError("setDeckControllerDisabled", e);
            return null;
        }
    };

    const saveMapping = async (input: DolphinMappingInput): Promise<DolphinMappingResponse> => {
        try {
            const result = await saveDolphinMapping(input);
            if (result?.ok) {
                await reload();
            }
            return result;
        }
        catch (e) {
            logError("saveDolphinMapping", e);
            return { ok: false, error: "save_failed" };
        }
    };

    const deleteMapping = async (mappingId: string) => {
        try {
            const result = await deleteDolphinMapping(mappingId);
            if (result?.ok) {
                setReorderTargetId((prev) => (prev === mappingId ? null : prev));
                await reload();
            }
            return result;
        }
        catch (e) {
            logError("deleteDolphinMapping", e);
            return { ok: false, error: "delete_failed" };
        }
    };

    const applyMapping = useCallback(
        async (mappingId: string) => {
            try {
                const result = await applyDolphinMapping(mappingId);
                if (result?.ok) {
                    toaster.toast({
                        title: t(language, "Dolphin Mapper"),
                        body: t(language, "Mapping applied to Dolphin")
                    });
                }
                else if (result?.error !== "dolphin_running") {
                    toaster.toast({
                        title: t(language, "Dolphin Mapper"),
                        body: t(language, "Couldn't apply the mapping.")
                    });
                }
                return result;
            }
            catch (e) {
                logError("applyDolphinMapping", e);
                toaster.toast({
                    title: t(language, "Dolphin Mapper"),
                    body: t(language, "Couldn't apply the mapping.")
                });
                return { ok: false, error: "apply_failed" };
            }
        },
        [language]
    );

    const currentOrder = useCallback(
        () => liveOrder(pendingOrderRef.current, mappings.map((m) => m.id)),
        [mappings]
    );

    const applyOrder = useCallback((orderedIds: string[]) => {
        pendingOrderRef.current = orderedIds.slice();
        setMappings((prev) => {
            const byId = new Map(prev.map((m) => [m.id, m]));
            const next: DolphinMapping[] = [];
            for (const id of orderedIds) {
                const mapping = byId.get(id);
                if (mapping) {
                    byId.delete(id);
                    next.push(mapping);
                }
            }
            for (const mapping of prev) {
                if (byId.has(mapping.id)) {
                    next.push(mapping);
                }
            }
            return next;
        });
        if (orderWriteTimerRef.current !== 0) {
            window.clearTimeout(orderWriteTimerRef.current);
        }
        orderWriteTimerRef.current = window.setTimeout(() => {
            orderWriteTimerRef.current = 0;
            void flushOrderWrite();
        }, ORDER_WRITE_SETTLE_MS);
    }, [flushOrderWrite]);

    const onReorderSwap = useCallback(
        (pressedId: string, allowSwap = true) => {
            if (reorderTargetId === null) {
                setReorderViaSwap(false);
                setReorderTargetId(pressedId);
                return;
            }
            if (pressedId === reorderTargetId) {
                setReorderViaSwap(false);
                setReorderTargetId(null);
                return;
            }
            if (!allowSwap) {
                setReorderViaSwap(false);
                setReorderTargetId(pressedId);
                return;
            }

            const order = currentOrder();
            const fromIndex = order.indexOf(reorderTargetId);
            const toIndex = order.indexOf(pressedId);
            if (fromIndex < 0 || toIndex < 0) {
                return;
            }
            const next = order.slice();
            next[fromIndex] = order[toIndex];
            next[toIndex] = order[fromIndex];
            applyOrder(next);
            setReorderViaSwap(true);
        },
        [reorderTargetId, currentOrder, applyOrder]
    );

    const onReorderMove = useCallback(
        (direction: ReorderDirection, groupIds?: string[] | null) => {
            if (reorderTargetId === null) {
                return;
            }
            const next = orderAfterGroupMove(
                currentOrder(),
                groupIds ?? null,
                reorderTargetId,
                stepTo(direction)
            );
            if (next === null) {
                return;
            }
            setReorderViaSwap(false);
            applyOrder(next);
        },
        [reorderTargetId, currentOrder, applyOrder]
    );

    const onReorderToward = useCallback(
        (landedId: string, groupIds?: string[] | null) => {
            if (reorderTargetId === null || landedId === reorderTargetId) {
                return;
            }
            const next = orderAfterGroupMove(
                currentOrder(),
                groupIds ?? null,
                reorderTargetId,
                landOn(landedId)
            );
            if (next === null) {
                return;
            }
            setReorderViaSwap(true);
            applyOrder(next);
        },
        [reorderTargetId, currentOrder, applyOrder]
    );

    const resetReorder = () => {
        setReorderTargetId(null);
        setReorderViaSwap(false);
    };

    const toggleCollapsedTag = useCallback((key: string) => {
        setCollapsedTags((prev) => {
            const next = prev.includes(key)
                ? prev.filter((entry) => entry !== key)
                : [...prev, key];
            void saveDolphinCollapsedTags(next).catch((e) => {
                logError("saveDolphinCollapsedTags", e);
            });
            return next;
        });
    }, []);

    return {
        mappings,
        collapsedTags,
        toggleCollapsedTag,
        loaded,
        loadFailed,
        loading,
        reorderTargetId,
        reorderViaSwap,
        reload,
        saveMapping,
        deleteMapping,
        applyMapping,
        onReorderSwap,
        onReorderMove,
        onReorderToward,
        setReorderTargetId,
        resetReorder,
        deckControllerStatus,
        setDeckDisabled
    };
}
