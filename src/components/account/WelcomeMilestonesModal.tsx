import { useEffect, useRef, useState } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { t, type LanguageCode } from "../../locales";
import { modalBodyStyle } from "../../utils/style";
import { modalSize } from "../../utils/scale";
import type { MainUiPreset } from "../../utils/options";
import {
    MILESTONES_COMPACT_PREVIEW,
    MILESTONES_DEFAULT_PREVIEW,
    MILESTONES_QUICK_MENU_PREVIEW
} from "../ui/mainUiPreviews";
import { BottomFocusAnchor } from "../ui/BottomFocusAnchor";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { withInlineTags } from "../ui/inlineTags";

type WelcomeMilestonesModalProps = {
    language: LanguageCode;
    layout: MainUiPreset;
    onApplyMilestonesButton: (show: boolean) => void | Promise<void>;
    onDone: () => void;
    onCancel: () => void;
    close: () => void;
};

const PLACES = [
    {
        id: "mainMenu",
        titleKey: "Main Menu",
        accent: "120,140,170",
        isDefault: true
    },
    {
        id: "quickMenu",
        titleKey: "Quick Menu",
        accent: "110,180,120",
        isDefault: false
    }
];

function previewFor(place: string, layout: MainUiPreset): string {
    if (place === "quickMenu") {
        return MILESTONES_QUICK_MENU_PREVIEW;
    }
    return layout === "compact" ? MILESTONES_COMPACT_PREVIEW : MILESTONES_DEFAULT_PREVIEW;
}

export function WelcomeMilestonesModal(props: WelcomeMilestonesModalProps) {
    const { language, layout, onApplyMilestonesButton, onDone, onCancel, close } = props;

    const defaultRef = useRef<HTMLDivElement | null>(null);
    const [focusedPlace, setFocusedPlace] = useState<string | null>(null);
    useEffect(function seedFocusOnMainMenu() {
        const target = defaultRef.current?.querySelector("button, [tabindex]") as HTMLElement | null;
        if (target) {
            target.focus();
        }
    }, []);

    const shotHeight = modalSize(200);
    const shotMaxHeight = "36vh";

    function pickPlace(place: string) {
        close();
        void onApplyMilestonesButton(place === "mainMenu");
        onDone();
    }

    return (
        <ModalRoot onCancel={onCancel} onEscKeypress={onCancel}>
            <SnapshotHotkey language={language} />
            <Focusable onActivate={() => { }} noFocusRing={true} data-focus-key="welcome-milestones:heading">
                <div style={{ fontSize: `${modalSize(22)}px`, fontWeight: 700, marginBottom: "4px" }}>
                    {t(language, "Milestones")}
                </div>

                <div style={{ fontSize: `${modalSize(14)}px`, lineHeight: 1.4, marginBottom: "10px" }}>
                    {t(language, "welcome_milestones_intro")}
                </div>
            </Focusable>

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
                {PLACES.map((place) => {
                    const isFocused = focusedPlace === place.id;

                    return (
                        <div
                            key={`welcome-milestones:col:${place.id}`}
                            data-focus-key={`welcome-milestones:card:${place.id}`}
                            ref={place.isDefault ? defaultRef : undefined}
                            style={{ flex: "0 0 auto", minWidth: 0, display: "flex" }}
                        >
                            <DialogButton
                                onClick={() => { pickPlace(place.id); }}
                                onGamepadFocus={() => setFocusedPlace(place.id)}
                                onGamepadBlur={() => setFocusedPlace((current) => (current === place.id ? null : current))}
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
                                    border: `1px solid rgba(${place.accent},${isFocused ? 0.85 : 0.4})`,
                                    boxShadow: isFocused
                                        ? `0 0 0 2px rgba(${place.accent},0.85), 0 2px 8px rgba(0,0,0,0.45)`
                                        : "0 1px 3px rgba(0,0,0,0.3)",
                                    transition: "background 120ms ease, box-shadow 120ms ease, color 120ms ease, border-color 120ms ease"
                                }}
                            >
                                <img
                                    src={previewFor(place.id, layout)}
                                    alt=""
                                    style={{
                                        display: "block",
                                        width: "auto",
                                        height: `min(${shotHeight}px, ${shotMaxHeight})`,
                                        borderRadius: "4px",
                                        border: `1px solid rgba(${place.accent},${isFocused ? 0.75 : 0.35})`,
                                        opacity: isFocused ? 1 : 0.5,
                                        transition: "opacity 120ms ease, border-color 120ms ease"
                                    }}
                                />
                                <div style={{ fontSize: `${modalSize(16)}px`, fontWeight: 700, textAlign: "center" }}>
                                    {t(language, place.titleKey)}
                                </div>
                            </DialogButton>
                        </div>
                    );
                })}
            </Focusable>

            <div style={{ ...modalBodyStyle(), marginTop: "8px" }}>
                {withInlineTags(t(language, "welcome_milestones_footer"))}
            </div>

            <BottomFocusAnchor focusKey="welcome-milestones:bottom:anchor" headroomPx={8} />
        </ModalRoot>
    );
}
