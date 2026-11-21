import { Focusable } from "@decky/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";

const INPUT_UNKNOWN = 1;
const INPUT_NONE = 2;
const INPUT_BASIC = 3;
const INPUT_FULL = 4;
const BUTTON_STEAM_GUIDE = 27;
const BUTTON_STEAM_QUICK_MENU = 28;
const SOURCE_GAMEPAD = 1;

const FIBER_LIMIT = 300000;

const CONTAINER_STYLE = { flex: "1 1 0%", position: "relative", display: "flex" } as const;

let viewRenderer: unknown = null;

function isViewRenderer(type: any): boolean {
    const render = type?.type ?? type?.render;
    if (!type?.$$typeof || typeof render !== "function") {
        return false;
    }
    let source = "";
    try {
        source = Function.prototype.toString.call(render);
    }
    catch {
        return false;
    }
    return source.includes("animateIn") && source.includes("underlay");
}

export function findViewRenderer(): unknown {
    if (viewRenderer) {
        return viewRenderer;
    }
    const doc = SteamUIStore?.WindowStore?.GamepadUIMainWindowInstance?.BrowserWindow?.document;
    const nodes: Element[] = Array.from(doc?.body?.querySelectorAll("*") ?? []);
    let fiber: any = null;
    for (const el of nodes.slice(0, 200)) {
        const key = Object.keys(el).find((name) => name.startsWith("__reactFiber"));
        if (key) {
            fiber = (el as any)[key];
            break;
        }
    }
    while (fiber?.return) {
        fiber = fiber.return;
    }
    const stack = fiber ? [fiber] : [];
    for (let visited = 0; stack.length && visited < FIBER_LIMIT; visited++) {
        const node = stack.pop();
        if (isViewRenderer(node.elementType)) {
            viewRenderer = node.elementType;
            return viewRenderer;
        }
        if (node.sibling) {
            stack.push(node.sibling);
        }
        if (node.child) {
            stack.push(node.child);
        }
    }
    return null;
}

export function browserHostAvailable(): boolean {
    const main = SteamUIStore?.WindowStore?.GamepadUIMainWindowInstance;
    const coordinator = (window as any).g_WindowFocusCoordinator;
    return typeof coordinator?.SetBrowserViewFocus === "function"
        && typeof coordinator?.SetBrowserViewBlurred === "function"
        && typeof main?.m_FocusNavContext?.OnActivateBrowserView === "function"
        && typeof main?.ActionDescriptionStore?.SetActionDescriptionsFromMap === "function"
        && findViewRenderer() !== null;
}

function unsubscribe(handle: any) {
    if (typeof handle === "function") {
        handle();
    }
    else {
        handle?.Unsubscribe?.();
        handle?.Unregister?.();
    }
}

function useInputLevel(wrapper: any): number {
    const [level, setLevel] = useState<number>(() => wrapper.GetGameInputSupportLevel()?.Value ?? INPUT_UNKNOWN);
    useEffect(() => {
        const value = wrapper.GetGameInputSupportLevel();
        setLevel(value?.Value ?? INPUT_UNKNOWN);
        const handle = value?.Subscribe?.((next: number) => setLevel(next));
        return () => unsubscribe(handle);
    }, [wrapper]);
    return level;
}

