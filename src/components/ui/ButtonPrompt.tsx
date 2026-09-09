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
    button: GlyphButton;
    fontSize: number;
    vars?: Record<string, string | number>;
};

export function ButtonPrompt(props: ButtonPromptProps) {
    const { language, textKey, button, fontSize, vars } = props;

    const resolved = resolveGlyphStyle(getCurrentControllerGlyphStyle());
    probeGlyphPath(glyphAsset(button, resolved).url);
    warmGlyphCache();

    const pieces = t(language, textKey, vars).split("{{button}}");

    return (
        <>
            {pieces.map((piece, index) => (
                <Fragment key={index}>
                    {piece}
                    {index < pieces.length - 1 && (
                        <ButtonGlyph
                            button={button}
                            style={resolved}
                            size={Math.round(fontSize * 1.2)}
                        />
                    )}
                </Fragment>
            ))}
        </>
    );
}
