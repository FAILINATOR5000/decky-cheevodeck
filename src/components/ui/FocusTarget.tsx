import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type Ref } from "react";
import { FocusClaim } from "./FocusClaim";
import { confirmRecoveryClaim, spendKeyClaim, useKeyClaim, withdrawKeyClaim } from "../../focusClaims";

type FocusTargetProps = HTMLAttributes<HTMLDivElement> & {
    focusKey?: string;
    focusFallback?: string[];
    recordOff?: boolean;
    recordAs?: string;
    ref?: Ref<HTMLDivElement>;
};

const WRAPPER_TAKES = [
    "flex", "flexGrow", "flexShrink", "flexBasis", "alignSelf", "justifySelf", "order",
    "gridColumn", "gridRow", "gridArea", "width", "minWidth", "maxWidth", "height", "minHeight", "maxHeight"
] as const;
const ABSOLUTE_PLACEMENT = ["position", "top", "right", "bottom", "left", "zIndex"] as const;

function splitClaimStyle(style: CSSProperties | undefined): { wrapper: CSSProperties; control: CSSProperties } {
    const wrapper: Record<string, unknown> = { display: "grid" };
    const control: Record<string, unknown> = { ...style };
    const moved = style?.position === "absolute" ? [...WRAPPER_TAKES, ...ABSOLUTE_PLACEMENT] : WRAPPER_TAKES;
    for (const key of moved) {
        if (style?.[key] !== undefined) {
            wrapper[key] = style[key];
            delete control[key];
        }
    }
    return { wrapper: wrapper as CSSProperties, control: control as CSSProperties };
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
    const { focusKey, focusFallback, recordOff, recordAs, ref, ...rest } = props;
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

    const claimStyle = token > 0 ? splitClaimStyle(rest.style) : null;
    const element = (
        <div
            {...rest}
            style={claimStyle ? claimStyle.control : rest.style}
            ref={setNode}
            data-focus-key={focusKey}
            data-focus-fallback={focusFallback ? JSON.stringify(focusFallback) : undefined}
            data-focus-record={recordOff ? "off" : undefined}
            data-focus-record-as={recordAs}
        />
    );
    if (!claimStyle) {
        return element;
    }
    return (
        <FocusClaim token={token} armed={armed} onSpent={spend} style={claimStyle.wrapper}>
            {element}
        </FocusClaim>
    );
}
