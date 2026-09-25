export const FULLSCREEN_BINDING = "__cheevodeckFullscreen";

export const FULLSCREEN_WATCH = `(() => {
    if (window.__cheevodeckFullscreenWatch) {
        return;
    }
    window.__cheevodeckFullscreenWatch = true;
    let kept = null;
    document.addEventListener("fullscreenchange", () => {
        const root = document.documentElement;
        const full = !!document.fullscreenElement;
        if (full && kept === null) {
            kept = root.style.zoom;
            root.style.zoom = "1";
        }
        else if (!full && kept !== null) {
            root.style.zoom = kept;
            kept = null;
        }
        try {
            window.${FULLSCREEN_BINDING}(full ? "1" : "0");
        }
        catch (e) {
        }
    });
})();`;
