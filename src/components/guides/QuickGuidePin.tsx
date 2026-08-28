import { DialogButton, Focusable } from "@decky/ui";
import type { ComponentProps, FC, ReactNode } from "react";
import { CollapseChevron } from "../ui/CollapseChevron";
import { getCurrentLanguage, t } from "../../locales";

const PIN_SCROLL_CLEARANCE_PX = 24;

const ColumnFocusable = Focusable as FC<ComponentProps<typeof Focusable> & { navEntryPreferPosition?: number }>;
const NAV_ENTER_BY_DIRECTION = 3;

export function QuickGuideColumn(props: { children: ReactNode }) {
    return (
        <ColumnFocusable
            flow-children="column"
            navEntryPreferPosition={NAV_ENTER_BY_DIRECTION}
            style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: "4px" }}
        >
            {props.children}
        </ColumnFocusable>
    );
}

type QuickGuidePinProps = {
    onPress: () => void;
    disabled?: boolean;
    previewed?: boolean;
    onGamepadFocus?: () => void;
    onGamepadBlur?: () => void;
};

export function QuickGuidePin(props: QuickGuidePinProps) {
    const label = t(getCurrentLanguage(), "quickguide_label");
    const showLabel = label.trim().length > 0 && label.length <= 6;

    return (
        <DialogButton
            onClick={props.onPress}
            onGamepadFocus={props.onGamepadFocus}
            onGamepadBlur={props.onGamepadBlur}
            disabled={props.disabled}
            style={{
                minWidth: 0,
                minHeight: 0,
                width: "100%",
                height: "18px",
                padding: "0 6px",
                lineHeight: "18px",
                fontSize: "10px",
                letterSpacing: "0.5px",
                textTransform: "uppercase",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "5px",
                borderRadius: "6px",
                scrollMarginTop: `${PIN_SCROLL_CLEARANCE_PX}px`,
                opacity: props.previewed ? 1 : 0.82,
                boxShadow: props.previewed
                    ? "0 0 0 2px rgba(255,255,255,0.55), 0 2px 8px rgba(0,0,0,0.35)"
                    : undefined
            }}
        >
            {showLabel && <span>{label}</span>}
            <CollapseChevron collapsed={false} size={10} />
        </DialogButton>
    );
}
