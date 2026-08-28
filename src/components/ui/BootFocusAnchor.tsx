import { Focusable } from "@decky/ui";
import { useEffect, useRef, useState } from "react";

export function BootFocusAnchor(props: { active: boolean }) {
    const { active } = props;

    const [claimToken, setClaimToken] = useState(0);
    const wasActive = useRef(active);

    useEffect(() => {
        const becameActive = active && !wasActive.current;
        wasActive.current = active;
        if (!becameActive) {
            return;
        }
        const timer = window.setTimeout(() => {
            setClaimToken((token) => token + 1);
        }, 0);
        return () => {
            window.clearTimeout(timer);
        };
    }, [active]);

    return (
        <Focusable
            key={claimToken}
            focusable={active}
            focusableIfEmpty={active}
            noFocusRing={true}
            autoFocus={active}
            onCancelButton={active ? () => { } : undefined}
            style={{ height: "1px", minHeight: 0, padding: 0, margin: 0 }}
        />
    );
}
