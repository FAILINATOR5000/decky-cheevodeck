import { toaster } from "@decky/api";
import { discardMemoryShare, getBrowserTabs, logFocusDebug } from "../../api";
import { getCurrentLanguage, t, type LanguageCode } from "../../locales";
import { logError } from "../../utils/errors";
import { SHARED_MEMORIES_CHANNEL_URL, SHARED_MEMORIES_INVITE_URL, SHARED_MEMORIES_PATH } from "../../utils/sharedMemories";
import { openBrowserModal } from "./BrowserModal";
import { liveViewFor, liveViews, type LiveView } from "./browserViews";

const POLL_MS = 1000;

const DISCORD_ORIGIN = "https://discord.com/";

const WAIT_CAP_MS = 10 * 60 * 1000;

const ADOPT_CAP_MS = 15 * 1000;

const SETTLE_POLLS = 3;

const WATCH_MS = 2000;
const WATCH_CAP_MS = 60 * 60 * 1000;

const DISCORD_EPOCH_MS = 1420070400000;
const THREAD_SLACK_MS = 5000;

export type DiscordShare = {
    filePath: string;
    title: string;
    message: string;
    tags: string[];
};

type PageState = "forum" | "entry" | "elsewhere" | "away" | "loading";

const PAGE_STATE = `(() => {
    if (location.protocol !== "https:" && location.protocol !== "http:") return "loading";
    if (location.hostname !== "discord.com") return "away";
    const path = location.pathname.replace(/\\/$/, "");
    if (path === ${JSON.stringify(SHARED_MEMORIES_PATH)}) {
        return document.querySelector("textarea") ? "forum" : "loading";
    }
    if (path.startsWith(${JSON.stringify(SHARED_MEMORIES_PATH)})) return "loading";
    if (path.includes("/login") || path.startsWith("/invite/") || path.startsWith("/app/invite") || path === "/register") return "entry";
    return "elsewhere";
})()`;

const FIND_FORM = `
    const title = document.querySelector("textarea");
    const climb = (test) => {
        let node = title;
        for (let i = 0; i < 14 && node; i++) {
            node = node.parentElement;
            if (node && test(node)) return node;
        }
        return null;
    };
    const EDITOR = "[contenteditable=true][role=textbox]";
    const form = climb((node) => node.querySelector("button[type=submit]") && node.querySelector(EDITOR));
    const tight = climb((node) => node.querySelector(EDITOR) && node.querySelector("input[type=file]"));
    const editor = form ? form.querySelector(EDITOR) : tight ? tight.querySelector(EDITOR) : null;
`;

const FORM_STATE = `(() => {
    ${FIND_FORM}
    if (!form) return { open: false };
    let typed = "";
    if (editor) {
        const copy = editor.cloneNode(true);
        copy.querySelectorAll("[data-slate-placeholder],[contenteditable=false]").forEach((node) => node.remove());
        typed = (copy.textContent || "").replace(/\\uFEFF/g, "").trim();
    }
    return { open: true, title: title.value, typed, attached: !tight && !!form.querySelector("[src^='blob:']") };
})()`;

const PRESS_NEW_POST = `(() => {
    let node = document.querySelector("textarea");
    for (let i = 0; i < 6 && node; i++) {
        node = node.parentElement;
        const buttons = node ? node.querySelectorAll("button") : [];
        if (buttons.length === 1) {
            buttons[0].click();
            return true;
        }
    }
    return false;
})()`;

function inTightForm(select: string): string {
    return `(() => {
        ${FIND_FORM}
        if (!tight) return null;
        return ${select};
    })()`;
}

const FORM_READY = inTightForm("true");
const FOCUS_TITLE = inTightForm(`(title.focus(), true)`);
const FOCUS_CAPTION = inTightForm(`(editor.focus(), true)`);
const FILE_INPUT = inTightForm(`tight.querySelector("input[type=file]")`);

const CHIP_SCOPE = `
    ${FIND_FORM}
    let scope = editor;
    while (scope && !scope.querySelector("[aria-pressed]")) scope = scope.parentElement;
`;

