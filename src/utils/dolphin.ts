import { t, type LanguageCode } from "../locales";
import type {
    ControllerType,
    DolphinMapping,
    DolphinMapperMode,
    DolphinSystem,
    DolphinSystemFilter,
    FaceLayout,
    RumbleMotor,
    SidewaysDirections,
    WiiStyle
} from "../types";
import { parseNoteTag } from "./achievements";


export function nextDolphinMapperMode(current: DolphinMapperMode, count: number): DolphinMapperMode {
    const reorderAvailable = count >= 2;
    if (current === "map") {
        return "edit";
    }
    if (current === "edit") {
        return "delete";
    }
    if (current === "delete") {
        return reorderAvailable ? "reorder" : "map";
    }
    return "map";
}

export function dolphinMapperModeLabel(mode: DolphinMapperMode, language: LanguageCode): string {
    switch (mode) {
        case "map":
            return t(language, "Map");
        case "edit":
            return t(language, "Edit");
        case "delete":
            return t(language, "Delete");
        case "reorder":
            return t(language, "Reorder");
        default:
            return t(language, "Map");
    }
}

export function nextDolphinSystemFilter(current: DolphinSystemFilter): DolphinSystemFilter {
    const order: DolphinSystemFilter[] = ["all", "wii", "gamecube"];
    return order[(order.indexOf(current) + 1) % order.length];
}

export function dolphinSystemFilterLabel(value: DolphinSystemFilter, language: LanguageCode): string {
    if (value === "wii") {
        return t(language, "Wii");
    }
    if (value === "gamecube") {
        return t(language, "GameCube");
    }
    return t(language, "All");
}

function dolphinSystemLabel(system: DolphinSystem, language: LanguageCode): string {
    return system === "wii" ? t(language, "Wii") : t(language, "GameCube");
}

export function wiiStyleLabel(style: WiiStyle, language: LanguageCode): string {
    switch (style) {
        case "wiimote_nunchuk":
            return t(language, "Wiimote + Nunchuk");
        case "classic":
            return t(language, "Classic Controller");
        case "wiimote_sideways":
        default:
            return t(language, "Wiimote (Sideways)");
    }
}

export const REAL_WIIMOTE: ControllerType = "realwiimote";

export function controllerTypeLabel(type: ControllerType, language: LanguageCode): string {
    switch (type) {
        case "realwiimote":
            return t(language, "Real Wii Remote");
        case "rogally":
            return t(language, "ROG Ally");
        case "steamcontroller":
            return t(language, "Steam Controller");
        case "xbox":
            return t(language, "Xbox Series X");
        case "xboxone":
            return t(language, "Xbox One");
        case "xbox360":
            return t(language, "Xbox 360 Wireless Controller");
        case "dualsense":
            return t(language, "DualSense");
        case "ps4":
            return t(language, "PS4 Controller");
        case "switchpro":
            return t(language, "Switch Pro Controller");
        case "steamdeck":
        default:
            return t(language, "Steam Deck");
    }
}

const NINTENDO_STYLE_CONTROLLERS: ReadonlySet<ControllerType> = new Set(["switchpro"]);

function isNintendoStyleController(type: ControllerType): boolean {
    return NINTENDO_STYLE_CONTROLLERS.has(type);
}

export function aaFaceLayout(type: ControllerType): FaceLayout {
    return isNintendoStyleController(type) ? "standard" : "literal";
}

export function faceLayoutLabel(layout: FaceLayout, controllerType: ControllerType, language: LanguageCode): string {
    if (isNintendoStyleController(controllerType)) {
        return layout === "literal" ? t(language, "Swapped (Xbox)") : t(language, "Standard (A = A)");
    }
    if (layout === "swap_ab") {
        return t(language, "Nintendo (Swap A/B Only)");
    }
    if (layout === "swap_xy") {
        return t(language, "Nintendo (Swap X/Y Only)");
    }
    return layout === "literal" ? t(language, "Literal (A = A)") : t(language, "Standard (Nintendo)");
}

export function nextFaceLayout(current: FaceLayout, controllerType: ControllerType): FaceLayout {
    const order: FaceLayout[] = isNintendoStyleController(controllerType)
        ? ["standard", "literal"]
        : ["standard", "literal", "swap_ab", "swap_xy"];
    const index = order.indexOf(current);
    return index < 0 ? order[0] : order[(index + 1) % order.length];
}

export const DEFAULT_RUMBLE_STRENGTH = 100;
export const DEFAULT_RUMBLE_MOTOR: RumbleMotor = "both";

export const DEFAULT_DEADZONE = 0;
export const DEADZONE_MAX = 50;

export const DEFAULT_IR_DEADZONE = 10;
export const DEFAULT_IR_TOTAL_YAW = 25;
export const DEFAULT_IR_TOTAL_PITCH = 20;
export const DEFAULT_IR_VERTICAL_OFFSET = 10;
export const DEFAULT_IR_RELATIVE_INPUT = true;
export const DEFAULT_IR_AUTO_HIDE = false;
export const IR_SWEEP_MAX = 90;
export const IR_OFFSET_MIN = 0;
export const IR_OFFSET_MAX = 30;

