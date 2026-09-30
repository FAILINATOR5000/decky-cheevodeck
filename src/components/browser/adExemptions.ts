let hosts: string[] = [];

const MAX_HOST_LENGTH = 253;

const HOST_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOST_PATTERN = new RegExp(`^${HOST_LABEL}(?:\\.${HOST_LABEL})*$`);

export function siteOf(url: string): string {
    let parsed: URL;
    try {
        parsed = new URL(url);
    }
    catch {
        return "";
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "";
    }
    let host = parsed.hostname.toLowerCase();
    if (host.endsWith(".")) {
        host = host.slice(0, -1);
    }
    if (host.length > MAX_HOST_LENGTH || !HOST_PATTERN.test(host)) {
        return "";
    }
    const labels = host.split(".");
    if (labels.length >= 3 && (labels[0] === "www" || labels[0] === "m")) {
        return labels.slice(1).join(".");
    }
    return host;
}

export function exemptEntryFor(url: string): string {
    const site = siteOf(url);
    if (!site) {
        return "";
    }
    let found = "";
    for (const entry of hosts) {
        if ((site === entry || site.endsWith("." + entry)) && entry.length > found.length) {
            found = entry;
        }
    }
    return found;
}

export function isAdExempt(url: string): boolean {
    return exemptEntryFor(url) !== "";
}

export function replaceAdExemptionHosts(next: string[]): void {
    hosts = next;
}
