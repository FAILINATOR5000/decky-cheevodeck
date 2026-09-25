export const AD_LIBRARY_STAND_IN = `(() => {
    const w = window;
    const inert = new Proxy(function () {}, {
        get: (target, key) => {
            if (key === "then") {
                return undefined;
            }
            if (key === Symbol.toPrimitive) {
                return () => "";
            }
            if (key === Symbol.iterator) {
                return function* () {};
            }
            if (key === "length") {
                return 0;
            }
            return inert;
        },
        apply: () => inert
    });
    const run = (fn) => {
        try {
            if (typeof fn === "function") {
                fn(inert);
            }
        }
        catch (e) {
        }
    };

    if (!(w.googletag && w.googletag.apiReady)) {
        const queued = w.googletag && Array.isArray(w.googletag.cmd) ? w.googletag.cmd : [];
        const cmd = { push: (...fns) => { fns.forEach(run); return fns.length; } };
        w.googletag = new Proxy({ apiReady: true, pubadsReady: true, cmd }, {
            get: (target, key) => key in target ? target[key] : inert
        });
        queued.forEach(run);
    }

    w.fandomAds = w.fandomAds || {};
    const pending = Array.isArray(w.fandomAds.cmd) ? w.fandomAds.cmd.slice() : [];
    const fandomCmd = [];
    fandomCmd.push = (...fns) => { fns.forEach(run); return 0; };
    w.fandomAds.cmd = fandomCmd;
    pending.forEach(run);

    if (w.customElements && !w.customElements.get("fandom-video-ad")) {
        w.customElements.define("fandom-video-ad", class extends HTMLElement {
            getMonetizationTier() {
                return undefined;
            }
            requestRender() {
                return Promise.resolve({});
            }
            getAdUnitPath() {
                return Promise.resolve(null);
            }
        });
    }
})();`;
