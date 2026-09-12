import { PanelSectionRow } from "@decky/ui";
import type { ReactNode } from "react";
import { getCurrentTitleScale, scaleMultiplier } from "../../utils/scale";

export type SectionTitleProps = {
    label: string;
    dimmed?: boolean;
    action?: ReactNode;
};

export function SectionTitle(props: SectionTitleProps) {
    return (
        <PanelSectionRow>
            <div
                style={{
                    display: "flex",
                    width: "100%",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px 0 4px"
                }}
            >
                <div
                    style={{
                        flex: 1,
                        minWidth: 0,
                        overflowWrap: "break-word",
                        fontSize: `${scaleMultiplier(getCurrentTitleScale())}em`,
                        fontWeight: 700,
                        textAlign: "center",
                        opacity: props.dimmed ? 0.6 : 1
                    }}
                >
                    {props.label}
                </div>
                {props.action}
            </div>
        </PanelSectionRow>
    );
}
