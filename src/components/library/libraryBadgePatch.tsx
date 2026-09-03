import { routerHook, type RoutePatch } from "@decky/api";
import {
    afterPatch,
    appDetailsClasses,
    createReactTreePatcher,
    findInReactTree
} from "@decky/ui";
import { logError } from "../../utils/errors";
import { LibraryBadge } from "./LibraryBadge";

const LIBRARY_ROUTE = "/library/app/:appid";

const BADGE_KEY = "cheevodeck-library-badge";

const complained = new Set<string>();

function complainOnce(what: string, e: unknown) {
    if (complained.has(what)) {
        return;
    }
    complained.add(what);
    logError(`libraryBadge: ${what}`, e);
}

let installed: { patch: RoutePatch; unpatchers: (() => void)[] } | undefined;

// Checked on every render, not just at registration: removePatch cannot reach a
// page that is already mounted, so this is what makes turning the knob off take
// effect on the page you are looking at rather than only on the next one.
let wanted = false;

const FIRST_SHORTCUT_APPID = 0x80000000;

function shortcutAppId(props: any) {
    const overview = props?.overview;
    const appId = Number(overview?.appid ?? overview?.shortcut_override_appid ?? 0);
    return Number.isFinite(appId) && appId >= FIRST_SHORTCUT_APPID ? appId : 0;
}

function insertBadge(args: any[], ret: any) {
    if (!wanted) {
        return ret;
    }
    try {
        const appId = shortcutAppId(args?.[0]);
        if (!appId) {
            return ret;
        }
        const container = findInReactTree(
            ret,
            (node: any) =>
                typeof node?.props?.className === "string"
                && node.props.className.includes(appDetailsClasses.InnerContainer)
        );
        if (!container?.props) {
            return ret;
        }
        const children = Array.isArray(container.props.children)
            ? container.props.children
            : [container.props.children];
        container.props.children = [
            <LibraryBadge key={BADGE_KEY} appId={appId} />,
            ...children.filter((child: any) => child?.key !== BADGE_KEY)
        ];
    } catch (e) {
        complainOnce("couldn't place the badge", e);
    }
    return ret;
}

export function enableLibraryBadge() {
    wanted = true;
    if (installed) {
        return;
    }

    const unpatchers: (() => void)[] = [];
    const patch = routerHook.addPatch(LIBRARY_ROUTE, (route: any) => {
        try {
            const host = findInReactTree(route, (node: any) => typeof node?.props?.renderFunc === "function");
            if (!host) {
                return route;
            }
            const patched = afterPatch(
                host.props,
                "renderFunc",
                createReactTreePatcher([(tree: any) => tree?.props?.children], insertBadge)
            );
            unpatchers.push(() => patched.unpatch());
        } catch (e) {
            complainOnce("couldn't patch the library route", e);
        }
        return route;
    });

    installed = { patch, unpatchers };
}

export function applyLibraryBadge(enabled: boolean) {
    if (enabled) {
        enableLibraryBadge();
        return;
    }
    disableLibraryBadge();
}

export function disableLibraryBadge() {
    wanted = false;
    if (!installed) {
        return;
    }
    const { patch, unpatchers } = installed;
    installed = undefined;
    try {
        routerHook.removePatch(LIBRARY_ROUTE, patch);
    } catch (e) {
        logError("libraryBadge: couldn't remove the route patch", e);
    }
    for (const unpatch of unpatchers) {
        try {
            unpatch();
        } catch (e) {
            logError("libraryBadge: couldn't unwrap a render function", e);
        }
    }
}
