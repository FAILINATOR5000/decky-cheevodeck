import { DialogButton, PanelSectionRow } from "@decky/ui";

const ANCHOR_HEIGHT_PX = 2;

const DECKY_BAR_HEADROOM_PX = 80;

export type BottomFocusAnchorProps = {
    focusKey: string;
    onClick?: () => void;
    headroomPx?: number;
};

export function BottomFocusAnchor(props: BottomFocusAnchorProps) {
    const { focusKey, onClick, headroomPx = DECKY_BAR_HEADROOM_PX } = props;
    return (
        <>
            <PanelSectionRow>
                <div
                    data-focus-key={focusKey}
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
                </div>
            </PanelSectionRow>
            <div style={{ height: `${headroomPx}px` }} />
        </>
    );
}
