import { useEffect, useRef, useState } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";

import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { t, type LanguageCode } from "../../locales";
import { modalBodyStyle, confirmAmber } from "../../utils/style";
import { modalSize } from "../../utils/scale";
import { ToggleRow } from "../ui/ToggleRow";
import { BottomFocusAnchor } from "../ui/BottomFocusAnchor";

type WelcomeModalProps = {
    language: LanguageCode;
    userName: string;
    showPreserveToggle: boolean;
    onApplyProfile: (profile: string, preserveOtherSettings: boolean) => void | Promise<void>;
    close: () => void;
};

function BasicGlyph({ size = 30 }: { size?: number }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" focusable="false">
            <path
                fill="currentColor"
                d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.2a5 5 0 0 1-3.8 3.9V18h3v2H9v-2h3v-2.1A5 5 0 0 1 8.2 12H8a4 4 0 0 1-4-4V5h3V3zm0 4H6v1a2 2 0 0 0 1 1.7V7zm10 0v2.7A2 2 0 0 0 18 8V7h-1z"
            />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function BalancedGlyph({ size = 30 }: { size?: number }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" focusable="false">
            <g fill="currentColor">
                <g transform="translate(-1 3) scale(0.6)">
                    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                </g>
                <g transform="translate(11 5) scale(0.5)">
                    <path d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.2a5 5 0 0 1-3.8 3.9V18h3v2H9v-2h3v-2.1A5 5 0 0 1 8.2 12H8a4 4 0 0 1-4-4V5h3V3zm0 4H6v1a2 2 0 0 0 1 1.7V7zm10 0v2.7A2 2 0 0 0 18 8V7h-1z" />
                </g>
            </g>
        </svg>
    );
}

function SocialGlyph({ size = 30 }: { size?: number }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" focusable="false">
            <path
                fill="currentColor"
                d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"
            />
        </svg>
    );
}

const PROFILES = [
    {
        id: "basic",
        titleKey: "profile_basic",
        Glyph: BasicGlyph,
        accent: "120,140,170",
        recommended: false,
        bulletKeys: ["profile_basic_bullet1", "profile_basic_bullet2", "profile_basic_bullet3"]
    },
    {
        id: "social",
        titleKey: "profile_social",
        Glyph: SocialGlyph,
        accent: "230,170,90",
        recommended: true,
        bulletKeys: ["profile_social_bullet1", "profile_social_bullet2", "profile_social_bullet3"]
    },
    {
        id: "balanced",
        titleKey: "profile_balanced",
        Glyph: BalancedGlyph,
        accent: "110,180,120",
        recommended: false,
        bulletKeys: ["profile_balanced_bullet2", "profile_balanced_bullet3"]
    }
];

const MODAL_WIDTH_CSS = `
.cheevo-welcome-dialog.DialogContent, .cheevo-welcome-dialog {
    width: 86vw;
    max-width: 780px;
}`;

function greetingKeyForHour(hour: number): string {
    if (hour < 3) {
        return "greeting_night_owl";
    }
    if (hour < 12) {
        return "greeting_morning";
    }
    if (hour < 18) {
        return "greeting_afternoon";
    }
    return "greeting_evening";
}

