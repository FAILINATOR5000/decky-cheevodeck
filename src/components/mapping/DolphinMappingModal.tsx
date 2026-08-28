import { DialogButton, Focusable, ModalRoot, SliderField, TextField } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import { ErrorText } from "../ui/ErrorText";
import { FocusableItem } from "../ui/FocusableItem";
import { helpDescription } from "../ui/InfoText";
import { LabeledRow } from "../ui/LabeledRow";
import { ToggleRow } from "../ui/ToggleRow";
import { localizeRuntimeText, t, type LanguageCode } from "../../locales";
import type {
    ControllerType,
    DolphinMapping,
    DolphinMappingInput,
    DolphinMappingResponse,
    DolphinSystem,
    FaceLayout,
    MappingPlayer,
    WiiStyle
} from "../../types";
import { applyTagToNoteBody, parseNoteTag } from "../../utils/achievements";
import {
    controllerTypeLabel,
    aaFaceLayout,
    faceLayoutLabel,
    nextFaceLayout,
    nextRumbleMotor,
    nextSidewaysDirections,
    rumbleMotorLabel,
    sidewaysDirectionsLabel,
    slotShowsCameraInvert,
    slotShowsFaceLayout,
    slotShowsLeftDeadzone,
    slotShowsPointer,
    slotShowsRightDeadzone,
    slotShowsSidewaysDirections,
    slotShowsTriggerSwap,
    wiiStyleLabel,
    DEADZONE_MAX,
    DEFAULT_DEADZONE,
    DEFAULT_IR_AUTO_HIDE,
    DEFAULT_IR_DEADZONE,
    DEFAULT_IR_RELATIVE_INPUT,
    DEFAULT_IR_TOTAL_PITCH,
    DEFAULT_IR_TOTAL_YAW,
    DEFAULT_IR_VERTICAL_OFFSET,
    DEFAULT_SIDEWAYS_DIRECTIONS,
    DEFAULT_RUMBLE_MOTOR,
    DEFAULT_RUMBLE_STRENGTH,
    IR_OFFSET_MAX,
    IR_OFFSET_MIN,
    IR_SWEEP_MAX,
    REAL_WIIMOTE
} from "../../utils/dolphin";
import { modalSize } from "../../utils/scale";
import { compactButtonStyle } from "../../utils/style";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

const MAPPING_NAME_MAX_LEN = 100;
const MAX_PLAYERS = 4;

const DOLPHIN_TAG_SEEDS: ReadonlyArray<{ key: string; tag: string }> = [
    { key: "dolphin_tag_seed_common", tag: "Common" },
    { key: "dolphin_tag_seed_custom", tag: "Custom" },
    { key: "dolphin_tag_seed_singleplayer", tag: "Single Player" },
    { key: "dolphin_tag_seed_multiplayer", tag: "Multiplayer" }
];

const SYSTEM_OPTIONS: DolphinSystem[] = ["gamecube", "wii"];
const WII_STYLE_OPTIONS: WiiStyle[] = ["wiimote_sideways", "wiimote_nunchuk", "classic"];
const CONTROLLER_OPTIONS: ControllerType[] = ["steamdeck", "steamcontroller", "rogally", "xbox", "xboxone", "dualsense", "ps4", "switchpro"];

function controllerOptions(system: DolphinSystem): ControllerType[] {
    return system === "wii" ? [...CONTROLLER_OPTIONS, REAL_WIIMOTE] : CONTROLLER_OPTIONS;
}

type SaveMappingFn = (input: DolphinMappingInput) => Promise<DolphinMappingResponse>;

export type DolphinMappingModalProps = {
    existing: DolphinMapping | null;
    language: LanguageCode;
    saveMapping: SaveMappingFn;
    close: () => void;
};

type Step = "form" | "controller";

