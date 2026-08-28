import { Fragment } from "react";
import { ButtonGlyph } from "../ui/ButtonGlyph";
import { glyphAsset, probeGlyphPath, resolveGlyphStyle } from "../../utils/controllerGlyphs";
import type { LanguageCode } from "../../locales";
import { t } from "../../locales";
import type { ControllerGlyphStyle } from "../../types";
import { textSize } from "../../utils/scale";
import { bodyTextStyle } from "../../utils/style";

type TrackedEmptyMessageProps = {
    language: LanguageCode;
    style: ControllerGlyphStyle;
    mouseKeyboardMode: boolean;
};

const GAMEPAD_LINE = "No tracked achievements for this game. Press {{button}} on an achievement you'd like to add to this list.";
const CLICK_LINE = "No tracked achievements for this game. Click an achievement you'd like to add to this list.";

export function TrackedEmptyMessage(props: TrackedEmptyMessageProps) {
    const { language, style, mouseKeyboardMode } = props;

    if (mouseKeyboardMode) {
        return <div style={bodyTextStyle()}>{t(language, CLICK_LINE)}</div>;
    }

    const resolved = resolveGlyphStyle(style);
    probeGlyphPath(glyphAsset("x", resolved).url);
    const fontSize = textSize(12);
    const pieces = t(language, GAMEPAD_LINE).split("{{button}}");

    return (
        <div style={bodyTextStyle()}>
            {pieces.map((piece, index) => (
                <Fragment key={index}>
                    {piece}
                    {
}
                    {index < pieces.length - 1 && (
                        <ButtonGlyph
                            button="x"
                            style={resolved}
                            size={Math.round(fontSize * 1.5)}
                        />
                    )}
                </Fragment>
            ))}
        </div>
    );
}
