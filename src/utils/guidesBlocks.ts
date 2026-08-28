import type { GuideChunk } from "./guidesChunk";

export type GuidePage = GuideChunk & { html?: string };

const PAGE_CHAR_TARGET = 4000;
const PAGE_ELEMENT_TARGET = 300;

const BLOCK_TAGS = new Set([
    "P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "TABLE",
    "TBODY", "THEAD", "TFOOT",
    "TR", "BLOCKQUOTE", "PRE", "HR", "SECTION", "ARTICLE", "DL", "DT", "DD", "FIGURE"
]);

const ROWED_TAGS = new Set(["TABLE", "TBODY", "THEAD", "TFOOT", "UL", "OL", "DL"]);
const ROW_TAGS = new Set(["TR", "LI", "DT", "DD"]);

function blockChildren(el: Element): Element[] {
    return Array.from(el.children).filter((child) => BLOCK_TAGS.has(child.tagName));
}

function countElements(el: Element): number {
    return 1 + el.getElementsByTagName("*").length;
}

function stripStamps(el: Element) {
    el.removeAttribute("data-guide-line");
    el.removeAttribute("data-guide-lines");
    el.querySelectorAll("[data-guide-line]").forEach((node) => {
        node.removeAttribute("data-guide-line");
        node.removeAttribute("data-guide-lines");
    });
}

function rangeOf(el: Element): { first: number; last: number } | null {
    const stamped = Array.from(el.querySelectorAll("[data-guide-line]"));
    if (el.hasAttribute("data-guide-line")) {
        stamped.unshift(el);
    }
    if (stamped.length === 0) {
        return null;
    }
    const nums = stamped.map((node) => Number(node.getAttribute("data-guide-line")));
    return { first: Math.min(...nums), last: Math.max(...nums) };
}

type PageUnit = {
    html: string;
    text: string;
    elements: number;
    range: { first: number; last: number } | null;
};

function unitOf(el: Element): PageUnit {
    return {
        html: el.outerHTML,
        text: el.textContent ?? "",
        elements: countElements(el),
        range: rangeOf(el),
    };
}

function splitRowed(el: Element): PageUnit[] | null {
    const bodies = Array.from(el.children).filter((child) => child.tagName === "TBODY");
    const holder = el.tagName === "TABLE" && bodies.length === 1 ? bodies[0] : el;
    const rows = Array.from(holder.children).filter((child) => ROW_TAGS.has(child.tagName));
    if (rows.length < 2) {
        return null;
    }
    const thead = Array.from(el.children).find((child) => child.tagName === "THEAD") ?? null;
    const strays = (parent: Element) => Array.from(parent.children).some(
        (child) => child !== holder && child !== thead && !ROW_TAGS.has(child.tagName)
    );
    if (strays(el) || (holder !== el && strays(holder))) {
        return null;
    }
    let header = thead;
    if (!header && rows[0].tagName === "TR" && rows[0].querySelector("td") === null) {
        header = rows.shift() ?? null;
    }

    const slices: PageUnit[] = [];
    let group: Element[] = [];
    let groupChars = 0;
    let groupElements = 0;

    const flush = () => {
        if (group.length === 0) {
            return;
        }
        const shell = el.cloneNode(false) as Element;
        let head: Element | null = null;
        if (header) {
            head = header.cloneNode(true) as Element;
            if (slices.length > 0) {
                stripStamps(head);
            }
            if (head.tagName === "THEAD") {
                shell.appendChild(head);
                head = null;
            }
        }
        const sink = holder === el ? shell : holder.cloneNode(false) as Element;
        if (sink !== shell) {
            shell.appendChild(sink);
        }
        if (head) {
            sink.appendChild(head);
        }
        group.forEach((row) => sink.appendChild(row));
        slices.push(unitOf(shell));
        group = [];
        groupChars = 0;
        groupElements = 0;
    };

    for (const row of rows) {
        const chars = (row.textContent ?? "").length;
        const elements = countElements(row);
        if (group.length > 0 && (groupChars + chars > PAGE_CHAR_TARGET
            || groupElements + elements > PAGE_ELEMENT_TARGET)) {
            flush();
        }
        group.push(row);
        groupChars += chars;
        groupElements += elements;
    }
    flush();
    return slices;
}

function collectLeafBlocks(host: Element): Element[] {
    const leaves: Element[] = [];
    const walk = (el: Element) => {
        const kids = blockChildren(el);
        if (kids.length === 0) {
            if ((el.textContent ?? "").trim().length > 0) {
                leaves.push(el);
            }
            return;
        }
        kids.forEach(walk);
    };
    blockChildren(host).forEach(walk);
    return leaves;
}

export function chunkFormattedHtml(html: string): GuidePage[] {
    let host: Element | null = null;
    try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        host = doc.body?.firstElementChild ?? null;
    }
    catch {
        return [];
    }
    if (!host) {
        return [];
    }

    collectLeafBlocks(host).forEach((leaf, ordinal) => {
        leaf.setAttribute("data-guide-line", String(ordinal));
        leaf.setAttribute("data-guide-lines", "1");
    });

    const tops = blockChildren(host);
    if (tops.length === 0) {
        return [];
    }

    const units: PageUnit[] = [];
    for (const top of tops) {
        const elements = countElements(top);
        const chars = (top.textContent ?? "").length;
        if ((elements > PAGE_ELEMENT_TARGET || chars > PAGE_CHAR_TARGET) && ROWED_TAGS.has(top.tagName)) {
            const slices = splitRowed(top);
            if (slices) {
                units.push(...slices);
                continue;
            }
        }
        units.push(unitOf(top));
    }

    const pages: GuidePage[] = [];
    let openHtml: string[] = [];
    let openText: string[] = [];
    let openChars = 0;
    let openElements = 0;
    let openFirst = 0;
    let openLast = -1;
    let openStamped = false;

    const closePage = (reason: GuideChunk["reason"]) => {
        pages.push({
            startLine: openFirst,
            endLine: openLast + 1,
            text: openText.join("\n"),
            reason,
            html: openHtml.join(""),
        });
        openHtml = [];
        openText = [];
        openChars = 0;
        openElements = 0;
        openFirst = openLast + 1;
        openStamped = false;
    };

    for (const unit of units) {
        if (openHtml.length > 0 && (openChars + unit.text.length > PAGE_CHAR_TARGET
            || openElements + unit.elements > PAGE_ELEMENT_TARGET)) {
            closePage("blank");
        }
        if (unit.range !== null) {
            if (!openStamped) {
                openFirst = unit.range.first;
                openStamped = true;
            }
            openLast = unit.range.last;
        }
        openHtml.push(unit.html);
        openText.push(unit.text);
        openChars += unit.text.length;
        openElements += unit.elements;
    }

    if (openHtml.length > 0) {
        closePage("end");
    }

    return pages;
}

export function joinFormattedPages(pages: GuidePage[]): string {
    return pages.map((page) => page.html ?? "").join("");
}
