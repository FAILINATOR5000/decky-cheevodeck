import type { ReorderDirection } from "../types";

export type ReorderDestination<Id> = (groupOrder: Id[], fromIndex: number) => number;

export function stepTo<Id>(direction: ReorderDirection): ReorderDestination<Id> {
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

export function landOn<Id>(landedId: Id): ReorderDestination<Id> {
    return (groupOrder) => groupOrder.indexOf(landedId);
}

export function orderAfterGroupMove<Id>(
    current: Id[],
    groupIds: Id[] | null,
    targetId: Id,
    destination: ReorderDestination<Id>
): Id[] | null {
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

export function liveOrder<Id>(pending: Id[] | null, live: Id[]): Id[] {
    if (pending === null || pending.length !== live.length) {
        return live;
    }
    const held = new Set(pending);
    return live.every((id) => held.has(id)) ? pending.slice() : live;
}
