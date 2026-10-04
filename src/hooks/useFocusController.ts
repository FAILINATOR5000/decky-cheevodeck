import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type Dispatch,
    type RefObject,
    type SetStateAction
} from "react";
import { logFocusDebug } from "../api";
import { ROUTES } from "../routes";
import type { ViewKey } from "../types";

interface UseFocusControllerArgs {
    view: ViewKey;
    loading: boolean;
    friendProfileOverlayText: string | null;
    rootRef: RefObject<HTMLDivElement | null>;
    pendingFocusKey: string | null;
    setPendingFocusKey: Dispatch<SetStateAction<string | null>>;
    resumeViewFlipRef: RefObject<boolean>;
}

function escapeAttrValue(value: string): string {
    return value.replace(/["\\]/g, "\\$&");
}

export function useFocusController({
    view,
    loading,
    friendProfileOverlayText,
    rootRef,
    pendingFocusKey,
    setPendingFocusKey,
    resumeViewFlipRef
}: UseFocusControllerArgs) {
    const lastViewRef = useRef<ViewKey>("achievements");
    const needsViewportResetRef = useRef(false);

    const [achievementsInitialAutoFocusDone, setAchievementsInitialAutoFocusDone] = useState(false);
    const [mainEntryToken, setMainEntryToken] = useState(0);
    const [mainEntryFromView, setMainEntryFromView] = useState<ViewKey | null>(null);

    const findScrollParent = useCallback((start: HTMLElement | null): HTMLElement | null => {
        let node: HTMLElement | null = start;
        while (node) {
            const view = node.ownerDocument.defaultView;
            const style = view?.getComputedStyle(node);
            const overflowY = style?.overflowY;
            const canScroll =
                (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
                node.scrollHeight > node.clientHeight;
            if (canScroll) {
                return node;
            }
            node = node.parentElement;
        }
        return (start?.ownerDocument.scrollingElement as HTMLElement | null) ?? null;
    }, []);

    const scrollViewportToTop = useCallback(() => {
        const scroller = findScrollParent(rootRef.current);
        if (!scroller) {
            return;
        }
        scroller.scrollTop = 0;
    }, [findScrollParent]);

    const currentFocusKeyInRoot = useCallback(() => {
        const root = rootRef.current;
        const active = root?.ownerDocument.activeElement as HTMLElement | null | undefined;
        if (!root || !active || !root.contains(active)) {
            return null;
        }
        const container = active.closest?.("[data-focus-key]") as HTMLElement | null;
        return container?.getAttribute("data-focus-key") || null;
    }, []);

    const focusByKey = useCallback((focusKey: string) => {
        const searchRoot = rootRef.current;
        const container = searchRoot?.querySelector(`[data-focus-key="${escapeAttrValue(focusKey)}"]`) as HTMLElement | null;
        const target = (container?.querySelector("button, [tabindex]") as HTMLElement | null) || container;
        if (!container || !target) {
            return false;
        }

        target.focus();
        return true;
    }, []);

    const topLevelFocusKeyForView = useCallback((currentView: ViewKey): string => {
        return ROUTES[currentView].focusKey;
    }, []);

    useEffect(() => {
        logFocusDebug(
            "pending",
            pendingFocusKey ?? "(null)",
            `view=${view} last=${lastViewRef.current} loading=${loading} overlay=${Boolean(friendProfileOverlayText)}`
        );
    }, [pendingFocusKey, view, loading, friendProfileOverlayText]);

    useEffect(() => {
        if (loading || Boolean(friendProfileOverlayText)) {
            return;
        }

        const lastView = lastViewRef.current;
        if (lastView !== view) {
            if (view !== "achievements") {
                const key = topLevelFocusKeyForView(view);
                const fromResume = resumeViewFlipRef.current;
                resumeViewFlipRef.current = false;
                logFocusDebug("viewchange", key, `from=${lastView} to=${view} resume=${fromResume}`);
                if (!fromResume) {
                    needsViewportResetRef.current = true;
                }
                setPendingFocusKey(key);
            }
            else {
                logFocusDebug("viewchange", "(null)", `from=${lastView} to=achievements`);
                needsViewportResetRef.current = true;
                setPendingFocusKey(null);
                setMainEntryToken((current) => current + 1);
                setMainEntryFromView(lastView);
            }
        }
        lastViewRef.current = view;
    }, [view, loading, friendProfileOverlayText, topLevelFocusKeyForView]);

    useEffect(() => {
        if (view !== "achievements") {
            return;
        }
        if (achievementsInitialAutoFocusDone) {
            return;
        }
        if (pendingFocusKey) {
            return;
        }
        setAchievementsInitialAutoFocusDone(true);
    }, [view, pendingFocusKey, achievementsInitialAutoFocusDone]);

    useLayoutEffect(() => {
        if (!pendingFocusKey) {
            return;
        }
        const isFastPathKey =
            pendingFocusKey.startsWith("achievement:") ||
            pendingFocusKey.startsWith("tracked:tab:") ||
            pendingFocusKey.startsWith("memories:tile:") ||
            pendingFocusKey === "gameoverview:back" ||
            pendingFocusKey === "ao:back" ||
            pendingFocusKey === "badges:back" ||
            pendingFocusKey === "wanttoplay:back" ||
            pendingFocusKey === "followedranking:back" ||
            pendingFocusKey === "friendgame:back" ||
            pendingFocusKey === "friendcompare:back" ||
            pendingFocusKey === "trackedsets:back" ||
            pendingFocusKey === "trackedsetopen:back" ||
            pendingFocusKey === "utils:back" ||
            pendingFocusKey === "dolphinMapper:back" ||
            pendingFocusKey === "cheevocheck:back" ||
            pendingFocusKey === "fileWatcher:back" ||
            pendingFocusKey === "memories:back" ||
            pendingFocusKey === "guides:back" ||
            pendingFocusKey === "comparepicker:back";
        if (!isFastPathKey) {
            return;
        }
        if (loading || Boolean(friendProfileOverlayText)) {
            logFocusDebug(
                "fastpath-bail",
                pendingFocusKey,
                `loading=${loading} overlay=${Boolean(friendProfileOverlayText)}`
            );
            return;
        }
        const claimed = focusByKey(pendingFocusKey);
        const landed = claimed ? currentFocusKeyInRoot() : null;
        logFocusDebug("fastpath", pendingFocusKey, `claimed=${claimed} landed=${landed ?? "(none)"}`);
    }, [pendingFocusKey, loading, friendProfileOverlayText, focusByKey, currentFocusKeyInRoot]);

    useEffect(() => {
        if (!pendingFocusKey) {
            return;
        }
        if (loading || Boolean(friendProfileOverlayText)) {
            return;
        }

        let cancelled = false;

        if (needsViewportResetRef.current) {
            scrollViewportToTop();
            needsViewportResetRef.current = false;
        }

        const rafId = window.requestAnimationFrame(() => {
            if (cancelled) {
                return;
            }

            const targetExists = Boolean(
                rootRef.current?.querySelector(`[data-focus-key="${escapeAttrValue(pendingFocusKey)}"]`)
            );
            const claimed = focusByKey(pendingFocusKey);
            const landed = currentFocusKeyInRoot();
            logFocusDebug(
                "raf",
                pendingFocusKey,
                `exists=${targetExists} claimed=${claimed} landed=${landed ?? "(none)"}`
            );

            if (landed === pendingFocusKey) {
                setPendingFocusKey((current) => (current === pendingFocusKey ? null : current));
            }
        });

        return () => {
            cancelled = true;
            window.cancelAnimationFrame(rafId);
        };
    }, [
        pendingFocusKey,
        loading,
        friendProfileOverlayText,
        focusByKey,
        currentFocusKeyInRoot,
        scrollViewportToTop
    ]);

    return {
        state: {
            achievementsInitialAutoFocusDone,
            mainEntryToken,
            mainEntryFromView
        }
    };
}