export function BrowserHost(props: {
    browser: any;
    visible: boolean;
    autoFocus: boolean;
    classNameContainer?: string;
    children: ReactNode;
}) {
    const wrapper = props.browser;
    const outerRef = useRef<HTMLDivElement>(null);
    const navRef = useRef<any>(null);
    const [focusWithin, setFocusWithin] = useState(false);
    const [treeActive, setTreeActive] = useState(false);
    const active = focusWithin && treeActive;
    const level = useInputLevel(wrapper);

    useEffect(() => {
        const tree = navRef.current?.NavTree?.();
        if (!tree) {
            return undefined;
        }
        setTreeActive(tree.BIsActiveWithinContext());
        const handle = tree.OnActiveStateChangedCallbacks.Register(() => setTreeActive(tree.BIsActiveWithinContext()));
        return () => handle.Unregister();
    }, []);

    useEffect(() => {
        if (props.visible && props.autoFocus) {
            navRef.current?.TakeFocus?.();
        }
    }, [props.visible, props.autoFocus]);

    useEffect(() => {
        if (!active || level !== INPUT_NONE) {
            return undefined;
        }
        SteamClient.Input.SetWebBrowserActionset(true);
        return () => SteamClient.Input.SetWebBrowserActionset(false);
    }, [active, level]);

    useEffect(() => {
        if (!active || !props.visible) {
            return undefined;
        }
        const raw = wrapper.GetBrowser();
        const tree = navRef.current?.NavTree?.();
        const coordinator = (window as any).g_WindowFocusCoordinator;
        coordinator.SetBrowserViewFocus(raw, tree);
        return () => coordinator.SetBrowserViewBlurred(raw, tree);
    }, [wrapper, active, props.visible]);

    useEffect(() => {
        const raw = wrapper.GetBrowser();
        const context = SteamUIStore?.WindowStore?.GamepadUIMainWindowInstance?.m_FocusNavContext;
        const ownerWindow = outerRef.current?.ownerDocument?.defaultView;
        if (typeof raw?.on !== "function" || !context || !ownerWindow) {
            return undefined;
        }
        const onFocusChanged = (focused: boolean) => {
            if (focused) {
                context.OnActivateBrowserView(ownerWindow, wrapper.name);
            }
            else {
                context.OnDeactivateBrowserView(ownerWindow, wrapper.name);
            }
        };
        raw.on("focus-changed", onFocusChanged);
        return () => raw.off("focus-changed", onFocusChanged);
    }, [wrapper]);

    useEffect(() => {
        if (!active) {
            return undefined;
        }
        const store = SteamUIStore?.WindowStore?.GamepadUIMainWindowInstance?.ActionDescriptionStore;
        return wrapper.RegisterOnActionDescriptionsChangedCallback(store.SetActionDescriptionsFromMap);
    }, [wrapper, active]);

    useEffect(() => {
        const list = wrapper.OnUnhandledInputCallbacks?.();
        if (typeof list?.Register !== "function") {
            return undefined;
        }
        const handle = list.Register((button: number) => {
            const el = outerRef.current;
            const view = el?.ownerDocument?.defaultView as any;
            if (!el || !view) {
                return;
            }
            const detail = { button, source: SOURCE_GAMEPAD, is_repeat: false };
            el.dispatchEvent(new view.CustomEvent("vgp_onbuttondown", { bubbles: true, cancelable: true, detail }));
            el.dispatchEvent(new view.CustomEvent("vgp_onbuttonup", { bubbles: true, cancelable: true, detail }));
        });
        return () => unsubscribe(handle);
    }, [wrapper]);

    const forward = (event: any) => {
        if (level !== INPUT_FULL && level !== INPUT_BASIC) {
            return;
        }
        const button = event.detail?.button;
        if (button === BUTTON_STEAM_GUIDE || button === BUTTON_STEAM_QUICK_MENU) {
            return;
        }
        wrapper.ForwardGamepadEventDetail(event.type, event.detail);
        event.stopPropagation();
    };

    const containerProps: Record<string, unknown> = {
        navRef,
        noFocusRing: true,
        focusable: props.visible,
        onFocusWithin: setFocusWithin,
        onButtonDown: forward,
        onButtonUp: forward,
        style: CONTAINER_STYLE,
    };
    if (level !== INPUT_FULL) {
        containerProps.onOKActionDescription = null;
    }

    return (
        <Focusable ref={outerRef} className={props.classNameContainer}>
            <Focusable {...containerProps}>{props.children}</Focusable>
        </Focusable>
    );
}
