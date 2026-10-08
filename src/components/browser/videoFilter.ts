export const YOUTUBE_HOST = /(^|\.)youtube\.com$/;

export const VIDEO_FILTER_BINDING = "__cheevodeckVideoFilter";

type VideoFilterDisguise = {
    name: string;
    set: Record<string, unknown>;
};

export type VideoFilterDoc = {
    format: number;
    revision: number;
    enabled: boolean;
    marker: string[];
    within: string[];
    remove: string[];
    removeWithDisguise: string[];
    removeAllOnNavigation: boolean;
    globals: string[];
    textPaths: string[];
    disguises: VideoFilterDisguise[];
    holdSeconds: number;
};

const VALIDATE = `
    const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
    const TEXT_PATH = /^\\/[A-Za-z0-9_\\/.-]{1,63}$/;
    const NAME = /^[a-z0-9-]{1,32}$/;
    const UNSAFE = ["__proto__", "prototype", "constructor"];
    const isIdentifier = (value) => typeof value === "string" && IDENTIFIER.test(value) && !UNSAFE.includes(value);
    const isNames = (value, low, high) => Array.isArray(value) && value.length >= low && value.length <= high
        && value.every(isIdentifier) && new Set(value).size === value.length;
    const isScalar = (value) => typeof value === "boolean"
        || (typeof value === "string" && value.length <= 64)
        || (typeof value === "number" && Number.isFinite(value));
    const isEditValue = (value) => {
        if (value === null || typeof value !== "object") {
            return isScalar(value);
        }
        const entries = Object.entries(value);
        return !Array.isArray(value) && entries.length >= 1 && entries.length <= 8
            && entries.every(([key, item]) => isIdentifier(key) && isScalar(item));
    };
    const isDisguise = (entry) => {
        if (!entry || typeof entry !== "object" || typeof entry.name !== "string" || !NAME.test(entry.name)) {
            return false;
        }
        const edits = entry.set && typeof entry.set === "object" && !Array.isArray(entry.set) ? Object.entries(entry.set) : [];
        return edits.length >= 1 && edits.length <= 8 && edits.every(([path, value]) => {
            const segments = path.split(".");
            return segments.length <= 6 && segments.every(isIdentifier) && isEditValue(value);
        });
    };
    const isValid = (doc) => !!doc && typeof doc === "object"
        && doc.format === 1
        && Number.isInteger(doc.revision) && doc.revision >= 1 && doc.revision <= 2147483647
        && doc.enabled === true
        && isNames(doc.marker, 1, 16) && isNames(doc.within, 0, 16) && isNames(doc.remove, 0, 16)
        && isNames(doc.removeWithDisguise, 0, 16) && typeof doc.removeAllOnNavigation === "boolean"
        && isNames(doc.globals, 0, 4)
        && Array.isArray(doc.textPaths) && doc.textPaths.length <= 8
        && doc.textPaths.every((path) => typeof path === "string" && TEXT_PATH.test(path))
        && Array.isArray(doc.disguises) && doc.disguises.length <= 8 && doc.disguises.every(isDisguise)
        && new Set(doc.disguises.map((entry) => entry.name)).size === doc.disguises.length
        && typeof doc.holdSeconds === "number" && doc.holdSeconds >= 2 && doc.holdSeconds <= 20;
`;

