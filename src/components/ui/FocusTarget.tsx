import type { HTMLAttributes, Ref } from "react";

type FocusTargetProps = HTMLAttributes<HTMLDivElement> & {
    focusKey?: string;
    focusFallback?: string[];
    recordOff?: boolean;
    ref?: Ref<HTMLDivElement>;
};

export function FocusTarget(props: FocusTargetProps) {
    const { focusKey, focusFallback, recordOff, ...rest } = props;
    return (
        <div
            {...rest}
            data-focus-key={focusKey}
            data-focus-fallback={focusFallback ? JSON.stringify(focusFallback) : undefined}
            data-focus-record={recordOff ? "off" : undefined}
        />
    );
}
