import { useLayoutEffect, useRef, useState } from "react";
import type { SlidingWindow } from "./useSlidingWindow";

type WhenHeldRequest = {
    key: string;
    after: string | null;
    onHeld: (absoluteIndex: number) => void;
};

export function useWhenHeld<T>(list: SlidingWindow<T>, items: T[], focusKeyFor: (item: T) => string) {
    const [request, setRequest] = useState<WhenHeldRequest | null>(null);
    const openedForRef = useRef<string | null>(null);

    useLayoutEffect(function runOnceHeld() {
        if (!request) {
            return;
        }
        if (request.after !== null && items.some((item) => focusKeyFor(item) === request.after)) {
            return;
        }
        const at = list.mountedItems.findIndex((item) => focusKeyFor(item) === request.key);
        if (at < 0) {
            if (openedForRef.current !== request.key) {
                openedForRef.current = request.key;
                list.openAt(request.key);
            }
            return;
        }
        openedForRef.current = null;
        setRequest(null);
        request.onHeld(list.start + at);
    }, [request, items, list.mountedItems]);

    return function whenHeld(key: string, onHeld: (absoluteIndex: number) => void, after: string | null = null) {
        openedForRef.current = null;
        setRequest({ key, after, onHeld });
    };
}

export function focusHeldRow<T>(list: SlidingWindow<T>, focusKey: string) {
    const holder = list.holderRef.current;
    const row = [...(holder?.querySelectorAll("[data-focus-key]") ?? [])]
        .find((element) => element.getAttribute("data-focus-key") === focusKey);
    const target = row?.querySelector("button, [tabindex]") as HTMLElement | null | undefined;
    target?.focus();
}
