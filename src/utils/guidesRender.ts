import DOMPurify from "dompurify";

import { absoluteGameFaqsUrl } from "./guidesFetch";

export function extractGuideLines(html: string): string[] {
    try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const text = doc.body ? doc.body.textContent ?? "" : "";
        return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    }
    catch {
        return [];
    }
}

function tidyGuideNode(node: Element) {
    const cls = node.getAttribute("class") ?? "";
    if (cls.split(/\s+/).indexOf("ftoc") >= 0) {
        node.remove();
        return;
    }
    if (node.tagName === "IMG") {
        const src = node.getAttribute("src");
        if (src) {
            node.setAttribute("src", absoluteGameFaqsUrl(src));
        }
        return;
    }
    if (node.tagName === "A") {
        const href = node.getAttribute("href");
        if (href && href.charAt(0) !== "#") {
            node.setAttribute("href", absoluteGameFaqsUrl(href));
        }
    }
}

export function sanitizeGuideHtml(html: string): string {
    DOMPurify.addHook("afterSanitizeAttributes", tidyGuideNode);
    try {
        return DOMPurify.sanitize(html, {
            USE_PROFILES: { html: true },
            FORBID_TAGS: ["script", "style", "iframe", "form", "input", "button"],
            FORBID_ATTR: ["style", "onerror", "onload", "onclick"],
        });
    }
    finally {
        DOMPurify.removeHook("afterSanitizeAttributes", tidyGuideNode);
    }
}
