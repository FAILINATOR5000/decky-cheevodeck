import { Fragment, type CSSProperties, type ReactNode } from "react";
import { ButtonGlyph } from "./ButtonGlyph";
import { legendGlyph } from "./legendGlyph";
import {
    getCurrentControllerGlyphStyle,
    glyphAsset,
    probeGlyphPath,
    resolveGlyphStyle,
    warmGlyphCache,
    type GlyphButton
} from "../../utils/controllerGlyphs";
import type { LanguageCode } from "../../locales";
import { t } from "../../locales";

// The key's translation must keep {{button}}; that token is where the glyph goes.
type ButtonPromptProps = {
    language: LanguageCode;
    textKey: string;
    button?: GlyphButton | GlyphButton[];
    groups?: ReactNode[];
    renderText?: (text: string) => ReactNode;
    inline?: boolean;
    fontSize: number;
    vars?: Record<string, string | number>;
    mark?: string;
};

const TRAILING_PUNCTUATION = /^[,.;:!?)\]、。，．：；）]+/;

function trimTowardGlyph(piece: string, glyphBefore: boolean, glyphAfter: boolean): string {
    let text = piece;
    if (glyphBefore) {
        text = text.replace(/^[ \t]+/, "");
    }
    if (glyphAfter) {
        text = text.replace(/[ \t]+$/, "");
    }
    return text;
}

export function GlyphGroup(props: { buttons: GlyphButton[]; fontSize: number }) {
    const resolved = resolveGlyphStyle(getCurrentControllerGlyphStyle());
    for (const one of props.buttons) {
        probeGlyphPath(glyphAsset(one, resolved).url);
    }
    warmGlyphCache();
    const size = Math.round(props.fontSize * 1.2);
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.15em" }}>
            {props.buttons.map((one) => (
                <ButtonGlyph key={one} button={one} style={resolved} size={size} />
            ))}
        </span>
    );
}

export function ButtonPrompt(props: ButtonPromptProps) {
    const { language, textKey, button, fontSize, vars, mark, groups, renderText, inline } = props;
    const buttons = button === undefined ? [] : Array.isArray(button) ? button : [button];

    const resolved = resolveGlyphStyle(getCurrentControllerGlyphStyle());
    for (const one of buttons) {
        probeGlyphPath(glyphAsset(one, resolved).url);
    }
    warmGlyphCache();

    const pieces = t(language, textKey, vars).split("{{button}}");
    const size = Math.round(fontSize * 1.2);
    const row: CSSProperties = inline ? { display: "inline" } : {
        display: "inline-flex",
        alignItems: "center",
        flexWrap: "wrap",
        flexShrink: 0,
        gap: "0.3em",
        verticalAlign: "middle"
    };
    const glyphs = (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.15em" }}>
            {buttons.map((one) => (
                <ButtonGlyph key={one} button={one} style={resolved} size={size} />
            ))}
        </span>
    );

    if (mark !== undefined) {
        return (
            <span style={row}>
                {glyphs}
                <span style={{ display: "inline-block", minWidth: "1.1em", textAlign: "center" }}>
                    {legendGlyph(mark)}
                </span>
            </span>
        );
    }

    const texts = pieces.map((piece, index) => (inline ? piece : trimTowardGlyph(piece, index > 0, index < pieces.length - 1)));
    const trailing = texts.map((text, index) => (index > 0 ? TRAILING_PUNCTUATION.exec(text)?.[0] ?? "" : ""));
    const show = (text: string) => (renderText ? renderText(text) : text);

    return (
        <span style={row}>
            {texts.map((text, index) => {
                const glyphAfter = index < texts.length - 1;
                const token = groups && groups.length > 0 ? groups[Math.min(index, groups.length - 1)] : glyphs;
                const after = glyphAfter ? trailing[index + 1] : "";
                return (
                    <Fragment key={index}>
                        {show(text.slice(trailing[index].length))}
                        {glyphAfter && (
                            <span style={{ whiteSpace: "nowrap" }}>
                                {inline ? <span style={{ verticalAlign: "middle" }}>{token}</span> : token}
                                {after && show(after)}
                            </span>
                        )}
                    </Fragment>
                );
            })}
        </span>
    );
}
