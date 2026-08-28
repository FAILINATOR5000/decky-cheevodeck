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


type UseDolphinMapperControllerArgs = {
    isActive: boolean;
    language: LanguageCode;
};

export function useDolphinMapperController({ isActive, language }: UseDolphinMapperControllerArgs) {
    const [mappings, setMappings] = useState<DolphinMapping[]>([]);
    const [collapsedTags, setCollapsedTags] = useState<string[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [loading, setLoading] = useState(false);
    const [reorderTargetId, setReorderTargetId] = useState<string | null>(null);
    const [reorderViaSwap, setReorderViaSwap] = useState(false);
    const [deckControllerStatus, setDeckControllerStatus] = useState<DeckControllerStatus | null>(null);

    const reorderInFlightRef = useRef(false);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const result = await loadDolphinMappings();
            setMappings(result?.mappings ?? []);
            setCollapsedTags(result?.collapsedTags ?? []);
            setLoaded(true);
        }
        catch (e) {
            logError("loadDolphinMappings", e);
        }
        finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!isActive) {
            return;
        }
        setReorderTargetId(null);
        setReorderViaSwap(false);
        void reload();
    }, [isActive, reload]);

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

    const persistOrder = useCallback((ordered: DolphinMapping[]) => {
        void reorderDolphinMappings(ordered.map((m) => m.id)).catch((e) => {
            logError("reorderDolphinMappings", e);
        });
    }, []);

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
            if (reorderInFlightRef.current) {
                return;
            }

            setMappings((prev) => {
                const fromIndex = prev.findIndex((m) => m.id === reorderTargetId);
                const toIndex = prev.findIndex((m) => m.id === pressedId);
                if (fromIndex < 0 || toIndex < 0) {
                    return prev;
                }
                const next = prev.slice();
                const held = next[fromIndex];
                next[fromIndex] = next[toIndex];
                next[toIndex] = held;
                reorderInFlightRef.current = true;
                persistOrder(next);
                reorderInFlightRef.current = false;
                return next;
            });
            setReorderViaSwap(true);
        },
        [reorderTargetId, persistOrder]
    );

    const onReorderMove = (direction: ReorderDirection, groupIds?: string[] | null) => {
        setMappings((prev) => {
            if (reorderTargetId === null) {
                return prev;
            }
            const working = groupIds && groupIds.length > 0 ? groupIds.slice() : prev.map((m) => m.id);
            const i = working.indexOf(reorderTargetId);
            if (i < 0) {
                return prev;
            }
            let j = i;
            if (direction === "up") {
                j = Math.max(0, i - 1);
            }
            else if (direction === "down") {
                j = Math.min(working.length - 1, i + 1);
            }
            else if (direction === "top") {
                j = 0;
            }
            else if (direction === "bottom") {
                j = working.length - 1;
            }
            if (j === i) {
                return prev;
            }
            const rearranged = working.slice();
            const [movedId] = rearranged.splice(i, 1);
            rearranged.splice(j, 0, movedId);

            const byId = new Map(prev.map((m) => [m.id, m]));
            let next: DolphinMapping[];
            if (groupIds && groupIds.length > 0) {
                const membership = new Set(groupIds);
                const rearrangedIter = rearranged[Symbol.iterator]();
                next = prev.map((mapping) => {
                    if (!membership.has(mapping.id)) {
                        return mapping;
                    }
                    const fromGroup = rearrangedIter.next();
                    return fromGroup.done ? mapping : (byId.get(fromGroup.value) ?? mapping);
                });
            }
            else {
                next = rearranged.map((id) => byId.get(id)).filter((m): m is DolphinMapping => m !== undefined);
            }
            persistOrder(next);
            return next;
        });
        setReorderViaSwap(false);
    };

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
        loading,
        reorderTargetId,
        reorderViaSwap,
        reload,
        saveMapping,
        deleteMapping,
        applyMapping,
        onReorderSwap,
        onReorderMove,
        setReorderTargetId,
        resetReorder,
        deckControllerStatus,
        setDeckDisabled
    };
}