const RUMBLE_MOTOR_OPTIONS: RumbleMotor[] = ["both", "left", "right"];

export function nextRumbleMotor(current: RumbleMotor): RumbleMotor {
    const index = RUMBLE_MOTOR_OPTIONS.indexOf(current);
    const from = index < 0 ? RUMBLE_MOTOR_OPTIONS.indexOf(DEFAULT_RUMBLE_MOTOR) : index;
    return RUMBLE_MOTOR_OPTIONS[(from + 1) % RUMBLE_MOTOR_OPTIONS.length];
}

export function rumbleMotorLabel(motor: RumbleMotor, language: LanguageCode): string {
    switch (motor) {
        case "left":
            return t(language, "Left Motor");
        case "right":
            return t(language, "Right Motor");
        case "both":
        default:
            return t(language, "Both Motors");
    }
}

export function mappingSummary(mapping: DolphinMapping, language: LanguageCode): string {
    const parts: string[] = [dolphinSystemLabel(mapping.system, language)];
    const allReal = mapping.players.length > 0
        && mapping.players.every((player) => player.controllerType === REAL_WIIMOTE);
    if (mapping.system === "wii" && mapping.wiiStyle && !allReal) {
        parts.push(wiiStyleLabel(mapping.wiiStyle, language));
    }
    const count = mapping.players.length;
    parts.push(t(language, "{{count}} player(s)", { count }));
    return parts.join(" · ");
}

export function slotShowsCameraInvert(mapping: { system: DolphinSystem }): boolean {
    return mapping.system === "gamecube";
}
export function slotShowsFaceLayout(mapping: { system: DolphinSystem; wiiStyle?: WiiStyle }): boolean {
    if (mapping.system === "gamecube") {
        return true;
    }
    return mapping.system === "wii" && (mapping.wiiStyle === "classic" || mapping.wiiStyle === "wiimote_nunchuk");
}
export function slotShowsTriggerSwap(mapping: { system: DolphinSystem; wiiStyle?: WiiStyle }): boolean {
    return mapping.system === "wii" && mapping.wiiStyle === "classic";
}
export function slotShowsLeftDeadzone(mapping: { system: DolphinSystem; wiiStyle?: WiiStyle }): boolean {
    if (mapping.system === "gamecube") {
        return true;
    }
    return mapping.wiiStyle === "classic" || mapping.wiiStyle === "wiimote_nunchuk";
}
export function slotShowsRightDeadzone(mapping: { system: DolphinSystem; wiiStyle?: WiiStyle }): boolean {
    return mapping.system === "gamecube" || mapping.wiiStyle === "classic";
}
export function slotShowsSidewaysDirections(mapping: { system: DolphinSystem; wiiStyle?: WiiStyle }): boolean {
    return mapping.system === "wii" && mapping.wiiStyle === "wiimote_sideways";
}
export function slotShowsPointer(mapping: { system: DolphinSystem; wiiStyle?: WiiStyle }): boolean {
    return mapping.system === "wii" && mapping.wiiStyle === "wiimote_nunchuk";
}

const SIDEWAYS_DIRECTION_OPTIONS: SidewaysDirections[] = ["both", "dpad", "stick"];

export const DEFAULT_SIDEWAYS_DIRECTIONS: SidewaysDirections = "both";

export function nextSidewaysDirections(current: SidewaysDirections): SidewaysDirections {
    const index = SIDEWAYS_DIRECTION_OPTIONS.indexOf(current);
    return index < 0
        ? DEFAULT_SIDEWAYS_DIRECTIONS
        : SIDEWAYS_DIRECTION_OPTIONS[(index + 1) % SIDEWAYS_DIRECTION_OPTIONS.length];
}

export function sidewaysDirectionsLabel(value: SidewaysDirections, language: LanguageCode): string {
    switch (value) {
        case "dpad":
            return t(language, "D-Pad Only");
        case "stick":
            return t(language, "Left Stick Only");
        case "both":
        default:
            return t(language, "D-Pad + Left Stick");
    }
}

const UNTAGGED_COLLAPSE_KEY = "__UNTAGGED__";

export type MappingGroup = {
    tag: string | null;
    header: string;
    key: string;
    mappings: DolphinMapping[];
};

export function groupMappingsByTag(mappings: DolphinMapping[], language: LanguageCode): MappingGroup[] {
    const groups: MappingGroup[] = [];
    const byKey = new Map<string, MappingGroup>();
    const untagged: DolphinMapping[] = [];

    for (const mapping of mappings) {
        const parsed = parseNoteTag(mapping.name);
        if (!parsed.tag || !parsed.tagKey) {
            untagged.push(mapping);
            continue;
        }
        let group = byKey.get(parsed.tagKey);
        if (!group) {
            group = { tag: parsed.tag, header: parsed.tag, key: parsed.tagKey, mappings: [] };
            byKey.set(parsed.tagKey, group);
            groups.push(group);
        }
        group.mappings.push(mapping);
    }

    groups.push({
        tag: null,
        header: t(language, "Mappings ({{count}})", { count: untagged.length }),
        key: UNTAGGED_COLLAPSE_KEY,
        mappings: untagged
    });

    return groups.filter((group) => group.mappings.length > 0 || group.tag !== null);
}
