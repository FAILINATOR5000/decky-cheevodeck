import { type ReactNode, useEffect, useRef, useState } from "react";

const REVEAL_GRACE_MS = 60;

const REVEAL_FADE_MS = 240;

const REVEAL_DEADLINE_MS = 400;

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

    if (!armedRef.current) {
        return <>{children}</>;
    }

    return (
        <div
            style={{
                opacity: revealed ? 1 : 0,
                transition: `opacity ${REVEAL_FADE_MS}ms ease-out`
            }}
        >
            {children}
        </div>
    );
}
