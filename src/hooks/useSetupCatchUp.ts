import { useEffect, useRef, useState } from "react";
import { setupStepsDue } from "../api";
import { useCurtainHiding } from "../components/ui/LandingCurtain";
import { useCovered } from "../covers";
import { rootGeneration, rootMountReason } from "../focusRecords";
import { logError } from "../utils/errors";
import { cheevoModalOpen } from "../utils/modalRegistry";
import type { MainUiPreset } from "../utils/options";
import { quickAccessWindow } from "../utils/quickAccess";
import { useLatestRef } from "./useLatestRef";

const SETUP_CATCH_UP_DELAY_MS = 1000;

const SETUP_CATCH_UP_RETRY_MS = 250;

let busySeenGeneration = 0;

let settled = false;

let asking = false;

type SetupCatchUpArgs = {
    onMain: boolean;
    loading: boolean;
    checkingGame: boolean;
    layout: MainUiPreset;
    open: (layout: MainUiPreset) => void;
};

export function useSetupCatchUp(args: SetupCatchUpArgs) {
    const { onMain, loading, checkingGame, layout, open } = args;
    const curtainHiding = useCurtainHiding();
    const covered = useCovered();
    const [fromModal] = useState(() => rootMountReason() === "modalReturn");
    const busy = loading || checkingGame;

    useEffect(() => {
        if (busy) {
            busySeenGeneration = rootGeneration();
        }
    }, [busy]);

    const clear = onMain && !busy && !curtainHiding && !covered && !fromModal;
    const clearRef = useLatestRef(clear);
    const openRef = useLatestRef(open);
    const layoutRef = useLatestRef(layout);
    const lastPressAtRef = useRef(0);

    useEffect(() => {
        const doc = quickAccessWindow()?.document;
        if (!doc) {
            return;
        }
        const onPress = () => {
            lastPressAtRef.current = Date.now();
        };
        doc.addEventListener("vgp_onbuttondown", onPress, true);
        return () => {
            doc.removeEventListener("vgp_onbuttondown", onPress, true);
        };
    }, []);

    useEffect(() => {
        if (!clear || settled || busySeenGeneration !== rootGeneration()) {
            return;
        }
        let canceled = false;
        let timer = 0;
        const attempt = () => {
            if (canceled || settled) {
                return;
            }
            const sincePress = Date.now() - lastPressAtRef.current;
            if (asking || sincePress < SETUP_CATCH_UP_DELAY_MS) {
                timer = window.setTimeout(attempt, asking ? SETUP_CATCH_UP_RETRY_MS : SETUP_CATCH_UP_DELAY_MS - sincePress);
                return;
            }
            if (cheevoModalOpen()) {
                return;
            }
            asking = true;
            setupStepsDue()
                .then((result) => {
                    if (!result?.due) {
                        settled = true;
                        return;
                    }
                    if (canceled || settled || !clearRef.current || cheevoModalOpen()) {
                        return;
                    }
                    if (Date.now() - lastPressAtRef.current < SETUP_CATCH_UP_DELAY_MS) {
                        timer = window.setTimeout(attempt, SETUP_CATCH_UP_RETRY_MS);
                        return;
                    }
                    settled = true;
                    openRef.current(layoutRef.current);
                })
                .catch((e) => logError("ask whether the setup catch-up is due", e))
                .finally(() => {
                    asking = false;
                });
        };
        timer = window.setTimeout(attempt, SETUP_CATCH_UP_DELAY_MS);
        return () => {
            canceled = true;
            window.clearTimeout(timer);
        };
    }, [clear]);
}
