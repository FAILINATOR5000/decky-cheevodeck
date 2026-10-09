export type MainListOpenTarget = "middle" | "last" | "row689";

let pending: MainListOpenTarget | null = null;

export function armMainListOpenAt(target: MainListOpenTarget): void {
    pending = target;
}

export function takeMainListOpenAt(): MainListOpenTarget | null {
    const target = pending;
    pending = null;
    return target;
}

export function mainListOpenIndex(target: MainListOpenTarget, count: number): number {
    if (target === "middle") {
        return Math.floor(count / 2);
    }
    if (target === "last") {
        return count - 1;
    }
    return Math.min(688, count - 1);
}
