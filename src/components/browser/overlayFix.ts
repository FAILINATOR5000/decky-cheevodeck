export const OVERLAY_FIX = `(() => {
    if (window.__cheevodeckOverlayFix) {
        return;
    }
    window.__cheevodeckOverlayFix = true;
    const lifted = [];

    const shown = (el) => el.isConnected
        && getComputedStyle(el).display !== "none"
        && el.getBoundingClientRect().height > 0;

    const misplaced = (overlay) => overlay.getBoundingClientRect().height > window.innerHeight + 1;

    const restore = () => {
        for (let i = lifted.length - 1; i >= 0; i--) {
            const entry = lifted[i];
            if (!shown(entry.overlay)) {
                entry.el.style.containerType = entry.containerType;
                entry.el.style.contain = entry.contain;
                lifted.splice(i, 1);
            }
        }
    };

    const lift = (overlay) => {
        for (let el = overlay.parentElement; el; el = el.parentElement) {
            const style = getComputedStyle(el);
            if (style.containerType !== "normal" || style.contain !== "none") {
                lifted.push({ overlay, el, containerType: el.style.containerType, contain: el.style.contain });
                el.style.containerType = "normal";
                el.style.contain = "none";
            }
        }
    };

    const bringIntoView = (overlay) => {
        let biggest = null;
        let area = 0;
        for (const child of overlay.children) {
            const rect = child.getBoundingClientRect();
            if (rect.width * rect.height > area) {
                area = rect.width * rect.height;
                biggest = child;
            }
        }
        if (!biggest) {
            return;
        }
        const rect = biggest.getBoundingClientRect();
        if (rect.top >= window.innerHeight || rect.bottom <= 0) {
            biggest.scrollIntoView({ block: "center" });
        }
    };

    const check = () => {
        restore();
        for (const overlay of document.querySelectorAll("[role=dialog]")) {
            if (!shown(overlay) || getComputedStyle(overlay).position !== "fixed" || !misplaced(overlay)) {
                continue;
            }
            lift(overlay);
            if (misplaced(overlay)) {
                bringIntoView(overlay);
            }
        }
    };

    const soon = () => {
        for (const delay of [50, 300, 1000]) {
            setTimeout(check, delay);
        }
    };
    document.addEventListener("click", soon, true);
    document.addEventListener("keyup", soon, true);
})();`;
