import { useEffect, useRef, useState } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { t, type LanguageCode } from "../../locales";
import { modalBodyStyle } from "../../utils/style";
import { modalSize } from "../../utils/scale";
import type { MainUiPreset } from "../../utils/options";
import { MAIN_UI_COMPACT_PREVIEW, MAIN_UI_DEFAULT_PREVIEW } from "../ui/mainUiPreviews";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

type WelcomeMainUiModalProps = {
    language: LanguageCode;
    onApplyMainUiPreset: (preset: MainUiPreset) => void | Promise<void>;
    close: () => void;
};

const LAYOUTS = [
    {
        id: "default",
        titleKey: "Default View",
        image: MAIN_UI_DEFAULT_PREVIEW,
        accent: "120,140,170",
        isDefault: true
    },
    {
        id: "compact",
        titleKey: "Compact View",
        image: MAIN_UI_COMPACT_PREVIEW,
        accent: "110,180,120",
        isDefault: false
    }
];

export function WelcomeMainUiModal(props: WelcomeMainUiModalProps) {
    const { language, onApplyMainUiPreset, close } = props;

    const defaultRef = useRef<HTMLDivElement | null>(null);
    const [focusedLayout, setFocusedLayout] = useState<string | null>(null);
    useEffect(function seedFocusOnDefault() {
        const target = defaultRef.current?.querySelector("button, [tabindex]") as HTMLElement | null;
        if (target) {
            target.focus();
        }
    }, []);

    const shotHeight = modalSize(200);

    function pickLayout(layout: string) {
        if (layout === "default") {
            close();
            return;
        }

        close();
        void onApplyMainUiPreset(layout as MainUiPreset);
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <div style={{ fontSize: `${modalSize(22)}px`, fontWeight: 700, marginBottom: "4px" }}>
                {t(language, "welcome_main_ui_title")}
            </div>

            <div style={{ fontSize: `${modalSize(14)}px`, lineHeight: 1.4, marginBottom: "10px" }}>
                {t(language, "welcome_main_ui_intro")}
            </div>

            <Focusable
                flow-children="row"
                style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "flex-start",
                    justifyContent: "center",
                    gap: "12px"
                }}
            >
                {LAYOUTS.map((layout) => {
                    const isFocused = focusedLayout === layout.id;

                    function handleCardFocus() {
                        setFocusedLayout(layout.id);
                    }

                    function handleCardBlur() {
                        setFocusedLayout((current) => {
                            if (current !== layout.id) {
                                return current;
                            }

                            return null;
                        });
                    }

                    return (
                        <div
                            key={`welcome-main-ui:col:${layout.id}`}
                            data-focus-key={`welcome-main-ui:card:${layout.id}`}
                            ref={layout.isDefault ? defaultRef : undefined}
                            onFocusCapture={handleCardFocus}
                            onBlurCapture={handleCardBlur}
                            style={{ flex: "0 0 auto", minWidth: 0, display: "flex" }}
                        >
                            <DialogButton
                                onClick={() => { pickLayout(layout.id); }}
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
                                    border: `1px solid rgba(${layout.accent},${isFocused ? 0.85 : 0.4})`,
                                    boxShadow: isFocused
                                        ? `0 0 0 2px rgba(${layout.accent},0.85), 0 2px 8px rgba(0,0,0,0.45)`
                                        : "0 1px 3px rgba(0,0,0,0.3)",
                                    transition: "background 120ms ease, box-shadow 120ms ease, color 120ms ease, border-color 120ms ease"
                                }}
                            >
                                <img
                                    src={layout.image}
                                    alt=""
                                    style={{
                                        display: "block",
                                        width: "auto",
                                        height: `${shotHeight}px`,
                                        borderRadius: "4px",
                                        border: `1px solid rgba(${layout.accent},${isFocused ? 0.75 : 0.35})`,
                                        opacity: isFocused ? 1 : 0.5,
                                        transition: "opacity 120ms ease, border-color 120ms ease"
                                    }}
                                />
                                <div style={{ fontSize: `${modalSize(16)}px`, fontWeight: 700, textAlign: "center" }}>
                                    {t(language, layout.titleKey)}
                                </div>
                            </DialogButton>
                        </div>
                    );
                })}
            </Focusable>

            <div style={{ ...modalBodyStyle(), marginTop: "8px" }}>
                {t(language, "welcome_main_ui_footer_before")}
                <span style={{ fontWeight: 700 }}>{t(language, "Main UI Presets")}</span>
                {t(language, "welcome_main_ui_footer_after")}
            </div>
        </ModalRoot>
    );
}
