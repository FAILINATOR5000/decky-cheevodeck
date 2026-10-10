import { quickAccessMenuClasses } from "@decky/ui";
import type { ReactNode } from "react";
import { headerCase } from "../../utils/style";

type SectionHeaderRowProps = {
    first: boolean;
    children: ReactNode;
};

export function SectionHeaderRow(props: SectionHeaderRowProps) {
    return (
        <div style={{ paddingTop: props.first ? 0 : "24px" }}>
            <div className={quickAccessMenuClasses.PanelSectionTitle}>
                <div style={{ display: "contents", textTransform: headerCase() }}>
                    {props.children}
                </div>
            </div>
        </div>
    );
}
