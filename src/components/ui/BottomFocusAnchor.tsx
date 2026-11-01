import { DialogButton, PanelSectionRow } from "@decky/ui";
import { FocusTarget } from "./FocusTarget";

const ANCHOR_HEIGHT_PX = 2;

const DECKY_BAR_HEADROOM_PX = 80;

export type BottomFocusAnchorProps = {
    focusKey: string;
    focusFallback?: string[];
    onClick?: () => void;
    headroomPx?: number;
};

export function BottomFocusAnchor(props: BottomFocusAnchorProps) {
    const { focusKey, focusFallback, onClick, headroomPx = DECKY_BAR_HEADROOM_PX } = props;
    return (
        <>
            <PanelSectionRow>
                <FocusTarget
                    focusKey={focusKey}
                    focusFallback={focusFallback}
                    style={{ display: "flex", width: "100%", marginTop: "8px" }}
                >
                    <DialogButton
                        onClick={() => onClick?.()}
                        style={{
                            minWidth: 0,
                            minHeight: 0,
                            width: "100%",
                            height: `${ANCHOR_HEIGHT_PX}px`,
                            padding: "0"
                        }}
                    />
                </FocusTarget>
            </PanelSectionRow>
            <div style={{ height: `${headroomPx}px` }} />
        </>
    );
}
