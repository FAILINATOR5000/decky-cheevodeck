import type { ScaleStep } from "../types";

let currentTextScale: ScaleStep = "normal";
let currentTitleScale: ScaleStep = "normal";
let currentHeaderScale: ScaleStep = "normal";
let currentBannerScale: ScaleStep = "normal";
let currentModalScale: ScaleStep = "normal";
const GUIDE_ZOOM_MIN = 30;
const GUIDE_ZOOM_MAX = 200;
export const GUIDE_ZOOM_STEP = 5;
export const GUIDE_ZOOM_DEFAULT = 100;
export const GUIDE_MODAL_ZOOM_DEFAULT = 105;
export const TEXT_VIEWER_ZOOM_DEFAULT = 140;

let currentGuideZoom: number = GUIDE_ZOOM_DEFAULT;
let currentGuideModalZoom: number = GUIDE_MODAL_ZOOM_DEFAULT;
let currentTextViewerZoom: number = TEXT_VIEWER_ZOOM_DEFAULT;
let currentAchievementTextScale: ScaleStep = "normal";
let currentCommentsTextScale: ScaleStep = "normal";

export function setCurrentTextScale(step: ScaleStep): void {
    currentTextScale = step;
}

export function getCurrentTextScale(): ScaleStep {
    return currentTextScale;
}

export function setCurrentTitleScale(step: ScaleStep): void {
    currentTitleScale = step;
}

export function getCurrentTitleScale(): ScaleStep {
    return currentTitleScale;
}

export function setCurrentHeaderScale(step: ScaleStep): void {
    currentHeaderScale = step;
}

function getCurrentHeaderScale(): ScaleStep {
    return currentHeaderScale;
}

export function setCurrentBannerScale(step: ScaleStep): void {
    currentBannerScale = step;
}

function getCurrentBannerScale(): ScaleStep {
    return currentBannerScale;
}

export function setCurrentModalScale(step: ScaleStep): void {
    currentModalScale = step;
}

export function getCurrentModalScale(): ScaleStep {
    return currentModalScale;
}

let deviceIsSteamMachine = false;

export function setDeviceIsSteamMachine(value: boolean): void {
    deviceIsSteamMachine = value;
}

export function getDeviceIsSteamMachine(): boolean {
    return deviceIsSteamMachine;
}

let currentLargeViewportBonusEnabled = true;
let currentLargeViewportBonus = 8;

export function setCurrentLargeViewportBonusEnabled(value: boolean): void {
    currentLargeViewportBonusEnabled = value;
}

export function getCurrentLargeViewportBonusEnabled(): boolean {
    return currentLargeViewportBonusEnabled;
}

export function setCurrentLargeViewportBonus(value: number): void {
    currentLargeViewportBonus = value;
}

export function getCurrentLargeViewportBonus(): number {
    return currentLargeViewportBonus;
}

export function clampGuideZoom(percent: number): number {
    if (!Number.isFinite(percent)) {
        return GUIDE_ZOOM_DEFAULT;
    }
    const snapped = Math.round(percent / GUIDE_ZOOM_STEP) * GUIDE_ZOOM_STEP;
    return Math.max(GUIDE_ZOOM_MIN, Math.min(GUIDE_ZOOM_MAX, snapped));
}

export function setCurrentGuideZoom(percent: number): void {
    currentGuideZoom = clampGuideZoom(percent);
}

export function getCurrentGuideZoom(): number {
    return currentGuideZoom;
}

export function setCurrentGuideModalZoom(percent: number): void {
    currentGuideModalZoom = clampGuideZoom(percent);
}

export function getCurrentGuideModalZoom(): number {
    return currentGuideModalZoom;
}

export function setCurrentTextViewerZoom(percent: number): void {
    currentTextViewerZoom = clampGuideZoom(percent);
}

export function getCurrentTextViewerZoom(): number {
    return currentTextViewerZoom;
}

export function setCurrentAchievementTextScale(step: ScaleStep): void {
    currentAchievementTextScale = step;
}

function getCurrentAchievementTextScale(): ScaleStep {
    return currentAchievementTextScale;
}

export function setCurrentCommentsTextScale(step: ScaleStep): void {
    currentCommentsTextScale = step;
}

function getCurrentCommentsTextScale(): ScaleStep {
    return currentCommentsTextScale;
}

export function scaleMultiplier(step: ScaleStep): number {
    if (step === "large") {
        return 1.05;
    }
    if (step === "xlarge") {
        return 1.17;
    }
    if (step === "xxlarge") {
        return 1.30;
    }
    if (step === "xxxlarge") {
        return 1.43;
    }
    return 1.0;
}

export function textSize(base: number): number {
    return base * scaleMultiplier(getCurrentTextScale());
}

export function headerSize(base: number): number {
    return base * scaleMultiplier(getCurrentHeaderScale());
}

export function titleSize(base: number): number {
    return base * scaleMultiplier(getCurrentTitleScale());
}

export function bannerSize(base: number): number {
    return base * scaleMultiplier(getCurrentBannerScale());
}

export function modalSize(base: number): number {
    return base * scaleMultiplier(getCurrentModalScale());
}

export type GuideSurface = "panel" | "modal";

export function guideBodySize(base: number, surface: GuideSurface): number {
    const percent = surface === "modal" ? getCurrentGuideModalZoom() : getCurrentGuideZoom();
    return (base * percent) / 100;
}

function achievementTextMultiplier(step: ScaleStep): number {
    if (step === "large") {
        return 1.04;
    }
    if (step === "xlarge") {
        return 1.13;
    }
    if (step === "xxlarge") {
        return 1.22;
    }
    if (step === "xxxlarge") {
        return 1.32;
    }
    return 1.0;
}

export function achievementBodySize(base: number): number {
    return base * achievementTextMultiplier(getCurrentAchievementTextScale());
}

function commentsTextMultiplier(step: ScaleStep): number {
    if (step === "large") {
        return 1.04;
    }
    if (step === "xlarge") {
        return 1.13;
    }
    if (step === "xxlarge") {
        return 1.22;
    }
    if (step === "xxxlarge") {
        return 1.32;
    }
    return 1.0;
}

export function commentsTextSize(base: number): number {
    return base * commentsTextMultiplier(getCurrentCommentsTextScale());
}
