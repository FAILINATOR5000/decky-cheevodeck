export function beginGuardedRun(runIdRef: { current: number }) {
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    let cancelled = false;

    function isCurrentRun() {
        return !cancelled && runIdRef.current === runId;
    }

    function cleanup() {
        cancelled = true;
    }

    return { isCurrentRun, cleanup };
}
