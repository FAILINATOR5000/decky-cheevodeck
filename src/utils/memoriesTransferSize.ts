const MEGABYTE = 1024 * 1024;

const GIGABYTE = 1024 * 1024 * 1024;

export function transferSizeLabel(bytes: number): string {
    if (bytes <= 0) {
        return "0 MB";
    }
    if (bytes >= GIGABYTE) {
        return `${(bytes / GIGABYTE).toFixed(1)} GB`;
    }
    return `${Math.max(1, Math.round(bytes / MEGABYTE))} MB`;
}
