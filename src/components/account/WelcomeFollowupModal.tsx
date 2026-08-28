import { useEffect, useRef, useState } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { t, type LanguageCode } from "../../locales";
import { modalBodyStyle } from "../../utils/style";
import { modalSize } from "../../utils/scale";
import type { ScalePreset } from "../../types";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

type WelcomeFollowupModalProps = {
    language: LanguageCode;
    onApplyScalePreset: (preset: ScalePreset) => void | Promise<void>;
    close: () => void;
};

function PortableGlyph({ size = 30 }: { size?: number }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" focusable="false">
            <path
                fill="currentColor"
                fillRule="evenodd"
                d="M5 5h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zm3.5 3.5v7h7v-7h-7zm-2.9 2.1a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zm12.8 0a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8z"
            />
        </svg>
    );
}

function BigScreenGlyph({ size = 30 }: { size?: number }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" focusable="false">
            <path
                fill="currentColor"
                fillRule="evenodd"
                d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-5v2h3v2H6v-2h3v-2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm1.5 2.5v8h13v-8h-13z"
            />
        </svg>
    );
}

function BigTextGlyph({ size = 30 }: { size?: number }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" focusable="false">
            <g fill="currentColor" fontWeight={700}>
                <text x="1" y="19" fontSize="18">A</text>
                <text x="14" y="19" fontSize="11">a</text>
            </g>
        </svg>
    );
}

const PRESETS = [
    {
        id: "portable",
        titleKey: "Portable",
        blurbKey: "welcome_followup_portable",
        Glyph: PortableGlyph,
        accent: "120,140,170",
        isDefault: true
    },
    {
        id: "bigScreen",
        titleKey: "Big Screen",
        blurbKey: "welcome_followup_big_screen",
        Glyph: BigScreenGlyph,
        accent: "110,180,120",
        isDefault: false
    },
    {
        id: "bigText",
        titleKey: "Big Text",
        blurbKey: "welcome_followup_big_text",
        Glyph: BigTextGlyph,
        accent: "230,170,90",
        isDefault: false
    }
];

export function WelcomeFollowupModal(props: WelcomeFollowupModalProps) {
    const { language, onApplyScalePreset, close } = props;

    const portableRef = useRef<HTMLDivElement | null>(null);
    const [focusedPreset, setFocusedPreset] = useState<string | null>(null);
    useEffect(function seedFocusOnPortable() {
        const target = portableRef.current?.querySelector("button, [tabindex]") as HTMLElement | null;
        if (target) {
            target.focus();
        }
    }, []);

    function pickPreset(preset: string) {
        if (preset === "portable") {
            close();
            return;
        }

        close();
        void onApplyScalePreset(preset as ScalePreset);
    }

    const discSize = modalSize(52);
    const glyphSize = modalSize(30);

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <div style={{ fontSize: `${modalSize(22)}px`, fontWeight: 700, marginBottom: "4px" }}>
                {t(language, "welcome_followup_title")}
            </div>

            <div style={{ fontSize: `${modalSize(14)}px`, lineHeight: 1.4, marginBottom: "10px" }}>
                {t(language, "welcome_followup_intro")}
            </div>

            <Focusable
                flow-children="row"
                style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: "12px"
                }}
            >
                {PRESETS.map((preset) => {
                    const Glyph = preset.Glyph;
                    const isFocused = focusedPreset === preset.id;

                    function handleCardFocus() {
                        setFocusedPreset(preset.id);
                    }

                    function handleCardBlur() {
                        setFocusedPreset((current) => {
                            if (current !== preset.id) {
                                return current;
                            }

                            return null;
                        });
                    }

                    return (
                        <div
                            key={`welcome-followup:col:${preset.id}`}
                            style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}
                        >
                            <div
                                data-focus-key={`welcome-followup:card:${preset.id}`}
                                ref={preset.isDefault ? portableRef : undefined}
                                onFocusCapture={handleCardFocus}
                                onBlurCapture={handleCardBlur}
                                style={{ display: "flex" }}
                            >
                                <DialogButton
                                    onClick={() => { pickPreset(preset.id); }}
                                    style={{
                                        minWidth: 0,
                                        width: "100%",
                                        padding: "12px",
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "center",
                                        gap: "8px",
                                        color: isFocused ? "rgba(24,24,24,0.98)" : "rgba(255,255,255,0.92)",
                                        background: isFocused ? "rgba(255,255,255,0.96)" : "rgba(24,24,24,0.78)",
                                        border: `1px solid rgba(${preset.accent},${isFocused ? 0.85 : 0.4})`,
                                        boxShadow: isFocused
                                            ? `0 0 0 2px rgba(${preset.accent},0.85), 0 2px 8px rgba(0,0,0,0.45)`
                                            : "0 1px 3px rgba(0,0,0,0.3)",
                                        transition: "background 120ms ease, box-shadow 120ms ease, color 120ms ease, border-color 120ms ease"
                                    }}
                                >
                                    <div style={{ fontSize: `${modalSize(16)}px`, fontWeight: 700 }}>
                                        {t(language, preset.titleKey)}
                                    </div>
                                    <div
                                        style={{
                                            width: `${discSize}px`,
                                            height: `${discSize}px`,
                                            borderRadius: "50%",
                                            background: `rgba(${preset.accent},${isFocused ? 0.32 : 0.18})`,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center"
                                        }}
                                    >
                                        <Glyph size={glyphSize} />
                                    </div>
                                </DialogButton>
                            </div>

                            <div style={{ ...modalBodyStyle(), marginTop: "8px" }}>
                                {t(language, preset.blurbKey)}
                            </div>
                        </div>
                    );
                })}
            </Focusable>

            <div style={{ ...modalBodyStyle(), marginTop: "8px" }}>
                {t(language, "welcome_followup_footer_before")}
                <span style={{ fontWeight: 700 }}>{t(language, "Display Scaling Presets")}</span>
                {t(language, "welcome_followup_footer_after")}
            </div>
        </ModalRoot>
    );
}
