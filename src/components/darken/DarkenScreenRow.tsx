import { PanelSectionRow } from "@decky/ui";
import { ToggleRow } from "../ui/ToggleRow";
import { useScreenDarken } from "./screenDarken";
import { t, type LanguageCode } from "../../locales";
import type { ButtonSpacing } from "../../types";
import { regularButtonSpacingStyle } from "../../utils/style";

export type DarkenScreenRowProps = {
    language: LanguageCode;
    buttonSpacing: ButtonSpacing;
};

export function DarkenScreenRow(props: DarkenScreenRowProps) {
    const { language } = props;
    const [darkened, setDarkened] = useScreenDarken();

    return (
        <PanelSectionRow>
            <ToggleRow
                outerStyle={regularButtonSpacingStyle(props.buttonSpacing)}
                label={t(language, "Darken Screen")}
                value={darkened}
                onChange={setDarkened}
                help={t(language, "help_darken_screen")}
            />
        </PanelSectionRow>
    );
}
