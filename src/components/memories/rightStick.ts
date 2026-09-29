const ANALOG_SCROLL = 47;

const TRAVEL_PER_STEP = 800;

const REST_MS = 80;

export function watchRightStick(onStep: (direction: 1 | -1) => void): () => void {
    const input = SteamClient?.Input;
    if (!input?.RegisterForControllerAnalogInputMessages || !input?.EnableControllerAnalogInputMessages) {
        return () => undefined;
    }

    let lastX: number | null = null;
    let lastY = 0;
    let lastAt = 0;
    let travel = 0;
    let held: 1 | -1 | 0 = 0;

    const registration = input.RegisterForControllerAnalogInputMessages(
        (_controller: number, kind: number, _down: boolean, x: number, y: number) => {
            if (kind !== ANALOG_SCROLL || typeof x !== "number" || typeof y !== "number") {
                return;
            }
            const now = performance.now();
            const resting = now - lastAt > REST_MS;
            lastAt = now;
            const previousX = lastX;
            const previousY = lastY;
            lastX = x;
            lastY = y;
            if (previousX === null) {
                return;
            }
            const dx = x - previousX;
            const dy = y - previousY;
            if (dx === 0 || Math.abs(dx) <= Math.abs(dy)) {
                return;
            }
            const direction = dx > 0 ? 1 : -1;
            if (resting || direction !== held) {
                held = direction;
                travel = 0;
                onStep(direction);
                return;
            }
            travel += Math.abs(dx);
            if (travel >= TRAVEL_PER_STEP) {
                travel -= TRAVEL_PER_STEP;
                onStep(direction);
            }
        }
    );
    input.EnableControllerAnalogInputMessages(true);

    return () => {
        registration?.unregister?.();
        input.EnableControllerAnalogInputMessages(false);
    };
}
