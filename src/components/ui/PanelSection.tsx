import { PanelSection as SteamPanelSection } from "@decky/ui";
import type { ReactNode } from "react";
import { headerCase } from "../../utils/style";

export type PanelSectionProps = {
    title?: ReactNode;
    children?: ReactNode;
    [prop: string]: unknown;
};

// Case-aware replacement for @decky/ui's PanelSection. Import this one.
export function PanelSection({ title, ...rest }: PanelSectionProps) {
    if (!title) {
        return <SteamPanelSection {...rest} />;
    }

    return (
        <SteamPanelSection
            {...rest}
            title={
                <div style={{ display: "contents", textTransform: headerCase() }}>
                    {title}
                </div>
            }
        />
    );
}