export function WelcomeModal(props: WelcomeModalProps) {
    const { language, userName, showPreserveToggle, onApplyProfile, close } = props;

    const [preserveOtherSettings, setPreserveOtherSettings] = useState(true);

    const recommendedRef = useRef<HTMLDivElement | null>(null);
    const [focusedProfile, setFocusedProfile] = useState<string | null>(null);
    useEffect(function seedFocusOnRecommended() {
        const target = recommendedRef.current?.querySelector("button, [tabindex]") as HTMLElement | null;
        if (target) {
            target.focus();
        }
    }, []);

    async function pickProfile(profile: string) {
        const preserve = showPreserveToggle ? preserveOtherSettings : false;
        await onApplyProfile(profile, preserve);
        close();
    }

    const greeting = t(language, greetingKeyForHour(new Date().getHours()));

    const discSize = modalSize(44);
    const glyphSize = modalSize(26);

    return (
        <ModalRoot onCancel={close} onEscKeypress={close} className="cheevo-welcome-dialog">
            <SnapshotHotkey language={language} />
            <style>{MODAL_WIDTH_CSS}</style>

            <div style={{ fontSize: `${modalSize(22)}px`, fontWeight: 700, marginBottom: "4px" }}>
                {greeting}, {userName}
            </div>

            <div style={{ fontSize: `${modalSize(14)}px`, lineHeight: 1.4, marginBottom: "8px" }}>
                {t(language, "welcome_intro")}
            </div>

            {showPreserveToggle ? (
                <ToggleRow
                    label={t(language, "welcome_preserve_toggle")}
                    value={preserveOtherSettings}
                    onChange={setPreserveOtherSettings}
                    bottomSeparator="none"
                    outerStyle={{ marginBottom: "6px" }}
                />
            ) : null}

            <Focusable
                flow-children="row"
                style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: "12px"
                }}
            >
                {PROFILES.map((profile) => {
                    const Glyph = profile.Glyph;
                    const isFocused = focusedProfile === profile.id;

                    function handleCardFocus() {
                        setFocusedProfile(profile.id);
                    }

                    function handleCardBlur() {
                        setFocusedProfile((current) => {
                            if (current !== profile.id) {
                                return current;
                            }

                            return null;
                        });
                    }

                    return (
                        <div
                            key={`welcome:col:${profile.id}`}
                            style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}
                        >
                            <div
                                data-focus-key={`welcome:card:${profile.id}`}
                                ref={profile.recommended ? recommendedRef : undefined}
                                onFocusCapture={handleCardFocus}
                                onBlurCapture={handleCardBlur}
                                style={{ display: "flex" }}
                            >
                                <DialogButton
                                    onClick={() => { void pickProfile(profile.id); }}
                                    style={{
                                        minWidth: 0,
                                        width: "100%",
                                        padding: "10px",
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "center",
                                        gap: "6px",
                                        color: isFocused ? "rgba(24,24,24,0.98)" : "rgba(255,255,255,0.92)",
                                        background: isFocused ? "rgba(255,255,255,0.96)" : "rgba(24,24,24,0.78)",
                                        border: `1px solid rgba(${profile.accent},${isFocused ? 0.85 : 0.4})`,
                                        boxShadow: isFocused
                                            ? `0 0 0 2px rgba(${profile.accent},0.85), 0 2px 8px rgba(0,0,0,0.45)`
                                            : "0 1px 3px rgba(0,0,0,0.3)",
                                        transition: "background 120ms ease, box-shadow 120ms ease, color 120ms ease, border-color 120ms ease"
                                    }}
                                >
                                    <div style={{ fontSize: `${modalSize(16)}px`, fontWeight: 700 }}>
                                        {t(language, profile.titleKey)}
                                    </div>
                                    {profile.recommended ? (
                                        <span
                                            style={{
                                                fontSize: `${modalSize(11)}px`,
                                                fontWeight: 700,
                                                color: isFocused ? "rgba(24,24,24,0.98)" : confirmAmber,
                                                border: `1px solid ${confirmAmber}`,
                                                borderRadius: "10px",
                                                padding: "1px 8px"
                                            }}
                                        >
                                            {t(language, "Recommended")}
                                        </span>
                                    ) : null}
                                    <div
                                        style={{
                                            width: `${discSize}px`,
                                            height: `${discSize}px`,
                                            borderRadius: "50%",
                                            background: `rgba(${profile.accent},${isFocused ? 0.32 : 0.18})`,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center"
                                        }}
                                    >
                                        <Glyph size={glyphSize} />
                                    </div>
                                </DialogButton>
                            </div>

                            <div style={{ ...modalBodyStyle(), marginTop: "6px" }}>
                                {profile.bulletKeys.map((bulletKey) => (
                                    <div key={bulletKey} style={{ display: "flex", gap: "6px" }}>
                                        <span>&bull;</span>
                                        <span>{t(language, bulletKey)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </Focusable>

            <div style={{ ...modalBodyStyle(), marginTop: "6px" }}>
                {t(language, "welcome_footer_before")}
                <span style={{ fontWeight: 700 }}>{t(language, "Settings Profile Chooser")}</span>
                {t(language, "welcome_footer_after")}
            </div>

            {showPreserveToggle ? (
                <BottomFocusAnchor focusKey="welcome:bottom:anchor" headroomPx={8} />
            ) : null}
        </ModalRoot>
    );
}
