import { glyphAsset, type GlyphButton, type ResolvedGlyphStyle } from "../../utils/controllerGlyphs";

type ButtonGlyphProps = {
    button: GlyphButton;
    style: ResolvedGlyphStyle;
    size: number | string;
};

export function ButtonGlyph(props: ButtonGlyphProps) {
    const asset = glyphAsset(props.button, props.style);
    const url = asset.url;
    const box = typeof props.size === "number" ? `${props.size}px` : props.size;

    if (asset.colored) {
        return (
            <img
                src={url}
                alt=""
                style={{
                    display: "inline-block",
                    verticalAlign: "middle",
                    flex: "none",
                    width: box,
                    height: box
                }}
            />
        );
    }

    return (
        <span
            style={{
                display: "inline-block",
                verticalAlign: "middle",
                flex: "none",
                width: box,
                height: box,
                backgroundColor: "currentColor",
                maskImage: `url("${url}")`,
                maskSize: "contain",
                maskRepeat: "no-repeat",
                maskPosition: "center",
                WebkitMaskImage: `url("${url}")`,
                WebkitMaskSize: "contain",
                WebkitMaskRepeat: "no-repeat",
                WebkitMaskPosition: "center"
            }}
        />
    );
}
