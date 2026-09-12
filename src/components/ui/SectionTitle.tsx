import { PanelSectionRow } from "@decky/ui";
import type { ReactNode } from "react";
import { getCurrentTitleScale, scaleMultiplier } from "../../utils/scale";

export type SectionTitleProps = {
    label: string;
    dimmed?: boolean;
    action?: ReactNode;
    align?: "center" | "start";
    scaled?: boolean;
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
                        fontSize: props.scaled === false
                            ? "1em"
                            : `${scaleMultiplier(getCurrentTitleScale())}em`,
                        fontWeight: 700,
                        textAlign: props.align ?? "center",
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
