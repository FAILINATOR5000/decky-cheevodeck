import { PanelSection as SteamPanelSection } from "@decky/ui";
import type { ReactNode } from "react";
import type { HeaderStyle } from "../../types";
import { headerCase } from "../../utils/style";

export type PanelSectionProps = {
    title?: ReactNode;
    headerStyle?: HeaderStyle;
    children?: ReactNode;
    [prop: string]: unknown;
};

function titleCase(headerStyle: HeaderStyle | undefined): "none" | "uppercase" {
    if (!headerStyle) {
        return headerCase();
    }
    return headerStyle === "typed" ? "none" : "uppercase";
}

// Case-aware replacement for @decky/ui's PanelSection. Import this one.
export function PanelSection({ title, headerStyle, ...rest }: PanelSectionProps) {
    if (!title) {
        return <SteamPanelSection {...rest} />;
    }

    return (
        <SteamPanelSection
            {...rest}
            title={
                <div style={{ display: "contents", textTransform: titleCase(headerStyle) }}>
                    {title}
                </div>
            }
        />
    );
}
