import type { CSSProperties, ReactNode } from "react";
import { legendGlyph } from "../ui/legendGlyph";
import { t, type LanguageCode } from "../../locales";

export function transportLabel(language: LanguageCode, key: string, mark: string): ReactNode {
    if (language === "en") {
        return t(language, key);
    }
    return <span style={MARK_CELL}>{legendGlyph(mark)}</span>;
}

const MARK_CELL: CSSProperties = {
    display: "inline-block",
    minWidth: "1.1em",
    textAlign: "center"
};

export function transportMark(language: LanguageCode, mark: string): string | undefined {
    return language === "en" ? undefined : mark;
}
