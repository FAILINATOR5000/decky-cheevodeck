import { useEffect, useState } from "react";
import { addEventListener, removeEventListener } from "@decky/api";
import { FREEZE_INCIDENT_EVENT, clearFreezeIncidents, getFreezeIncidents } from "../api";
import type { FreezeIncident, FreezeIncidentTotals } from "../types";
import { logError } from "../utils/errors";

const EMPTY_TOTALS: FreezeIncidentTotals = { prevented: 0, recovered: 0, manual: 0 };

export function useStormbreakerLogController(props: { isActive: boolean }) {
    const { isActive } = props;
    const [totals, setTotals] = useState<FreezeIncidentTotals>(EMPTY_TOTALS);
    const [entries, setEntries] = useState<FreezeIncident[]>([]);
    const [standingDown, setStandingDown] = useState(false);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!isActive) {
            return;
        }
        let alive = true;
        let latest = 0;
        async function load() {
            const ticket = ++latest;
            try {
                const result = await getFreezeIncidents();
                if (!alive || ticket !== latest) {
                    return;
                }
                setTotals(result?.totals ?? EMPTY_TOTALS);
                setEntries(Array.isArray(result?.entries) ? result.entries : []);
                setStandingDown(result?.standingDown === true);
                setLoaded(true);
            }
            catch (e) {
                logError("stormbreaker log: loading the incidents", e);
            }
        }
        function onIncident() {
            void load();
        }
        void load();
        addEventListener(FREEZE_INCIDENT_EVENT, onIncident);
        return () => {
            alive = false;
            removeEventListener(FREEZE_INCIDENT_EVENT, onIncident);
        };
    }, [isActive]);

    async function onClearLog() {
        try {
            const result = await clearFreezeIncidents();
            if (result?.ok) {
                setEntries([]);
            }
        }
        catch (e) {
            logError("stormbreaker log: clearing the log", e);
        }
    }

    return {
        state: { totals, entries, standingDown, loaded },
        actions: { onClearLog }
    };
}
