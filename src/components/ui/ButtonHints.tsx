import type { ReactNode } from "react";
import { ButtonGlyph } from "./ButtonGlyph";
import type { ControllerGlyphStyle } from "../../types";
import { glyphAsset, probeGlyphPath, resolveGlyphStyle, warmGlyphCache, type GlyphButton } from "../../utils/controllerGlyphs";
import { getCurrentTextScale, textSize } from "../../utils/scale";

type ButtonHint = {
    button: GlyphButton | readonly GlyphButton[];
    label: ReactNode;
};

type ButtonHintsProps = {
    hints: ButtonHint[];
    style: ControllerGlyphStyle;
    dense?: boolean;
};

export function ButtonHints(props: ButtonHintsProps) {
    const { hints, style, dense } = props;
    if (!hints.length) {
        return null;
    }

    const resolved = resolveGlyphStyle(style);
    const glyphsFor = (hint: ButtonHint) => Array.isArray(hint.button) ? hint.button : [hint.button];
    probeGlyphPath(glyphAsset(glyphsFor(hints[0])[0], resolved).url);
    warmGlyphCache();
    const fontSize = textSize(dense ? 11 : 12);
    const glyphSize = Math.round(fontSize * (dense ? 1.35 : 1.5));
    const scale = getCurrentTextScale();
    const twoUp = dense && hints.length === 4 && scale === "xxxlarge";

    return (
        <div
            style={{
                display: twoUp ? "grid" : "flex",
                gridTemplateColumns: twoUp ? "repeat(2, auto)" : undefined,
                justifyContent: twoUp ? "start" : undefined,
                flexWrap: "wrap",
                alignItems: "center",
                gap: `${Math.round(fontSize * (dense ? 0.6 : 0.9))}px`,
                fontSize: `${fontSize}px`,
                lineHeight: 1.2,
                paddingBottom: "4px"
            }}
        >
            {hints.map((hint) => (
                <span
                    key={String(hint.button)}
                    style={{ display: "inline-flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}
                >
                    {glyphsFor(hint).map((button) => (
                        <ButtonGlyph key={button} button={button} style={resolved} size={glyphSize} />
                    ))}
                    {hint.label}
                </span>
            ))}
        </div>
    );
}
