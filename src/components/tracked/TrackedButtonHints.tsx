import { PanelSectionRow } from "@decky/ui";
import { ButtonHints } from "../ui/ButtonHints";
import type { LanguageCode } from "../../locales";
import { t } from "../../locales";
import type { ControllerGlyphStyle } from "../../types";

type TrackedButtonHintsProps = {
    language: LanguageCode;
    style: ControllerGlyphStyle;
    reorderAvailable: boolean;
    lastTag: string | null;
};

export function TrackedButtonHints(props: TrackedButtonHintsProps) {
    const { language, style, reorderAvailable, lastTag } = props;

    return (
        <PanelSectionRow>
            <ButtonHints
                style={style}
                hints={[
                    { button: "a", label: t(language, "View Info") },
                    { button: "x", label: t(language, "Untrack") },
                    { button: "y", label: t(language, "Note & Tag") },
                    ...(reorderAvailable
                        ? [{ button: "r1" as const, label: t(language, "Reorder") }]
                        : []),
                    ...(lastTag
                        ? [{ button: "l1" as const, label: lastTag }]
                        : [])
                ]}
            />
        </PanelSectionRow>
    );
}
