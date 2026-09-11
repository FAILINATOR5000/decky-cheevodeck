import type { ReorderDirection } from "../types";

export type ReorderDestination = (groupOrder: number[], fromIndex: number) => number;

export function stepTo(direction: ReorderDirection): ReorderDestination {
    return (groupOrder, fromIndex) => {
        if (direction === "top") {
            return 0;
        }
        if (direction === "bottom") {
            return groupOrder.length - 1;
        }
        if (direction === "up") {
            return fromIndex - 1;
        }
        return fromIndex + 1;
    };
}

export function landOn(landedId: number): ReorderDestination {
    return (groupOrder) => groupOrder.indexOf(landedId);
}

export function orderAfterGroupMove(
    current: number[],
    groupIds: number[] | null,
    targetId: number,
    destination: ReorderDestination
): number[] | null {
    const grouped = groupIds !== null && groupIds.length > 0;
    const working = grouped ? groupIds.slice() : current.slice();

    const fromIndex = working.indexOf(targetId);
    if (fromIndex < 0) {
        return null;
    }

    const toIndex = destination(working, fromIndex);
    if (toIndex < 0 || toIndex >= working.length || toIndex === fromIndex) {
        return null;
    }

    const rearranged = working.slice();
    rearranged.splice(fromIndex, 1);
    rearranged.splice(toIndex, 0, targetId);

    if (!grouped) {
        return rearranged;
    }

    const membership = new Set(groupIds);
    const rearrangedIter = rearranged[Symbol.iterator]();
    return current.map((id) => {
        if (!membership.has(id)) {
            return id;
        }
        const next = rearrangedIter.next();
        return next.done ? id : next.value;
    });
}

export function liveOrder(pending: number[] | null, live: number[]): number[] {
    if (pending === null || pending.length !== live.length) {
        return live;
    }
    const held = new Set(pending);
    return live.every((id) => held.has(id)) ? pending.slice() : live;
}
