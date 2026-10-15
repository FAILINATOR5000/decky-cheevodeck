import { useEffect, useRef, useState } from "react";
import { addEventListener, removeEventListener } from "@decky/api";
import { getActivityMonth, getMilestonesState } from "../api";
import type { ActivityMonth, ActivitySubject } from "../types";
import { cachedActivityMonth, cachedCurrentActivityMonth, dropCurrentActivityMonth, keepActivityMonth } from "../utils/activityCache";
import { logError } from "../utils/errors";
import { MILESTONES_EVENT } from "../utils/milestoneEvents";

const MONTH_SETTLE_MS = 500;

export function useActivityController({ isActive, subject, month }: { isActive: boolean; subject: ActivitySubject; month: string | null }) {
    const [data, setData] = useState<ActivityMonth | null>(() =>
        month === null ? cachedCurrentActivityMonth(subject.ulid) : cachedActivityMonth(subject.ulid, month, subject.own)
    );
    const [loading, setLoading] = useState(false);
    const [pendingMonth, setPendingMonth] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [needsSettings, setNeedsSettings] = useState(false);
    const [comboLength, setComboLength] = useState<number | null>(null);
    const requestRef = useRef(0);
    const mountedRef = useRef(true);
    const dataRef = useRef(data);
    dataRef.current = data;

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    async function load(target: string | null, force: boolean) {
        if (!force) {
            const hit = target === null
                ? cachedCurrentActivityMonth(subject.ulid)
                : cachedActivityMonth(subject.ulid, target, subject.own);
            if (hit) {
                requestRef.current += 1;
                setLoading(false);
                setPendingMonth(null);
                setData(hit);
                setError(null);
                return;
            }
        }
        const request = requestRef.current + 1;
        requestRef.current = request;
        setLoading(true);
        try {
            const result = await getActivityMonth(subject.ulid, target ?? "", force);
            if (result.ok) {
                keepActivityMonth(result, subject.own);
            }
            if (!mountedRef.current || request !== requestRef.current) {
                return;
            }
            if (!result.ok) {
                setNeedsSettings(Boolean(result.needsSettings));
                setError(result.error ?? null);
                return;
            }
            setData(result);
            setError(null);
            setNeedsSettings(false);
        }
        catch (e) {
            logError("activity: loading " + (target ?? "the current month"), e);
            if (mountedRef.current && request === requestRef.current) {
                setError("Couldn't load this month's activity.");
            }
        }
        finally {
            if (mountedRef.current && request === requestRef.current) {
                setLoading(false);
                setPendingMonth(null);
            }
        }
    }

    useEffect(() => {
        if (!isActive) {
            return;
        }
        const hit = month === null
            ? cachedCurrentActivityMonth(subject.ulid)
            : cachedActivityMonth(subject.ulid, month, subject.own);
        const shown = dataRef.current;
        if (hit || shown === null || month === null) {
            void load(month, false);
            return;
        }
        const request = requestRef.current + 1;
        requestRef.current = request;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const settle = () => {
            if (!mountedRef.current || request !== requestRef.current) {
                return;
            }
            setPendingMonth(month);
            setLoading(true);
            timer = setTimeout(() => void load(month, false), MONTH_SETTLE_MS);
        };
        if (subject.own && month < shown.currentMonth) {
            getActivityMonth(subject.ulid, month, false, true)
                .then((result) => {
                    if (!mountedRef.current || request !== requestRef.current) {
                        return;
                    }
                    if (!result.ok) {
                        settle();
                        return;
                    }
                    keepActivityMonth(result, subject.own);
                    setData(result);
                    setError(null);
                    setLoading(false);
                    setPendingMonth(null);
                })
                .catch((e) => {
                    logError("activity: reading a saved month", e);
                    settle();
                });
        }
        else {
            settle();
        }
        return () => {
            if (timer !== null) {
                clearTimeout(timer);
            }
        };
    }, [isActive, subject.ulid, month]);

    useEffect(() => {
        if (!isActive || !subject.own) {
            return;
        }
        const onChanged = (event?: { ra?: boolean }) => {
            if (!event?.ra) {
                return;
            }
            dropCurrentActivityMonth(subject.ulid);
            const shown = dataRef.current;
            if (shown !== null && shown.month === shown.currentMonth) {
                void load(shown.month, false);
            }
        };
        addEventListener(MILESTONES_EVENT, onChanged);
        return () => {
            removeEventListener(MILESTONES_EVENT, onChanged);
        };
    }, [isActive, subject.own, subject.ulid]);

    useEffect(() => {
        if (!isActive || !subject.own) {
            return;
        }
        getMilestonesState()
            .then((result) => {
                if (mountedRef.current && result.ok) {
                    setComboLength(result.combo.length);
                }
            })
            .catch((e) => logError("activity: reading the Combo", e));
    }, [isActive, subject.own]);

    return {
        data,
        loading,
        pendingMonth,
        error,
        needsSettings,
        comboLength,
        refresh: () => load(data?.month ?? month, true)
    };
}
