export const REVEAL_GRACE_MS = 60;

export const REVEAL_FADE_MS = 240;

export const REVEAL_DEADLINE_MS = 400;

export const PRESS_GUARD_CEILING_MS = 600;

export type LandingTiming = {
    revealGraceMs: number;
    revealFadeMs: number;
    revealDeadlineMs: number;
    pressGuardCeilingMs: number;
};

export const LANDING_TIMING: LandingTiming = {
    revealGraceMs: REVEAL_GRACE_MS,
    revealFadeMs: REVEAL_FADE_MS,
    revealDeadlineMs: REVEAL_DEADLINE_MS,
    pressGuardCeilingMs: PRESS_GUARD_CEILING_MS
};
