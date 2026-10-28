export function clearedList<T>(current: T[]): T[] {
    return current.length > 0 ? [] : current;
}

export function clearedRecord<T extends object>(current: T): T {
    return Object.keys(current).length > 0 ? ({} as T) : current;
}

export function clearedSet<T>(current: Set<T>): Set<T> {
    return current.size > 0 ? new Set() : current;
}
