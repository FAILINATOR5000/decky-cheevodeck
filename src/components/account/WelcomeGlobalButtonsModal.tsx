import { useEffect, useRef, useState } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { t, type LanguageCode } from "../../locales";
import { modalBodyStyle } from "../../utils/style";
import { modalSize } from "../../utils/scale";
import type { ShortcutAction, ShortcutButton } from "../../types";
import { defaultGlobalShortcuts, shortcutActionLabel, shortcutButtonGlyphs } from "../../utils/options";
import { GlyphGroup } from "../ui/ButtonPrompt";
import { BottomFocusAnchor } from "../ui/BottomFocusAnchor";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { withInlineTags } from "../ui/inlineTags";

type WelcomeGlobalButtonsModalProps = {
    language: LanguageCode;
    onApplyGlobalButtons: (enabled: boolean) => void | Promise<void>;
    close: () => void;
};

function PanelOnlyGlyph({ size = 30 }: { size?: number }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" focusable="false">
            <path
                fill="currentColor"
                fillRule="evenodd"
                d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm0 2v10h10V7H4z"
            />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function EverywhereGlyph({ size = 30 }: { size?: number }) {
    return (
        <svg viewBox="0 0 512 512" width={size} height={size} xmlns="http://www.w3.org/2000/svg" focusable="false">
            <path
                fill="currentColor"
                d="M432,320H400a16,16,0,0,0-16,16V448H64V128H208a16,16,0,0,0,16-16V80a16,16,0,0,0-16-16H48A48,48,0,0,0,0,112V464a48,48,0,0,0,48,48H400a48,48,0,0,0,48-48V336A16,16,0,0,0,432,320ZM488,0h-128c-21.37,0-32.05,25.91-17,41l35.73,35.73L135,320.37a24,24,0,0,0,0,34L157.67,377a24,24,0,0,0,34,0L435.28,133.32,471,169c15,15,41,4.5,41-17V24A24,24,0,0,0,488,0Z"
            />
        </svg>
    );
}

function ComboGlyphs({ button, fontSize }: { button: ShortcutButton; fontSize: number }) {
    const [menu, second] = shortcutButtonGlyphs(button);
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3em" }}>
            <GlyphGroup buttons={[menu]} fontSize={fontSize} />
            <span>+</span>
            <GlyphGroup buttons={[second]} fontSize={fontSize} />
        </span>
    );
}

const TABLE_LABELS: Partial<Record<ShortcutAction, string>> = {
    browser: "Open Web Browser",
    memories: "View Memories Page",
    doNotDisturb: "Toggle Do Not Disturb",
    notifications: "View Notifications"
};

function tableLabel(action: ShortcutAction, language: LanguageCode): string {
    const key = TABLE_LABELS[action];
    return key ? t(language, key) : shortcutActionLabel(action, language);
}

const CHOICES = [
    {
        id: "on",
        titleKey: "On",
        Glyph: EverywhereGlyph,
        accent: "110,180,120",
        focusFirst: true
    },
    {
        id: "off",
        titleKey: "Off",
        Glyph: PanelOnlyGlyph,
        accent: "120,140,170",
        focusFirst: false
    }
];

const MODAL_WIDTH_CSS = `
.cheevo-welcome-global-dialog.DialogContent, .cheevo-welcome-global-dialog {
    width: 86vw;
    max-width: 780px;
}`;

