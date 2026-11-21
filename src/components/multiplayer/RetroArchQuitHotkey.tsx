import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { retroarchQuitHotkey, setRetroarchQuitHotkey, type RetroArchQuitStatus } from "../../api";
import { t, type LanguageCode } from "../../locales";
import { getCurrentControllerGlyphStyle, resolveGlyphStyle, type GlyphButton } from "../../utils/controllerGlyphs";
import { logError } from "../../utils/errors";
import { modalSize } from "../../utils/scale";
import { bodyTextStyle } from "../../utils/style";
import { ButtonGlyph } from "../ui/ButtonGlyph";
import { ErrorText } from "../ui/ErrorText";
import { HeadingStop } from "../ui/HeadingStop";
import { ToggleRow } from "../ui/ToggleRow";

type RetroArchQuitHotkeyProps = {
    language: LanguageCode;
    focusKey: string;
    focusFallback?: string[];
    modal?: boolean;
    divider?: boolean;
    intro?: ReactNode;
    size?: number;
    disabled?: boolean;
    outerStyle?: CSSProperties;
};

function Glyphs(props: { buttons: GlyphButton[] }) {
    const style = resolveGlyphStyle(getCurrentControllerGlyphStyle());
    return (
        <>
            {props.buttons.map((button, index) => (
                <Fragment key={index}>
                    {index > 0 && " + "}
                    <ButtonGlyph button={button} style={style} size="1.2em" />
                </Fragment>
            ))}
        </>
    );
}

function fill(text: string, placeholder: string, value: ReactNode) {
    const at = text.indexOf(placeholder);
    if (at < 0) {
        return text;
    }
    return <>{text.slice(0, at)}{value}{text.slice(at + placeholder.length)}</>;
}

const KEY_STYLE: CSSProperties = {
    padding: "0 5px",
    borderRadius: "3px",
    background: "rgba(255, 255, 255, 0.14)",
    fontWeight: 600
};

export function RetroArchQuitHotkey(props: RetroArchQuitHotkeyProps) {
    const { language, focusKey, modal = false } = props;
    const [status, setStatus] = useState<RetroArchQuitStatus | null>(null);
    const [failure, setFailure] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let live = true;
        retroarchQuitHotkey()
            .then((next) => {
                if (live && next) {
                    setStatus(next);
                }
            })
            .catch((e) => logError("read RetroArch's quit combo", e));
        return () => {
            live = false;
        };
    }, []);

    if (!status?.found && !props.intro) {
        return null;
    }

    async function toggle(on: boolean) {
        if (saving) {
            return;
        }
        setSaving(true);
        setFailure("");
        try {
            const result = await setRetroarchQuitHotkey(on);
            if (result?.ok) {
                setStatus(result);
            }
            else {
                setFailure(result?.error === "running"
                    ? t(language, "Close RetroArch first.")
                    : t(language, "Couldn't change RetroArch's settings."));
            }
        }
        catch (e) {
            logError("change RetroArch's quit combo", e);
            setFailure(t(language, "Couldn't change RetroArch's settings."));
        }
        finally {
            setSaving(false);
        }
    }

    const size = props.size ?? 16;
    const gap = modal ? modalSize(size) * 1.4 : 8;
    const textStyle: CSSProperties = modal ? { fontSize: `${modalSize(size)}px`, lineHeight: 1.4 } : bodyTextStyle();

    const combo = status?.combo ?? null;
    let label: ReactNode = t(language, "Quit RetroArch with the combo hotkey");
    if (combo) {
        const text = combo.hold ? t(language, "Quit RetroArch by holding {{combo}}") : t(language, "Quit RetroArch with {{combo}}");
        label = fill(text, "{{combo}}", <Glyphs buttons={combo.buttons} />);
    }

    return (
        <div
            style={{
                width: "100%",
                display: "flex",
                flexDirection: "column",
                gap: `${gap}px`,
                ...(props.divider ? {
                    borderTop: "3px solid rgba(255,255,255,0.12)",
                    borderBottom: "3px solid rgba(255,255,255,0.12)",
                    padding: `${gap}px 0`,
                    marginBottom: `${gap}px`
                } : {}),
                ...props.outerStyle
            }}
        >
            {props.intro && (
                <HeadingStop focusKey={`${focusKey}:intro`} style={textStyle}>
                    {typeof props.intro === "string" ? (
                        <span style={{ display: "flex", gap: "8px" }}>
                            <span>•</span>
                            <span style={{ flex: 1 }}>{props.intro}</span>
                        </span>
                    ) : props.intro}
                </HeadingStop>
            )}
            {status?.found && (
                <ToggleRow
                    focusKey={focusKey}
                    focusFallback={props.focusFallback}
                    label={<span style={{ display: "inline-flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>{label}</span>}
                    help={t(language, "help_retroarch_quit_combo")}
                    modalHelp={modal}
                    value={status.on}
                    controlled
                    disabled={props.disabled || saving}
                    bottomSeparator="none"
                    onChange={toggle}
                />
            )}
            {failure && <ErrorText modal={modal}>{failure}</ErrorText>}
            {(status?.others ?? []).map((note) => (
                <HeadingStop key={note.kind} focusKey={`${focusKey}:note:${note.kind}`} style={textStyle}>
                    <span style={{ display: "flex", gap: "8px" }}>
                        <span>•</span>
                        <span style={{ flex: 1 }}>
                            {note.kind === "binds"
                                ? fill(t(language, "retroarch_quit_found"), "{{combo}}", <Glyphs buttons={note.buttons} />)
                                : fill(t(language, "retroarch_quit_keyboard"), "{{key}}", <span style={KEY_STYLE}>{note.key}</span>)}
                        </span>
                    </span>
                </HeadingStop>
            ))}
        </div>
    );
}
