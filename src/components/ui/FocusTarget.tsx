import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type Ref } from "react";
import { FocusClaim } from "./FocusClaim";
import { confirmRecoveryClaim, spendKeyClaim, useKeyClaim, withdrawKeyClaim } from "../../focusClaims";

type FocusTargetProps = HTMLAttributes<HTMLDivElement> & {
    focusKey?: string;
    focusFallback?: string[];
    recordOff?: boolean;
    ref?: Ref<HTMLDivElement>;
};

function claimWrapperStyle(style: CSSProperties | undefined): CSSProperties | undefined {
    if (style?.flex !== undefined) {
        return { display: "flex", flex: style.flex, minWidth: style.minWidth };
    }
    if (style?.gridColumn !== undefined) {
        return { display: "grid", gridColumn: style.gridColumn, minWidth: style.minWidth };
    }
    return undefined;
}

function assignRef(ref: Ref<HTMLDivElement> | undefined, node: HTMLDivElement | null) {
    if (typeof ref === "function") {
        ref(node);
    }
    else if (ref) {
        ref.current = node;
    }
}

export function FocusTarget(props: FocusTargetProps) {
    const { focusKey, focusFallback, recordOff, ref, ...rest } = props;
    const claim = useKeyClaim(focusKey);
    const [held, setHeld] = useState(0);
    if (claim && claim.armed && claim.token !== held) {
        setHeld(claim.token);
    }
    const token = claim && claim.armed ? claim.token : held;
    const armed = Boolean(claim && claim.armed && claim.token === token);
    const nodeRef = useRef<HTMLDivElement | null>(null);
    const setNode = useCallback((node: HTMLDivElement | null) => {
        nodeRef.current = node;
        assignRef(ref, node);
    }, [ref]);
    const spend = useCallback(() => {
        if (focusKey) {
            spendKeyClaim(focusKey, token);
        }
    }, [focusKey, token]);

    useLayoutEffect(() => {
        if (!focusKey || !claim || !claim.recovery || claim.armed) {
            return;
        }
        const doc = nodeRef.current?.ownerDocument;
        const active = doc?.activeElement;
        if (!doc || (active && active !== doc.body)) {
            withdrawKeyClaim(focusKey, claim.token, "cursor already placed");
            return;
        }
        confirmRecoveryClaim(focusKey, claim.token);
    }, [focusKey, claim]);

    const element = (
        <div
            {...rest}
            ref={setNode}
            data-focus-key={focusKey}
            data-focus-fallback={focusFallback ? JSON.stringify(focusFallback) : undefined}
            data-focus-record={recordOff ? "off" : undefined}
        />
    );
    if (token <= 0) {
        return element;
    }
    return (
        <FocusClaim token={token} armed={armed} onSpent={spend} style={claimWrapperStyle(rest.style)}>
            {element}
        </FocusClaim>
    );
}