function pressTags(names: string[]): string {
    return `(() => {
        ${CHIP_SCOPE}
        if (!scope) return null;
        const chips = [...scope.querySelectorAll("[aria-pressed]")];
        for (const name of ${JSON.stringify(names)}) {
            const found = chips.filter((chip) => (chip.innerText || "").trim() === name);
            if (found.length === 1 && found[0].getAttribute("aria-pressed") !== "true") found[0].click();
        }
        return true;
    })()`;
}

function filledState(names: string[]): string {
    return `(() => {
        ${CHIP_SCOPE}
        if (!scope) return null;
        const pressed = [...scope.querySelectorAll("[aria-pressed=true]")].map((chip) => (chip.innerText || "").trim());
        const post = scope.querySelector("button[type=submit]");
        return {
            tags: ${JSON.stringify(names)}.every((name) => pressed.includes(name)),
            postEnabled: !!post && !post.disabled
        };
    })()`;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function evaluate(view: LiveView, expression: string): Promise<any> {
    const result = await view.session.command("Runtime.evaluate", { expression, returnByValue: true });
    return result?.result?.value ?? null;
}

function toast(body: string, vars?: Record<string, string | number>) {
    const language = getCurrentLanguage();
    toaster.toast({ title: t(language, "Shared Memories"), body: t(language, body, vars) });
}

async function tabStillOpen(tabId: string): Promise<boolean> {
    try {
        const listed = await getBrowserTabs();
        return (listed?.tabs ?? []).some((tab) => tab?.id === tabId);
    }
    catch (e) {
        logError("discord share: couldn't list the browser's tabs", e);
        return true;
    }
}

class ForumWatch {
    private tabId: string | null = null;
    private readonly known: Set<string>;
    private readonly startedAt = Date.now();
    private settled = 0;
    private away = 0;
    private invited = false;
    private timer: number | null = null;
    stopped = false;

    constructor(private readonly onPoll: (view: LiveView, state: PageState) => Promise<boolean>, private readonly onEnd: (reason: string) => void) {
        this.known = new Set(liveViews().map((view) => view.tabId));
    }

    async start(language: LanguageCode) {
        try {
            const listed = await getBrowserTabs();
            for (const tab of listed?.tabs ?? []) {
                if (tab?.id) {
                    this.known.add(String(tab.id));
                }
            }
        }
        catch (e) {
            logError("discord share: couldn't list the browser's tabs", e);
        }
        if (this.stopped) {
            return;
        }
        openBrowserModal(language, SHARED_MEMORIES_CHANNEL_URL);
        this.schedule(POLL_MS);
    }

    stop(reason: string) {
        if (this.stopped) {
            return;
        }
        this.stopped = true;
        if (this.timer !== null) {
            window.clearTimeout(this.timer);
            this.timer = null;
        }
        logFocusDebug("discord-share", "watch ended", reason);
        this.onEnd(reason);
    }

    private schedule(ms: number) {
        this.timer = window.setTimeout(() => void this.poll(), ms);
    }

    private async poll() {
        this.timer = null;
        if (this.stopped) {
            return;
        }
        let view: LiveView | null = null;
        if (this.tabId === null) {
            const candidate = liveViews().find((live) => live.tabId
                && !this.known.has(live.tabId)
                && live.host.currentUrl.startsWith(DISCORD_ORIGIN));
            if (candidate) {
                this.tabId = candidate.tabId;
                view = candidate;
            }
            else if (Date.now() - this.startedAt > ADOPT_CAP_MS) {
                this.stop("no tab");
                return;
            }
        }
        else {
            view = liveViewFor(this.tabId);
            if (!view && !(await tabStillOpen(this.tabId))) {
                this.stop("tab closed");
                return;
            }
            if (this.stopped) {
                return;
            }
        }
        if (Date.now() - this.startedAt > WAIT_CAP_MS) {
            this.stop("timed out");
            return;
        }

        if (view) {
            let state: PageState = "loading";
            try {
                state = (await evaluate(view, PAGE_STATE)) ?? "loading";
            }
            catch {
            }
            if (this.stopped) {
                return;
            }
            this.away = state === "away" && !view.host.isLoading ? this.away + 1 : 0;
            if (this.away >= SETTLE_POLLS) {
                this.stop("left discord");
                return;
            }
            if (await this.onPoll(view, state)) {
                return;
            }
            this.fallBack(view, state);
        }
        this.schedule(POLL_MS);
    }

    private fallBack(view: LiveView, state: PageState) {
        this.settled = state === "elsewhere" && !view.host.isLoading ? this.settled + 1 : 0;
        if (this.settled < SETTLE_POLLS || this.invited || !SHARED_MEMORIES_INVITE_URL) {
            return;
        }
        this.invited = true;
        logFocusDebug("discord-share", "sending to the invite", view.host.currentUrl.slice(0, 80));
        view.host.loadUrl(SHARED_MEMORIES_INVITE_URL);
    }
}

let buttonWatch: ForumWatch | null = null;

export function openSharedMemories(language: LanguageCode): void {
    buttonWatch?.stop("replaced");
    if (pending && !pending.filling) {
        pending.watch.stop("replaced by the forum button");
    }
    const watch = new ForumWatch(
        async (_view, state) => {
            if (state === "forum") {
                watch.stop("arrived");
                return true;
            }
            return false;
        },
        () => {
            if (buttonWatch === watch) {
                buttonWatch = null;
            }
        }
    );
    buttonWatch = watch;
    void watch.start(language);
}

type Pending = {
    share: DiscordShare;
    watch: ForumWatch;
    draftToasted: boolean;
    filling: boolean;
};

let pending: Pending | null = null;
let postWatch: number | null = null;

function endPostWatch() {
    if (postWatch !== null) {
        window.clearInterval(postWatch);
        postWatch = null;
    }
}

function discard(filePath: string) {
    discardMemoryShare(filePath).catch((e) => logError("discord share: couldn't discard the share file", e));
}

export function startDiscordShare(language: LanguageCode, share: DiscordShare): void {
    const previous = pending;
    pending = null;
    previous?.watch.stop("replaced");
    endPostWatch();

    let entry: Pending;
    const watch = new ForumWatch(
        (view, state) => onSharePoll(entry, view, state),
        (reason) => {
            if (pending !== entry) {
                return;
            }
            pending = null;
            if (reason === "timed out") {
                toast("CheevoDeck stopped waiting for Discord. Share the memory again when you're ready.");
            }
            if (reason !== "filled") {
                discard(share.filePath);
            }
        }
    );
    entry = { share, watch, draftToasted: false, filling: false };
    pending = entry;
    logFocusDebug("discord-share", "started", `${share.title} tags=${share.tags.join(",")}`);
    void watch.start(language);
}

async function onSharePoll(entry: Pending, view: LiveView, state: PageState): Promise<boolean> {
    if (state !== "forum" || entry.filling) {
        return false;
    }
    let form: { open: boolean; title?: string; typed?: string; attached?: boolean } | null = null;
    try {
        form = await evaluate(view, FORM_STATE);
    }
    catch {
        return false;
    }
    if (entry.watch.stopped || pending !== entry) {
        return true;
    }
    if (form?.open && (form.title?.trim() || form.typed || form.attached)) {
        if (!entry.draftToasted) {
            entry.draftToasted = true;
            toast("Discard your Discord draft and CheevoDeck will fill in your post.");
        }
        return false;
    }
    entry.filling = true;
    await fill(entry, view, Boolean(form?.open));
    return true;
}

async function fill(entry: Pending, view: LiveView, alreadyOpen: boolean) {
    const { share } = entry;
    let missed = "";
    let attached = false;
    const keyboardHold = view.host.holdPageKeyboard();
    try {
        if (!alreadyOpen && !(await evaluate(view, PRESS_NEW_POST))) {
            missed = "new post";
        }
        if (!missed) {
            let ready = false;
            for (let waited = 0; waited < 3000 && !ready; waited += 150) {
                ready = Boolean(await evaluate(view, FORM_READY));
                if (!ready) {
                    await sleep(150);
                }
            }
            if (!ready) {
                missed = "form";
            }
        }
        if (!missed) {
            if (await evaluate(view, FOCUS_TITLE)) {
                await view.session.command("Input.insertText", { text: share.title });
            }
            else {
                missed = "title";
            }
        }
        if (!missed && share.message) {
            if (await evaluate(view, FOCUS_CAPTION)) {
                await view.session.command("Input.insertText", { text: share.message });
            }
            else {
                missed = "caption";
            }
        }
        if (!missed) {
            const input = await view.session.command("Runtime.evaluate", { expression: FILE_INPUT });
            const objectId = input?.result?.objectId;
            if (objectId) {
                await view.session.command("DOM.setFileInputFiles", { files: [share.filePath], objectId });
                attached = true;
            }
            else {
                missed = "file";
            }
        }
        if (!missed) {
            await sleep(800);
            await evaluate(view, pressTags(share.tags));
            await sleep(400);
            const filled = await evaluate(view, filledState(share.tags));
            if (!filled?.tags || !filled?.postEnabled) {
                missed = "tags";
            }
        }
    }
    catch (e) {
        logError("discord share: filling the form failed", e);
        missed = missed || "error";
    }
    finally {
        view.host.releasePageKeyboard(keyboardHold);
    }

    if (pending !== entry) {
        return;
    }
    if (missed) {
        logError("discord share: the form didn't fill", new Error(missed));
        toast(attached
            ? "Part of your post needs finishing in Discord."
            : "Part of your post needs finishing in Discord. Press Discord's attach button and your memory is picked for you.");
        if (!attached) {
            await armFileChooser(view, share.filePath);
        }
    }
    entry.watch.stop("filled");
    watchForPost(view, share.filePath, Date.now());
}

async function armFileChooser(view: LiveView, filePath: string) {
    view.session.onFileChooser((backendNodeId) => {
        view.session.onFileChooser(null);
        void view.session.command("DOM.setFileInputFiles", { files: [filePath], backendNodeId })
            .then(() => view.session.command("Page.setInterceptFileChooserDialog", { enabled: false }))
            .catch((e) => logError("discord share: couldn't answer the file dialog", e));
    });
    try {
        await view.session.command("Page.setInterceptFileChooserDialog", { enabled: true });
    }
    catch (e) {
        view.session.onFileChooser(null);
        logError("discord share: couldn't arm the file dialog", e);
    }
}

function watchForPost(view: LiveView, filePath: string, filledAt: number) {
    endPostWatch();
    const threadPrefix = `${SHARED_MEMORIES_PATH}/threads/`;
    const tabId = view.tabId;
    let checking = false;
    const interval: number = window.setInterval(async () => {
        if (checking) {
            return;
        }
        let done = "";
        const current = liveViewFor(tabId);
        if (current !== view) {
            view.session.onFileChooser(null);
        }
        if (!current) {
            checking = true;
            const open = await tabStillOpen(tabId);
            checking = false;
            if (postWatch !== interval) {
                return;
            }
            if (!open) {
                done = "tab closed";
            }
        }
        else {
            let path = "";
            try {
                path = new URL(current.host.currentUrl).pathname;
            }
            catch {
                path = "";
            }
            if (path.startsWith(threadPrefix)) {
                const id = path.slice(threadPrefix.length).split("/")[0];
                const madeAt = Math.floor(Number(id) / 4194304) + DISCORD_EPOCH_MS;
                if (Number.isFinite(madeAt) && madeAt >= filledAt - THREAD_SLACK_MS) {
                    done = "posted";
                }
            }
        }
        if (!done && Date.now() - filledAt > WATCH_CAP_MS) {
            endPostWatch();
            return;
        }
        if (done) {
            endPostWatch();
            view.session.onFileChooser(null);
            logFocusDebug("discord-share", "finished", done);
            discard(filePath);
        }
    }, WATCH_MS);
    postWatch = interval;
}
