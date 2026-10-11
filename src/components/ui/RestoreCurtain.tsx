import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { PRESS_GUARD_CEILING_MS, REVEAL_DEADLINE_MS, REVEAL_FADE_MS, REVEAL_GRACE_MS } from "../../utils/landingTiming";

export const CurtainHidingContext = createContext(false);

export function useCurtainHiding(): boolean {
    return useContext(CurtainHidingContext);
}

type RestoreCurtainProps = {
    armed: boolean;
    settled: boolean;
    covered?: boolean;
    children: ReactNode;
};

export function RestoreCurtain(props: RestoreCurtainProps) {
    const { settled, children } = props;

    const armedRef = useRef(props.armed);
    const [revealed, setRevealed] = useState(!armedRef.current);

    const stayDown = Boolean(props.covered);

    useEffect(function revealOnSettle() {
        if (revealed || stayDown || !settled) {
            return;
        }
        const timer = window.setTimeout(() => setRevealed(true), REVEAL_GRACE_MS);
        return () => window.clearTimeout(timer);
    }, [revealed, stayDown, settled]);

    const wasCoveredRef = useRef(stayDown);
    useEffect(function revealWhenCoverLifts() {
        const wasCovered = wasCoveredRef.current;
        wasCoveredRef.current = stayDown;
        if (revealed || stayDown || !wasCovered || !settled) {
            return;
        }
        setRevealed(true);
    }, [revealed, stayDown, settled]);

    useEffect(function revealOnDeadline() {
        if (revealed || stayDown) {
            return;
        }
        const timer = window.setTimeout(() => setRevealed(true), REVEAL_DEADLINE_MS);
        return () => window.clearTimeout(timer);
    }, [revealed, stayDown]);

    const [guardExpired, setGuardExpired] = useState(!armedRef.current);
    useEffect(function releasePressGuard() {
        if (guardExpired) {
            return;
        }
        const timer = window.setTimeout(() => setGuardExpired(true), PRESS_GUARD_CEILING_MS);
        return () => window.clearTimeout(timer);
    }, [guardExpired]);

    if (!armedRef.current) {
        return <>{children}</>;
    }

    return (
        <CurtainHidingContext.Provider value={!revealed && !guardExpired}>
            <div
                style={{
                    opacity: revealed ? 1 : 0,
                    transition: `opacity ${REVEAL_FADE_MS}ms ease-out`
                }}
            >
                {children}
            </div>
        </CurtainHidingContext.Provider>
    );
}
