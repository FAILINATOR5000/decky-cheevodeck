import { quickAccessMenuClasses } from "@decky/ui";
import type { CSSProperties, ReactNode } from "react";
import { headerCase } from "../../utils/style";

type SectionHeaderRowProps = {
    first: boolean;
    children: ReactNode;
};

const VALVE_TITLE_STYLE: CSSProperties = {
    fontWeight: 600,
    lineHeight: "22px",
    letterSpacing: "0.5px",
    color: "rgba(255, 255, 255, 0.7)"
};

export function SectionHeaderRow(props: SectionHeaderRowProps) {
    const titleClass = quickAccessMenuClasses.PanelSectionTitle;
    return (
        <div style={{ paddingTop: props.first ? 0 : "24px" }}>
            <div className={titleClass} style={titleClass ? undefined : VALVE_TITLE_STYLE}>
                <div style={{ display: "contents", textTransform: headerCase() }}>
                    {props.children}
                </div>
            </div>
        </div>
    );
}
