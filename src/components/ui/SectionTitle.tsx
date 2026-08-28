import { PanelSectionRow } from "@decky/ui";
import { getCurrentTitleScale, scaleMultiplier } from "../../utils/scale";

export type SectionTitleProps = {
    label: string;
    dimmed?: boolean;
};

export function SectionTitle(props: SectionTitleProps) {
    return (
        <PanelSectionRow>
            <div
                style={{
                    fontSize: `${scaleMultiplier(getCurrentTitleScale())}em`,
                    fontWeight: 700,
                    textAlign: "center",
                    padding: "8px 0 4px",
                    opacity: props.dimmed ? 0.6 : 1
                }}
            >
                {props.label}
            </div>
        </PanelSectionRow>
    );
}
