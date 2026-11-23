import { useEffect, useRef } from "react";

import { multiplayerLeave } from "../../api";
import { logError } from "../../utils/errors";

type JoinAttempt = { canceled: boolean };

export function useJoinAttempt() {
    const current = useRef<JoinAttempt | null>(null);

    useEffect(() => () => {
        if (current.current) {
            current.current.canceled = true;
        }
    }, []);

    return {
        start(): JoinAttempt | null {
            if (current.current) {
                return null;
            }
            const attempt = { canceled: false };
            current.current = attempt;
            return attempt;
        },
        cancel() {
            if (current.current) {
                current.current.canceled = true;
                current.current = null;
            }
        },
        settle(attempt: JoinAttempt, joined: { ok: boolean }): boolean {
            if (!attempt.canceled) {
                current.current = null;
                return false;
            }
            if (joined.ok) {
                multiplayerLeave().catch((e) => logError("multiplayerLeave (canceled join)", e));
            }
            return true;
        }
    };
}
