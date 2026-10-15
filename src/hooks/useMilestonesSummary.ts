import { useEffect, useState } from "react";
import { addEventListener, removeEventListener } from "@decky/api";
import { getMilestonesState } from "../api";
import type { MilestonesState } from "../types";
import { logError } from "../utils/errors";
import { lastMilestonesState, MILESTONES_EVENT, noteMilestonesState } from "../utils/milestoneEvents";

export function useMilestonesSummary(): MilestonesState | null {
    const [summary, setSummary] = useState<MilestonesState | null>(lastMilestonesState);

    useEffect(() => {
        let alive = true;
        const read = () => {
            getMilestonesState()
                .then((result) => {
                    noteMilestonesState(result);
                    if (alive && result.ok) {
                        setSummary(result);
                    }
                })
                .catch((e) => logError("milestones: reading the summary", e));
        };
        read();
        addEventListener(MILESTONES_EVENT, read);
        return () => {
            alive = false;
            removeEventListener(MILESTONES_EVENT, read);
        };
    }, []);

    return summary;
}