function newSlot(controllerType: ControllerType): MappingPlayer {
    return {
        controllerType,
        wireless: true,
        invertCamX: false,
        invertCamY: false,
        faceLayout: aaFaceLayout(controllerType),
        triggerSwap: false,
        rumbleStrength: DEFAULT_RUMBLE_STRENGTH,
        rumbleMotor: DEFAULT_RUMBLE_MOTOR,
        leftStickDeadzone: DEFAULT_DEADZONE,
        rightStickDeadzone: DEFAULT_DEADZONE,
        sidewaysDirections: DEFAULT_SIDEWAYS_DIRECTIONS,
        irDeadzone: DEFAULT_IR_DEADZONE,
        irTotalYaw: DEFAULT_IR_TOTAL_YAW,
        irTotalPitch: DEFAULT_IR_TOTAL_PITCH,
        irVerticalOffset: DEFAULT_IR_VERTICAL_OFFSET,
        irRelativeInput: DEFAULT_IR_RELATIVE_INPUT,
        irAutoHide: DEFAULT_IR_AUTO_HIDE
    };
}

const RUMBLE_STEP = 5;
const RUMBLE_NOTCH_COUNT = 21;

export function DolphinMappingModal(props: DolphinMappingModalProps) {
    const { existing, language, saveMapping, close } = props;

    const [step, setStep] = useState<Step>("form");
    const [pickerIndex, setPickerIndex] = useState<number | null>(null);

    const [name, setName] = useState(existing?.name ?? "");
    const [bodyText, setBodyText] = useState(existing?.body ?? "");
    const [system, setSystem] = useState<DolphinSystem>(existing?.system ?? "gamecube");
    const [wiiStyle, setWiiStyle] = useState<WiiStyle>(existing?.wiiStyle ?? "wiimote_sideways");
    const [players, setPlayers] = useState<MappingPlayer[]>(
        existing?.players?.length ? existing.players.map((p) => ({ ...p })) : []
    );
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const bodyRef = useRef<HTMLDivElement | null>(null);
    const focusedTopForStepRef = useRef<Step | null>(null);
    const pendingFocusKeyRef = useRef<string | null>(null);

    useEffect(function focusStep() {
        const root = bodyRef.current;
        if (!root) {
            return;
        }
        const pending = pendingFocusKeyRef.current;
        if (pending) {
            const target = root.querySelector(
                `[data-focus-key="${pending}"] input, [data-focus-key="${pending}"] button, [data-focus-key="${pending}"] [tabindex]`
            ) as HTMLElement | null;
            if (target) {
                pendingFocusKeyRef.current = null;
                focusedTopForStepRef.current = step;
                target.focus();
                return;
            }
        }
        if (focusedTopForStepRef.current === step) {
            return;
        }
        const prefix = step === "controller" ? "dmapctrl:" : "dmapform:";
        const firstRow = root.querySelector(
            `[data-focus-key^="${prefix}"] input, [data-focus-key^="${prefix}"] button, [data-focus-key^="${prefix}"] [tabindex]`
        ) as HTMLElement | null;
        if (!firstRow) {
            return;
        }
        focusedTopForStepRef.current = step;
        firstRow.focus();
    }, [step, players.length]);

    const currentBodyTag = parseNoteTag(name).tag;

    function applyTag(tag: string | null) {
        const next = applyTagToNoteBody(name, tag);
        setName(next.slice(0, MAPPING_NAME_MAX_LEN));
    }

    function updatePlayer(index: number, patch: Partial<MappingPlayer>) {
        setPlayers((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
    }

    function removePlayer(index: number) {
        const remaining = players.length - 1;
        if (remaining <= 0) {
            pendingFocusKeyRef.current = "dmapform:add-controller";
        }
        else if (index >= remaining) {
            pendingFocusKeyRef.current = `dmapform:slot:${index - 1}:type`;
        }
        else {
            pendingFocusKeyRef.current = `dmapform:slot:${index}:type`;
        }
        setPlayers((prev) => prev.filter((_, i) => i !== index));
    }

    function cycleSystem() {
        const next = SYSTEM_OPTIONS[(SYSTEM_OPTIONS.indexOf(system) + 1) % SYSTEM_OPTIONS.length];
        setSystem(next);
        if (next !== "wii") {
            setPlayers((prev) => prev.map((p) => (
                p.controllerType === REAL_WIIMOTE ? { ...p, controllerType: "steamdeck" } : p
            )));
        }
    }

    function openPicker(index: number | null) {
        setPickerIndex(index);
        focusedTopForStepRef.current = null;
        setStep("controller");
    }

    function chooseType(type: ControllerType) {
        if (pickerIndex === null) {
            pendingFocusKeyRef.current = `dmapform:slot:${players.length}:type`;
            setPlayers((prev) => [...prev, newSlot(type)]);
        }
        else {
            pendingFocusKeyRef.current = `dmapform:slot:${pickerIndex}:type`;
            updatePlayer(pickerIndex, { controllerType: type });
        }
        focusedTopForStepRef.current = null;
        setStep("form");
    }

    async function handleSave() {
        if (saving) {
            return;
        }
        if (players.length === 0) {
            setError(t(language, "Add at least one controller."));
            return;
        }
        setSaving(true);
        setError(null);

        const input: DolphinMappingInput = {
            id: existing?.id,
            name: name.trim(),
            body: bodyText.trim(),
            system,
            players: players.map((p) => ({ ...p }))
        };
        if (system === "wii") {
            input.wiiStyle = wiiStyle;
        }

        const result = await saveMapping(input);
        if (result?.ok) {
            close();
            return;
        }
        setSaving(false);
        setError(t(language, "Couldn't save the mapping."));
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <SaveOnStart
                canSave={step === "form" && !saving && players.length > 0}
                label={t(language, "Save")}
                onSave={handleSave}
            >
                <div ref={bodyRef}>
                    {step === "controller" ? (
                        <ControllerStep
                            language={language}
                            options={controllerOptions(system)}
                            onChoose={chooseType}
                            onBack={() => {
                                focusedTopForStepRef.current = null;
                                setStep("form");
                            }}
                        />
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700 }}>
                                {existing
                                    ? t(language, "Edit Mapping")
                                    : t(language, "New Mapping")}
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                <div style={{ fontSize: `${modalSize(13)}px`, fontWeight: 700, opacity: 0.7 }}>
                                    {t(language, "Name:")}
                                </div>
                                <div data-focus-key="dmapform:name">
                                    <TextField
                                        value={name}
                                        onChange={(e: any) => setName((e?.target?.value ?? "").slice(0, MAPPING_NAME_MAX_LEN))}
                                        disabled={saving}
                                    />
                                </div>
                                <Focusable
                                    style={{ display: "flex", flexDirection: "row", gap: "8px", flexWrap: "wrap", alignItems: "center" }}
                                    flow-children="grid"
                                >
                                    {DOLPHIN_TAG_SEEDS.map((seed) => (
                                        <div key={seed.key} data-focus-key={`dmaptag:${seed.key}`}>
                                            <DialogButton
                                                onClick={() => applyTag(seed.tag)}
                                                disabled={saving}
                                                style={compactButtonStyle}
                                            >
                                                {t(language, seed.key)}
                                            </DialogButton>
                                        </div>
                                    ))}
                                    {currentBodyTag && (
                                        <div data-focus-key="dmaptag:clear">
                                            <DialogButton
                                                onClick={() => applyTag(null)}
                                                disabled={saving}
                                                style={{ ...compactButtonStyle, opacity: 0.75 }}
                                            >
                                                {t(language, "Clear tag")}
                                            </DialogButton>
                                        </div>
                                    )}
                                </Focusable>
                            </div>

                            <LabeledRow
                                focusKey="dmapform:system"
                                label={t(language, "System")}
                                value={system === "wii" ? t(language, "Wii") : t(language, "GameCube")}
                                disabled={saving}
                                onClick={cycleSystem}
                            />

                            {system === "wii" && (
                                <LabeledRow
                                    focusKey="dmapform:wiistyle"
                                    label={t(language, "Wii Style")}
                                    value={wiiStyleLabel(wiiStyle, language)}
                                    disabled={saving}
                                    onClick={() => {
                                        setWiiStyle((prev) => WII_STYLE_OPTIONS[(WII_STYLE_OPTIONS.indexOf(prev) + 1) % WII_STYLE_OPTIONS.length]);
                                    }}
                                />
                            )}

                            {}
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                <div style={{ fontSize: `${modalSize(13)}px`, fontWeight: 700, opacity: 0.7 }}>
                                    {t(language, "Notes:")}
                                </div>
                                <div data-focus-key="dmapform:body">
                                    <TextField
                                        value={bodyText}
                                        onChange={(e: any) => setBodyText(e?.target?.value ?? "")}
                                        disabled={saving}
                                    />
                                </div>
                            </div>

                            <div style={{ fontSize: `${modalSize(13)}px`, fontWeight: 700, opacity: 0.7 }}>
                                {t(language, "Controllers ({{count}}/4)", { count: players.length })}
                            </div>
                            {players.map((slot, index) => (
                                <div
                                    key={index}
                                    style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "4px",
                                        padding: "6px 8px",
                                        borderRadius: "6px",
                                        background: "rgba(255,255,255,0.05)"
                                    }}
                                >
                                    <div style={{ fontWeight: 600, fontSize: `${modalSize(13)}px` }}>
                                        {t(language, "Player {{n}}", { n: index + 1 })}
                                    </div>
                                    <LabeledRow
                                        focusKey={`dmapform:slot:${index}:type`}
                                        label={t(language, "Controller")}
                                        value={controllerTypeLabel(slot.controllerType, language)}
                                        disabled={saving}
                                        onClick={() => openPicker(index)}
                                        help={slot.controllerType === REAL_WIIMOTE
                                            ? t(language, "help_real_wiimote_slot")
                                            : undefined}
                                        modalHelp
                                    />
                                    {slot.controllerType !== REAL_WIIMOTE && (
                                        <>
                                            {slotShowsCameraInvert({ system }) && (
                                                <>
                                                    <ToggleRow
                                                        label={t(language, "Invert Cam X")}
                                                        value={!!slot.invertCamX}
                                                        disabled={saving}
                                                        bottomSeparator="none"
                                                        onChange={(v) => updatePlayer(index, { invertCamX: v })}
                                                    />
                                                    <ToggleRow
                                                        label={t(language, "Invert Cam Y")}
                                                        value={!!slot.invertCamY}
                                                        disabled={saving}
                                                        bottomSeparator="none"
                                                        onChange={(v) => updatePlayer(index, { invertCamY: v })}
                                                    />
                                                </>
                                            )}
                                            {slotShowsFaceLayout({ system, wiiStyle }) && (
                                                <LabeledRow
                                                    focusKey={`dmapform:slot:${index}:face`}
                                                    label={t(language, "Face Layout")}
                                                    value={faceLayoutLabel((slot.faceLayout ?? "standard") as FaceLayout, slot.controllerType, language)}
                                                    disabled={saving}
                                                    onClick={() => updatePlayer(index, {
                                                        faceLayout: nextFaceLayout((slot.faceLayout ?? "standard") as FaceLayout, slot.controllerType)
                                                    })}
                                                />
                                            )}
                                            {slotShowsTriggerSwap({ system, wiiStyle }) && (
                                                <ToggleRow
                                                    label={t(language, "Trigger Swap")}
                                                    value={!!slot.triggerSwap}
                                                    disabled={saving}
                                                    bottomSeparator="none"
                                                    onChange={(v) => updatePlayer(index, { triggerSwap: v })}
                                                />
                                            )}
                                            {
}
                                            {slotShowsSidewaysDirections({ system, wiiStyle }) && (
                                                <LabeledRow
                                                    focusKey={`dmapform:slot:${index}:directions`}
                                                    label={t(language, "Map Directions")}
                                                    value={sidewaysDirectionsLabel(slot.sidewaysDirections ?? DEFAULT_SIDEWAYS_DIRECTIONS, language)}
                                                    disabled={saving}
                                                    onClick={() => updatePlayer(index, {
                                                        sidewaysDirections: nextSidewaysDirections(slot.sidewaysDirections ?? DEFAULT_SIDEWAYS_DIRECTIONS)
                                                    })}
                                                />
                                            )}
                                            {
}
                                            {slotShowsLeftDeadzone({ system, wiiStyle }) && (
                                                <div data-focus-key={`dmapform:slot:${index}:deadzone-left`}>
                                                    <SliderField
                                                        label={t(language, "Left Stick Deadzone")}
                                                        value={slot.leftStickDeadzone ?? DEFAULT_DEADZONE}
                                                        min={0}
                                                        max={DEADZONE_MAX}
                                                        step={1}
                                                        valueSuffix="%"
                                                        showValue
                                                        bottomSeparator="none"
                                                        disabled={saving}
                                                        onChange={(v) => updatePlayer(index, { leftStickDeadzone: v })}
                                                    />
                                                </div>
                                            )}
                                            {slotShowsRightDeadzone({ system, wiiStyle }) && (
                                                <div data-focus-key={`dmapform:slot:${index}:deadzone-right`}>
                                                    <SliderField
                                                        label={t(language, "Right Stick Deadzone")}
                                                        value={slot.rightStickDeadzone ?? DEFAULT_DEADZONE}
                                                        min={0}
                                                        max={DEADZONE_MAX}
                                                        step={1}
                                                        valueSuffix="%"
                                                        showValue
                                                        bottomSeparator="none"
                                                        disabled={saving}
                                                        onChange={(v) => updatePlayer(index, { rightStickDeadzone: v })}
                                                    />
                                                </div>
                                            )}
                                            {
}
                                            {slotShowsPointer({ system, wiiStyle }) && (
                                                <>
                                                    <div data-focus-key={`dmapform:slot:${index}:ir-deadzone`}>
                                                        <SliderField
                                                            label={t(language, "Right Stick Deadzone")}
                                                            value={slot.irDeadzone ?? DEFAULT_IR_DEADZONE}
                                                            min={0}
                                                            max={DEADZONE_MAX}
                                                            step={1}
                                                            valueSuffix="%"
                                                            showValue
                                                            bottomSeparator="none"
                                                            disabled={saving}
                                                            onChange={(v) => updatePlayer(index, { irDeadzone: v })}
                                                        />
                                                    </div>
                                                    <div data-focus-key={`dmapform:slot:${index}:ir-yaw`}>
                                                        <SliderField
                                                            label={t(language, "Pointer Yaw")}
                                                            description={helpDescription(t(language, "help_ir_yaw"), true)}
                                                            value={slot.irTotalYaw ?? DEFAULT_IR_TOTAL_YAW}
                                                            min={0}
                                                            max={IR_SWEEP_MAX}
                                                            step={1}
                                                            valueSuffix="°"
                                                            showValue
                                                            bottomSeparator="none"
                                                            disabled={saving}
                                                            onChange={(v) => updatePlayer(index, { irTotalYaw: v })}
                                                        />
                                                    </div>
                                                    <div data-focus-key={`dmapform:slot:${index}:ir-pitch`}>
                                                        <SliderField
                                                            label={t(language, "Pointer Pitch")}
                                                            description={helpDescription(t(language, "help_ir_pitch"), true)}
                                                            value={slot.irTotalPitch ?? DEFAULT_IR_TOTAL_PITCH}
                                                            min={0}
                                                            max={IR_SWEEP_MAX}
                                                            step={1}
                                                            valueSuffix="°"
                                                            showValue
                                                            bottomSeparator="none"
                                                            disabled={saving}
                                                            onChange={(v) => updatePlayer(index, { irTotalPitch: v })}
                                                        />
                                                    </div>
                                                    <div data-focus-key={`dmapform:slot:${index}:ir-offset`}>
                                                        <SliderField
                                                            label={t(language, "Pointer Vertical Offset")}
                                                            description={helpDescription(t(language, "help_ir_offset"), true)}
                                                            value={slot.irVerticalOffset ?? DEFAULT_IR_VERTICAL_OFFSET}
                                                            min={IR_OFFSET_MIN}
                                                            max={IR_OFFSET_MAX}
                                                            step={1}
                                                            valueSuffix=" cm"
                                                            showValue
                                                            bottomSeparator="none"
                                                            disabled={saving}
                                                            onChange={(v) => updatePlayer(index, { irVerticalOffset: v })}
                                                        />
                                                    </div>
                                                    <ToggleRow
                                                        label={t(language, "Relative Pointer")}
                                                        value={slot.irRelativeInput ?? DEFAULT_IR_RELATIVE_INPUT}
                                                        disabled={saving}
                                                        bottomSeparator="none"
                                                        help={t(language, "help_ir_relative")}
                                                        modalHelp
                                                        onChange={(v) => updatePlayer(index, { irRelativeInput: v })}
                                                    />
                                                    <ToggleRow
                                                        label={t(language, "Auto-Hide Pointer")}
                                                        value={slot.irAutoHide ?? DEFAULT_IR_AUTO_HIDE}
                                                        disabled={saving}
                                                        bottomSeparator="none"
                                                        help={t(language, "help_ir_autohide")}
                                                        modalHelp
                                                        onChange={(v) => updatePlayer(index, { irAutoHide: v })}
                                                    />
                                                </>
                                            )}
                                            {
}
                                            <div data-focus-key={`dmapform:slot:${index}:rumble`}>
                                                <SliderField
                                                    label={t(language, "Rumble")}
                                                    value={slot.rumbleStrength ?? DEFAULT_RUMBLE_STRENGTH}
                                                    min={0}
                                                    max={100}
                                                    step={RUMBLE_STEP}
                                                    notchCount={RUMBLE_NOTCH_COUNT}
                                                    notchTicksVisible={false}
                                                    notchLabels={[{ notchIndex: 0, label: t(language, "Off") }]}
                                                    valueSuffix="%"
                                                    showValue
                                                    bottomSeparator="none"
                                                    disabled={saving}
                                                    onChange={(v) => updatePlayer(index, { rumbleStrength: v })}
                                                />
                                            </div>
                                            <LabeledRow
                                                focusKey={`dmapform:slot:${index}:motor`}
                                                label={t(language, "Rumble Motor")}
                                                value={rumbleMotorLabel(slot.rumbleMotor ?? DEFAULT_RUMBLE_MOTOR, language)}
                                                disabled={saving}
                                                onClick={() => updatePlayer(index, {
                                                    rumbleMotor: nextRumbleMotor(slot.rumbleMotor ?? DEFAULT_RUMBLE_MOTOR)
                                                })}
                                            />
                                        </>
                                    )}
                                    <div data-focus-key={`dmapform:slot:${index}:remove`}>
                                        <DialogButton
                                            onClick={() => removePlayer(index)}
                                            disabled={saving}
                                            style={{ ...compactButtonStyle, opacity: 0.85 }}
                                        >
                                            {t(language, "Remove")}
                                        </DialogButton>
                                    </div>
                                </div>
                            ))}
                            {players.length < MAX_PLAYERS && (
                                <FocusableItem
                                    focusKey="dmapform:add-controller"
                                    onClick={() => openPicker(null)}
                                    disabled={saving}
                                >
                                    {t(language, "Add Controller")}
                                </FocusableItem>
                            )}

                            {error && <ErrorText>{localizeRuntimeText(language, error)}</ErrorText>}

                            <Focusable
                                flow-children="row"
                                style={{ display: "flex", flexDirection: "row", gap: "8px", justifyContent: "flex-end" }}
                            >
                                <div data-focus-key="dmapform:cancel">
                                    <DialogButton onClick={close} disabled={saving} style={compactButtonStyle}>
                                        {t(language, "Cancel")}
                                    </DialogButton>
                                </div>
                                <div data-focus-key="dmapform:save">
                                    <DialogButton
                                        onClick={handleSave}
                                        disabled={saving}
                                        style={compactButtonStyle}
                                    >
                                        {t(language, "Save")}
                                    </DialogButton>
                                </div>
                            </Focusable>
                        </div>
                    )}
                </div>
            </SaveOnStart>
        </ModalRoot>
    );
}

type ControllerStepProps = {
    language: LanguageCode;
    options: ControllerType[];
    onChoose: (type: ControllerType) => void;
    onBack: () => void;
};

function ControllerStep(props: ControllerStepProps) {
    const { language, options, onChoose, onBack } = props;
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ fontSize: `${modalSize(18)}px`, fontWeight: 700 }}>
                {t(language, "Choose Controller")}
            </div>
            {options.map((type) => (
                <FocusableItem
                    key={type}
                    focusKey={`dmapctrl:${type}`}
                    onClick={() => onChoose(type)}
                >
                    {controllerTypeLabel(type, language)}
                </FocusableItem>
            ))}
            <div data-focus-key="dmapctrl:back">
                <DialogButton onClick={onBack} style={compactButtonStyle}>
                    {t(language, "Back")}
                </DialogButton>
            </div>
        </div>
    );
}
