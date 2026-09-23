import { Fragment, type CSSProperties } from "react";
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
    button: GlyphButton | GlyphButton[];
    fontSize: number;
    vars?: Record<string, string | number>;
    mark?: string;
};

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

export function ButtonPrompt(props: ButtonPromptProps) {
    const { language, textKey, button, fontSize, vars, mark } = props;
    const buttons = Array.isArray(button) ? button : [button];

    const resolved = resolveGlyphStyle(getCurrentControllerGlyphStyle());
    for (const one of buttons) {
        probeGlyphPath(glyphAsset(one, resolved).url);
    }
    warmGlyphCache();

    const pieces = t(language, textKey, vars).split("{{button}}");
    const size = Math.round(fontSize * 1.2);
    const row: CSSProperties = {
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

    return (
        <span style={row}>
            {pieces.map((piece, index) => {
                const glyphAfter = index < pieces.length - 1;
                return (
                    <Fragment key={index}>
                        {trimTowardGlyph(piece, index > 0, glyphAfter)}
                        {glyphAfter && glyphs}
                    </Fragment>
                );
            })}
        </span>
    );
}
