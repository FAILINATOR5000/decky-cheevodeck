import { Focusable } from "@decky/ui";
import { type ReactNode, useEffect } from "react";
import { logFocusDebug } from "../../api";

type FocusClaimProps = {
    token: number;
    armed: boolean;
    onSpent: () => void;
    children: ReactNode;
};

export function FocusClaim(props: FocusClaimProps) {
    const { token, armed, onSpent } = props;

    useEffect(function spendTheClaim() {
        if (!armed) {
            return;
        }

        logFocusDebug("focus-claim", `token:${token}`, "mounted armed, spending it");
        onSpent();
    }, [token, armed, onSpent]);

    if (token <= 0) {
        return <>{props.children}</>;
    }

    return (
        <Focusable key={`claim:${token}`} autoFocus={armed}>
            {props.children}
        </Focusable>
    );
}
