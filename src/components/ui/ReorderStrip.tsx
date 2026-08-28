import { DialogButton, Focusable, PanelSectionRow } from "@decky/ui";
import type { ReorderDirection } from "../../types";

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
type IconProps = { size?: number };

function AnglesUpIcon({ size = 18 }: IconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 448 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M246.6 41.4c-12.5-12.5-32.8-12.5-45.3 0l-160 160c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L224 109.3 361.4 246.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3l-160-160zm160 352-160-160c-12.5-12.5-32.8-12.5-45.3 0l-160 160c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L224 301.3l137.4 137.3c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3z" />
        </svg>
    );
}

function ArrowUpIcon({ size = 18 }: IconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 384 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M214.6 41.4c-12.5-12.5-32.8-12.5-45.3 0l-160 160c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L160 141.2V448c0 17.7 14.3 32 32 32s32-14.3 32-32V141.2L329.4 246.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3l-160-160z" />
        </svg>
    );
}

function ArrowDownIcon({ size = 18 }: IconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 384 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M169.4 470.6c12.5 12.5 32.8 12.5 45.3 0l160-160c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 370.8V64c0-17.7-14.3-32-32-32s-32 14.3-32 32V370.8L54.6 265.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l160 160z" />
        </svg>
    );
}

function AnglesDownIcon({ size = 18 }: IconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 448 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M246.6 470.6c-12.5 12.5-32.8 12.5-45.3 0l-160-160c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L224 402.7l137.4-137.3c12.5-12.5 32.8-12.5 45.3 0s12.5 32.8 0 45.3l-160 160zm160-352-160 160c-12.5 12.5-32.8 12.5-45.3 0l-160-160c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L224 210.7 361.4 73.4c12.5-12.5 32.8-12.5 45.3 0s12.5 32.8 0 45.3z" />
        </svg>
    );
}

export type ReorderStripProps = {
    targetId: number | string | null;
    onMove: (direction: ReorderDirection) => void;
    focusKeyPrefix?: string;
};

export function ReorderStrip(props: ReorderStripProps) {
    const { targetId, onMove, focusKeyPrefix = "tracked" } = props;

    const noTarget = targetId === null;

    function fireMove(direction: ReorderDirection) {
        if (noTarget) {
            return;
        }
        onMove(direction);
    }

    function handleTop() {
        fireMove("top");
    }

    function handleUp() {
        fireMove("up");
    }

    function handleDown() {
        fireMove("down");
    }

    function handleBottom() {
        fireMove("bottom");
    }

    const buttonStyle = {
        minWidth: 0,
        width: "44px",
        height: "38px",
        padding: "4px 2px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
    };

    return (
        <PanelSectionRow>
            <Focusable
                flow-children="row"
                style={{
                    display: "flex",
                    gap: "8px",
                    width: "100%",
                    justifyContent: "center",
                    padding: "6px 0"
                }}
            >
                <div data-focus-key={`${focusKeyPrefix}:reorder:moveTop`}>
                    <DialogButton
                        onClick={handleTop}
                        style={buttonStyle}
                    >
                        <AnglesUpIcon size={18} />
                    </DialogButton>
                </div>
                <div data-focus-key={`${focusKeyPrefix}:reorder:moveUp`}>
                    <DialogButton
                        onClick={handleUp}
                        style={buttonStyle}
                    >
                        <ArrowUpIcon size={18} />
                    </DialogButton>
                </div>
                <div data-focus-key={`${focusKeyPrefix}:reorder:moveDown`}>
                    <DialogButton
                        onClick={handleDown}
                        style={buttonStyle}
                    >
                        <ArrowDownIcon size={18} />
                    </DialogButton>
                </div>
                <div data-focus-key={`${focusKeyPrefix}:reorder:moveBottom`}>
                    <DialogButton
                        onClick={handleBottom}
                        style={buttonStyle}
                    >
                        <AnglesDownIcon size={18} />
                    </DialogButton>
                </div>
            </Focusable>
        </PanelSectionRow>
    );
}
