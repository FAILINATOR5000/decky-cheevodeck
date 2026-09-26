let guidesOnOpen = false;

export function requestGuidesOnOpen(): void {
    guidesOnOpen = true;
}

export function takeGuidesOnOpen(): boolean {
    const requested = guidesOnOpen;
    guidesOnOpen = false;
    return requested;
}