export function videoFilterScript(doc: VideoFilterDoc, dead: string[]): string {
    return `(() => {
    if (window !== window.top || !${YOUTUBE_HOST}.test(location.hostname) || window.${VIDEO_FILTER_BINDING}Installed) {
        return;
    }
    const rules = ${JSON.stringify(doc)};
    const dead = ${JSON.stringify(dead)};
    ${VALIDATE}
    if (!isValid(rules) || !Array.isArray(dead)) {
        return;
    }
    window.${VIDEO_FILTER_BINDING}Installed = true;
    const own = (node, key) => Object.prototype.hasOwnProperty.call(node, key);
    const originalParse = JSON.parse;
    const originalStringify = JSON.stringify;
    const live = rules.disguises.filter((entry) => !dead.includes(entry.name));
    const letThrough = new Set();
    const cleaned = new Set();
    const adReported = new Set();
    let pending = "";
    let pendingSince = 0;
    let armed = null;
    const report = (kind, videoId, ms, name) => {
        try {
            window.${VIDEO_FILTER_BINDING}(originalStringify({ kind, revision: rules.revision, name: name || "", videoId, ms: Math.round(ms || 0) }));
        }
        catch (e) {
            return;
        }
    };
    const containersOf = (data) => {
        const list = [data];
        for (const key of rules.within) {
            const inner = own(data, key) ? data[key] : null;
            if (inner && typeof inner === "object" && !Array.isArray(inner)) {
                list.push(inner);
            }
        }
        return list;
    };
    const carries = (list, keys) => list.some((node) => keys.some((key) => own(node, key)));
    const strip = (list, keys) => {
        for (const node of list) {
            for (const key of keys) {
                if (own(node, key)) {
                    delete node[key];
                }
            }
        }
    };
    const playable = (list) => list.some((node) => {
        const status = own(node, "playabilityStatus") ? node.playabilityStatus : null;
        return !!status && typeof status === "object" && status.status === "OK";
    });
    const protectedMedia = (list) => list.some((node) => {
        const streaming = own(node, "streamingData") ? node.streamingData : null;
        if (!streaming || typeof streaming !== "object") {
            return false;
        }
        const formats = Array.isArray(streaming.adaptiveFormats) ? streaming.adaptiveFormats : [];
        return own(streaming, "licenseInfos") || formats.some((format) => format && typeof format === "object" && own(format, "drmFamilies"));
    });
    const detailsOf = (list) => {
        for (const node of list) {
            const details = own(node, "videoDetails") ? node.videoDetails : null;
            if (details && typeof details === "object" && typeof details.videoId === "string") {
                return details;
            }
        }
        return null;
    };
    const pruneOne = (data, embedded) => {
        if (!data || typeof data !== "object" || !rules.marker.some((key) => own(data, key))) {
            return;
        }
        const list = containersOf(data);
        strip(list, rules.remove);
        const details = detailsOf(list);
        const videoId = details ? details.videoId : "";
        if (!carries(list, rules.removeWithDisguise) || letThrough.has(videoId)) {
            return;
        }
        if (cleaned.has(videoId)) {
            strip(list, rules.removeWithDisguise);
            return;
        }
        if (!embedded && !rules.removeAllOnNavigation) {
            return;
        }
        if (!videoId) {
            strip(list, rules.removeWithDisguise);
            return;
        }
        if (live.length && videoId && details.isLive !== true && playable(list) && !protectedMedia(list) && (!embedded || location.pathname === "/watch")) {
            strip(list, rules.removeWithDisguise);
            cleaned.add(videoId);
            schedule(videoId);
        }
        else {
            letThrough.add(videoId);
            report("skipped", videoId, 0, "");
        }
    };
    const prune = (value, embedded) => {
        try {
            if (Array.isArray(value)) {
                for (const item of value) {
                    pruneOne(item, embedded);
                }
            }
            else {
                pruneOne(value, embedded);
            }
        }
        catch (e) {
            return value;
        }
        return value;
    };
    JSON.parse = function (...args) {
        return prune(originalParse.apply(this, args), false);
    };
    const originalJson = Response.prototype.json;
    Response.prototype.json = function (...args) {
        return originalJson.apply(this, args).then((value) => prune(value, false));
    };
    const originalText = Response.prototype.text;
    Response.prototype.text = function (...args) {
        let wanted = false;
        try {
            const address = new URL(this.url);
            wanted = ${YOUTUBE_HOST}.test(address.hostname) && rules.textPaths.some((path) => address.pathname.includes(path));
        }
        catch (e) {
            wanted = false;
        }
        const reading = originalText.apply(this, args);
        if (!wanted) {
            return reading;
        }
        return reading.then((text) => {
            try {
                return originalStringify(prune(originalParse(text), false));
            }
            catch (e) {
                return text;
            }
        });
    };
    for (const name of rules.globals) {
        let value = prune(window[name], true);
        try {
            Object.defineProperty(window, name, {
                configurable: true,
                get: () => value,
                set: (next) => {
                    value = prune(next, true);
                }
            });
        }
        catch (e) {
            continue;
        }
    }
    const applyEdits = (request, edits) => {
        for (const [path, value] of Object.entries(edits)) {
            const segments = path.split(".");
            let node = request;
            for (const segment of segments.slice(0, -1)) {
                if (!own(node, segment)) {
                    node[segment] = {};
                }
                node = node[segment];
                if (!node || typeof node !== "object") {
                    break;
                }
            }
            if (node && typeof node === "object") {
                node[segments[segments.length - 1]] = value && typeof value === "object" ? { ...value } : value;
            }
        }
        const context = request.playbackContext.contentPlaybackContext;
        context.lactMilliseconds = String(Date.now());
        context.referer = String(context.referer || location.href).replace(/(#reloadxhr)?$/, "#reloadxhr");
    };
    JSON.stringify = function (value, ...rest) {
        if (armed && value && typeof value === "object") {
            try {
                const playback = value.playbackContext;
                if (playback && typeof playback === "object" && playback.contentPlaybackContext && typeof playback.contentPlaybackContext === "object"
                    && value.context && typeof value.context === "object" && value.context.client && value.videoId === armed.videoId) {
                    applyEdits(value, armed.set);
                }
            }
            catch (e) {
                return originalStringify.call(this, value, ...rest);
            }
        }
        return originalStringify.call(this, value, ...rest);
    };
    const player = () => document.getElementById("movie_player");
    const currentId = () => new URLSearchParams(location.search).get("v") || "";
    const playerVideoId = (node) => {
        try {
            return String(node.getVideoData().video_id || "");
        }
        catch (e) {
            return "";
        }
    };
    const startSeconds = (node) => {
        let now = 0;
        try {
            now = Number(node.getCurrentTime()) || 0;
        }
        catch (e) {
            now = 0;
        }
        if (now > 0) {
            return now;
        }
        const raw = new URLSearchParams(location.search).get("t") || "";
        const parts = /^(?:(\\d+)h)?(?:(\\d+)m)?(?:(\\d+)s?)?$/.exec(raw);
        return parts ? (Number(parts[1] || 0) * 3600) + (Number(parts[2] || 0) * 60) + Number(parts[3] || 0) : 0;
    };
    const mediaArriving = (node) => {
        try {
            return parseFloat(node.getStatsForNerds().buffer_health_seconds) > 0;
        }
        catch (e) {
            return false;
        }
    };
    const refused = (node) => {
        try {
            return node.getPlayerResponse().playabilityStatus.status === "UNPLAYABLE";
        }
        catch (e) {
            return false;
        }
    };
    const showsError = (node) => {
        const error = node.querySelector(".ytp-error");
        return !!error && error.offsetParent !== null;
    };
    const watch = (node, videoId, started, name) => {
        let base = -1;
        let delivered = false;
        let pressedAt = started;
        const stop = () => {
            clearInterval(timer);
            armed = null;
        };
        const timer = setInterval(() => {
            const now = performance.now();
            const elapsed = now - started;
            const video = node.querySelector("video");
            if (currentId() !== videoId || node.classList.contains("ad-showing")) {
                stop();
                return;
            }
            if (!delivered && showsError(node) && !refused(node)) {
                stop();
                report("skipped", videoId, elapsed, name);
                return;
            }
            const state = node.getPlayerState();
            if (state === 1 && video) {
                if (base < 0) {
                    base = video.currentTime;
                }
                else if (video.currentTime - base >= 0.5) {
                    if (!delivered) {
                        report("ok", videoId, elapsed, name);
                    }
                    stop();
                    return;
                }
            }
            else {
                base = -1;
            }
            if (!delivered && mediaArriving(node)) {
                delivered = true;
                report("ok", videoId, elapsed, name);
            }
            if ((state === -1 || state === 5) && now - pressedAt >= 1500) {
                pressedAt = now;
                node.playVideo();
            }
            if (delivered && elapsed > (rules.holdSeconds + 6) * 1000) {
                stop();
                return;
            }
            if (!delivered && (elapsed > rules.holdSeconds * 1000 || refused(node))) {
                stop();
                letThrough.add(videoId);
                const index = live.findIndex((entry) => entry.name === name);
                if (index >= 0) {
                    live.splice(index, 1);
                }
                report("failed", videoId, elapsed, name);
                node.loadVideoById(videoId, startSeconds(node));
                node.playVideo();
            }
        }, 250);
    };
    const reload = (node) => {
        const videoId = pending;
        const disguise = live[0];
        pending = "";
        if (!disguise) {
            letThrough.add(videoId);
            report("skipped", videoId, 0, "");
            node.loadVideoById(videoId, startSeconds(node));
            node.playVideo();
            return;
        }
        armed = { videoId, set: disguise.set };
        const started = performance.now();
        report("reload", videoId, 0, disguise.name);
        node.loadVideoById(videoId, startSeconds(node));
        node.playVideo();
        watch(node, videoId, started, disguise.name);
    };
    const watchAds = (node) => {
        new MutationObserver(() => {
            const videoId = playerVideoId(node);
            if (node.classList.contains("ad-showing") && videoId && !letThrough.has(videoId) && !adReported.has(videoId)) {
                adReported.add(videoId);
                report("ad", videoId, 0, "");
            }
        }).observe(node, { attributes: true, attributeFilter: ["class"] });
    };
    let watched = null;
    let lookedFrom = performance.now();
    let looker = 0;
    const look = () => {
        const node = player();
        if (node && typeof node.loadVideoById === "function") {
            if (node !== watched) {
                watched = node;
                watchAds(node);
            }
            if (pending && pending === currentId() && playerVideoId(node) === pending) {
                reload(node);
            }
        }
        if (pending && performance.now() - pendingSince > 20000) {
            report("skipped", pending, 0, "");
            pending = "";
        }
        return watched !== null && !pending;
    };
    const lookEvery = (ms) => {
        clearInterval(looker);
        looker = setInterval(() => {
            if (look()) {
                clearInterval(looker);
                looker = 0;
            }
            else if (ms < 1000 && !pending && performance.now() - lookedFrom > 20000) {
                lookEvery(1000);
            }
        }, ms);
    };
    const schedule = (videoId) => {
        pending = videoId;
        pendingSince = performance.now();
        lookedFrom = pendingSince;
        lookEvery(100);
    };
    lookEvery(100);
})();`;
}
