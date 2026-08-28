import type { ShortcutButton } from "../types";

export const BUTTON_SECONDARY = 3;
export const BUTTON_OPTIONS = 4;
export const BUTTON_BUMPER_LEFT = 5;
export const BUTTON_BUMPER_RIGHT = 6;
export const BUTTON_TRIGGER_LEFT = 7;
export const BUTTON_TRIGGER_RIGHT = 8;
export const BUTTON_DIR_UP = 9;
export const BUTTON_DIR_DOWN = 10;
const BUTTON_SELECT = 13;
const BUTTON_START = 14;
const BUTTON_LSTICK_CLICK = 15;
const BUTTON_RSTICK_CLICK = 16;
const BUTTON_REAR_LEFT_UPPER = 23;
const BUTTON_REAR_LEFT_LOWER = 24;
const BUTTON_REAR_RIGHT_UPPER = 25;
const BUTTON_REAR_RIGHT_LOWER = 26;

export const SHORTCUT_BUTTON_BY_CODE: Record<number, ShortcutButton> = {
    [BUTTON_START]: "menu",
    [BUTTON_SELECT]: "view",
    [BUTTON_LSTICK_CLICK]: "l3",
    [BUTTON_RSTICK_CLICK]: "r3",
    [BUTTON_REAR_LEFT_UPPER]: "l4",
    [BUTTON_REAR_LEFT_LOWER]: "l5",
    [BUTTON_REAR_RIGHT_UPPER]: "r4",
    [BUTTON_REAR_RIGHT_LOWER]: "r5"
};
