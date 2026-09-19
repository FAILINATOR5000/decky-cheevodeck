import { Fragment } from "react";
import { ButtonGlyph } from "./ButtonGlyph";
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
    const { language, textKey, button, fontSize, vars } = props;
    const buttons = Array.isArray(button) ? button : [button];

    const resolved = resolveGlyphStyle(getCurrentControllerGlyphStyle());
    for (const one of buttons) {
        probeGlyphPath(glyphAsset(one, resolved).url);
    }
    warmGlyphCache();

    const pieces = t(language, textKey, vars).split("{{button}}");
    const size = Math.round(fontSize * 1.2);

    return (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                flexWrap: "wrap",
                flexShrink: 0,
                gap: "0.3em",
                verticalAlign: "middle"
            }}
        >
            {pieces.map((piece, index) => {
                const glyphAfter = index < pieces.length - 1;
                return (
                    <Fragment key={index}>
                        {trimTowardGlyph(piece, index > 0, glyphAfter)}
                        {glyphAfter && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.15em" }}>
                                {buttons.map((one) => (
                                    <ButtonGlyph key={one} button={one} style={resolved} size={size} />
                                ))}
                            </span>
                        )}
                    </Fragment>
                );
            })}
        </span>
    );
}
