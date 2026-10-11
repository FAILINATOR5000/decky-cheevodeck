import { type ReactNode, useEffect, useLayoutEffect, useState } from "react";
import { logFocusDebug } from "../../api";
import { useCovered } from "../../covers";
import { curtainEntryAtMount, curtainState, curtainTiming, markCurtainRevealed, useLandingVersion } from "../../focusRecords";
import { CurtainHidingContext } from "./RestoreCurtain";

export function LandingCurtain(props: { children: ReactNode }) {
    const [mount] = useState(curtainEntryAtMount);
    const [armedLate, setArmedLate] = useState(false);
    useLandingVersion();
    const covered = useCovered();
    const armed = mount.armed || armedLate;
    const [revealed, setRevealed] = useState(!mount.armed);
    const [guardExpired, setGuardExpired] = useState(!mount.armed);
    const state = curtainState(mount.entryId);
    const timing = curtainTiming();

    useLayoutEffect(function armForOwnLanding() {
        if (mount.armed) {
            logFocusDebug("curtain", "armed", `${mount.entryId}`);
            return;
        }
        if (curtainState(mount.entryId).own) {
            logFocusDebug("curtain", "armed", `${mount.entryId} own landing`);
            setArmedLate(true);
            setRevealed(false);
            setGuardExpired(false);
        }
    }, []);

    useEffect(function revealOnSettle() {
        if (!armed || revealed || covered || !state.settled) {
            return;
        }
        const timer = window.setTimeout(() => {
            logFocusDebug("curtain", "reveal", `${mount.entryId} settled`);
            setRevealed(true);
        }, timing.revealGraceMs);
        return () => window.clearTimeout(timer);
    }, [armed, revealed, covered, state.settled]);

    useEffect(function revealOnCancel() {
        if (!armed || revealed || !state.canceled) {
            return;
        }
        logFocusDebug("curtain", "reveal", `${mount.entryId} canceled covered=${covered}`);
        setRevealed(true);
    }, [armed, revealed, state.canceled]);

    useEffect(function revealOnDeadline() {
        if (!armed || revealed || covered) {
            return;
        }
        const timer = window.setTimeout(() => {
            logFocusDebug("curtain", "reveal", `${mount.entryId} deadline`);
            markCurtainRevealed(mount.entryId);
            setRevealed(true);
        }, timing.revealDeadlineMs);
        return () => window.clearTimeout(timer);
    }, [armed, revealed, covered]);

    useEffect(function releasePressGuard() {
        if (guardExpired) {
            return;
        }
        const timer = window.setTimeout(() => setGuardExpired(true), timing.pressGuardCeilingMs);
        return () => window.clearTimeout(timer);
    }, [guardExpired]);

    return (
        <CurtainHidingContext.Provider value={armed && !revealed && !guardExpired}>
            <div
                style={armed ? {
                    opacity: revealed ? 1 : 0,
                    transition: `opacity ${timing.revealFadeMs}ms ease-out`
                } : undefined}
            >
                {props.children}
            </div>
        </CurtainHidingContext.Provider>
    );
}
