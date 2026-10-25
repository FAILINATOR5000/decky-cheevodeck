import { HOST_PATTERN, MAX_HOST_LENGTH } from "./adExemptions";

let hosts: string[] = [];

export function legacySiteHostOf(url: string): string {
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
    if (labels.length < 2 || /^\d+$/.test(labels[labels.length - 1])) {
        return "";
    }
    if (labels.length >= 3 && labels[0] === "www") {
        return labels.slice(1).join(".");
    }
    return host;
}

export function isLegacySite(url: string): boolean {
    const host = legacySiteHostOf(url);
    return host !== "" && hosts.includes(host);
}

export function plainUrlOf(url: string): string {
    if (!isLegacySite(url)) {
        return "";
    }
    const parsed = new URL(url);
    if (parsed.port !== "" || parsed.username !== "" || parsed.password !== "") {
        return "";
    }
    parsed.protocol = "http:";
    return parsed.href;
}

export function legacySitePatterns(): string[] {
    const patterns: string[] = [];
    for (const host of hosts) {
        patterns.push(`https://${host}/*`, `https://www.${host}/*`);
    }
    return patterns;
}

export function replaceLegacySiteHosts(next: string[]): void {
    hosts = next;
}
