import type { CSSProperties, ReactNode } from "react";
import { FocusClaim } from "../ui/FocusClaim";
import type { FocusClaimController } from "../../hooks/useFocusClaim";

export function ClaimedRow(props: { claim: FocusClaimController; slotIndex: number; style?: CSSProperties; children: ReactNode }) {
    const { claim, spend } = props.claim;
    const mine = claim && claim.slotIndex === props.slotIndex ? claim : null;
    return (
        <FocusClaim
            token={mine ? mine.token : 0}
            armed={mine !== null && mine.armed}
            onSpent={spend}
            style={props.style}
        >
            {props.children}
        </FocusClaim>
    );
}
