import { useEffect, useRef, useState } from "react";
import { addEventListener, removeEventListener } from "@decky/api";
import {
    getMilestonesState,
    markMilestonesSeen,
    requestMilestonesCheck,
    rerollQuest,
    saveMilestonesCollapsed
} from "../api";
import type { MilestonesState, QuestPeriod } from "../types";
import { logError } from "../utils/errors";
import { MILESTONES_EVENT, noteMilestonesSeen, noteMilestonesState } from "../utils/milestoneEvents";

export type MilestonesLoadError = "definitions" | "account" | "unreadable" | "ipc";

export function useMilestonesController({ isActive }: { isActive: boolean }) {
    const [state, setState] = useState<MilestonesState | null>(null);
    const [error, setError] = useState<MilestonesLoadError | null>(null);
    const [visitNewIds, setVisitNewIds] = useState<string[]>([]);
    const [rerolling, setRerolling] = useState<QuestPeriod | null>(null);
    const mountedRef = useRef(true);
    const seenThisVisitRef = useRef(false);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    async function load() {
        try {
            const result = await getMilestonesState();
            noteMilestonesState(result);
            if (!mountedRef.current) {
                return;
            }
            if (!result.ok) {
                setError(result.error);
                return;
            }
            setError(null);
            setState(result);
            if (!seenThisVisitRef.current) {
                seenThisVisitRef.current = true;
                setVisitNewIds(result.newIds);
                if (result.newIds.length > 0) {
                    markMilestonesSeen()
                        .then((marked) => {
                            if (marked.ok) {
                                noteMilestonesSeen();
                            }
                        })
                        .catch((e) => logError("milestones: marking seen", e));
                }
            }
        }
        catch (e) {
            logError("milestones: loading the page", e);
            if (mountedRef.current) {
                setError("ipc");
            }
        }
    }

    useEffect(() => {
        if (!isActive) {
            seenThisVisitRef.current = false;
            return;
        }
        requestMilestonesCheck().catch((e) => logError("milestones: asking for a check", e));
        void load();
        const onChanged = () => {
            void load();
        };
        addEventListener(MILESTONES_EVENT, onChanged);
        return () => {
            removeEventListener(MILESTONES_EVENT, onChanged);
        };
    }, [isActive]);

    async function reroll(period: QuestPeriod) {
        if (rerolling !== null) {
            return;
        }
        setRerolling(period);
        try {
            const result = await rerollQuest(period);
            noteMilestonesState(result);
            if (mountedRef.current && result.ok) {
                setState(result);
            }
        }
        catch (e) {
            logError("milestones: rerolling the " + period + " quest", e);
        }
        finally {
            if (mountedRef.current) {
                setRerolling(null);
            }
        }
    }

    function toggleCategory(category: string) {
        if (!state) {
            return;
        }
        const collapsed = state.collapsed.includes(category)
            ? state.collapsed.filter((entry) => entry !== category)
            : [...state.collapsed, category];
        setState({ ...state, collapsed });
        saveMilestonesCollapsed(collapsed).catch((e) => logError("milestones: saving folded categories", e));
    }

    return {
        state: { milestones: state, error, visitNewIds, rerolling },
        actions: { reroll, toggleCategory, reload: load }
    };
}