export function WelcomeGlobalButtonsModal(props: WelcomeGlobalButtonsModalProps) {
    const { language, onApplyGlobalButtons, close } = props;

    const defaultRef = useRef<HTMLDivElement | null>(null);
    const [focusedChoice, setFocusedChoice] = useState<string | null>(null);
    useEffect(function seedFocusOnOn() {
        const target = defaultRef.current?.querySelector("button, [tabindex]") as HTMLElement | null;
        if (target) {
            target.focus();
        }
    }, []);

    function pickChoice(choice: string) {
        close();
        void onApplyGlobalButtons(choice === "on");
    }

    const cardWidth = modalSize(112);
    const discSize = modalSize(52);
    const glyphSize = modalSize(28);
    const tableFontSize = modalSize(13);

    return (
        <ModalRoot onCancel={close} onEscKeypress={close} className="cheevo-welcome-global-dialog">
            <SnapshotHotkey language={language} />
            <style>{MODAL_WIDTH_CSS}</style>

            <Focusable onActivate={() => { }} noFocusRing={true} data-focus-key="welcome-global:heading">
                <div style={{ fontSize: `${modalSize(22)}px`, fontWeight: 700, marginBottom: "4px" }}>
                    {t(language, "Global Buttons")}
                </div>

                <div style={{ fontSize: `${modalSize(14)}px`, lineHeight: 1.4, marginBottom: "10px" }}>
                    {t(language, "welcome_global_intro")}
                </div>
            </Focusable>

            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "20px" }}>
                <Focusable
                    flow-children="row"
                    style={{ display: "flex", flexDirection: "row", gap: "12px", flex: "0 0 auto" }}
                >
                    {CHOICES.map((choice) => {
                        const Glyph = choice.Glyph;
                        const isFocused = focusedChoice === choice.id;

                        return (
                            <div
                                key={`welcome-global:col:${choice.id}`}
                                data-focus-key={`welcome-global:card:${choice.id}`}
                                ref={choice.focusFirst ? defaultRef : undefined}
                                style={{ width: `${cardWidth}px`, display: "flex" }}
                            >
                                <DialogButton
                                    onClick={() => { pickChoice(choice.id); }}
                                    onGamepadFocus={() => setFocusedChoice(choice.id)}
                                    onGamepadBlur={() => setFocusedChoice((current) => (current === choice.id ? null : current))}
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
                                        border: `1px solid rgba(${choice.accent},${isFocused ? 0.85 : 0.4})`,
                                        boxShadow: isFocused
                                            ? `0 0 0 2px rgba(${choice.accent},0.85), 0 2px 8px rgba(0,0,0,0.45)`
                                            : "0 1px 3px rgba(0,0,0,0.3)",
                                        transition: "background 120ms ease, box-shadow 120ms ease, color 120ms ease, border-color 120ms ease"
                                    }}
                                >
                                    <div style={{ fontSize: `${modalSize(16)}px`, fontWeight: 700 }}>
                                        {t(language, choice.titleKey)}
                                    </div>
                                    <div
                                        style={{
                                            width: `${discSize}px`,
                                            height: `${discSize}px`,
                                            borderRadius: "50%",
                                            background: `rgba(${choice.accent},${isFocused ? 0.32 : 0.18})`,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center"
                                        }}
                                    >
                                        <Glyph size={glyphSize} />
                                    </div>
                                </DialogButton>
                            </div>
                        );
                    })}
                </Focusable>

                <div
                    style={{
                        flex: 1,
                        minWidth: 0,
                        display: "grid",
                        gridTemplateColumns: "auto auto auto 1fr",
                        alignItems: "center",
                        columnGap: "8px",
                        rowGap: "4px",
                        fontSize: `${tableFontSize}px`
                    }}
                >
                    {defaultGlobalShortcuts().map((row) => (
                        <div key={row.action} style={{ display: "contents" }}>
                            <span>
                                {row.backButton ? <GlyphGroup buttons={shortcutButtonGlyphs(row.backButton)} fontSize={tableFontSize} /> : null}
                            </span>
                            <span>{row.backButton && row.combo ? "/" : null}</span>
                            <span>
                                {row.combo ? <ComboGlyphs button={row.combo} fontSize={tableFontSize} /> : null}
                            </span>
                            <span style={{ opacity: 0.9, paddingLeft: "6px" }}>{tableLabel(row.action, language)}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div style={{ ...modalBodyStyle(), marginTop: "10px" }}>
                {withInlineTags(t(language, "welcome_global_footer"))}
            </div>

            <div style={{ ...modalBodyStyle(), marginTop: "4px", opacity: 0.7 }}>
                {t(language, "welcome_global_controllers")}
            </div>

            <BottomFocusAnchor focusKey="welcome-global:bottom:anchor" headroomPx={8} />
        </ModalRoot>
    );
}
