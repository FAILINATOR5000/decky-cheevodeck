import { DialogButton } from "@decky/ui";
import type { ReactNode } from "react";

export type SubTabIconKind = "trophy" | "comment" | "wall" | "activity" | "scale" | "hash";

function TrophyIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            xmlns="http://www.w3.org/2000/svg"
            focusable="false"
        >
            <path
                fill="currentColor"
                d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.2a5 5 0 0 1-3.8 3.9V18h3v2H9v-2h3v-2.1A5 5 0 0 1 8.2 12H8a4 4 0 0 1-4-4V5h3V3zm0 4H6v1a2 2 0 0 0 1 1.7V7zm10 0v2.7A2 2 0 0 0 18 8V7h-1z"
            />
        </svg>
    );
}

function CommentIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            xmlns="http://www.w3.org/2000/svg"
            focusable="false"
        >
            <path
                fill="currentColor"
                d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
            />
        </svg>
    );
}

function WallIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            xmlns="http://www.w3.org/2000/svg"
            focusable="false"
        >
            <path
                fill="currentColor"
                d="M9 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6v.5H3V20zm13-15h5a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 21 12v2l-2.5-2H16a1.5 1.5 0 0 1-1.5-1.5v-4A1.5 1.5 0 0 1 16 5z"
            />
        </svg>
    );
}

function ActivityIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            xmlns="http://www.w3.org/2000/svg"
            focusable="false"
        >
            <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2 12h4l2-6 3.5 12L15 9l1.5 3H22"
            />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function ScaleIcon() {
    return (
        <svg
            viewBox="0 0 640 512"
            width="18"
            height="18"
            xmlns="http://www.w3.org/2000/svg"
            fill="currentColor"
            focusable="false"
        >
            <path d="M384 32H512c17.7 0 32 14.3 32 32s-14.3 32-32 32H398.4c-5.2 25.8-22.9 47.1-46.4 57.3V448H512c17.7 0 32 14.3 32 32s-14.3 32-32 32H320 128c-17.7 0-32-14.3-32-32s14.3-32 32-32H288V153.3c-23.5-10.3-41.2-31.6-46.4-57.3H128c-17.7 0-32-14.3-32-32s14.3-32 32-32H256c14.6-19.4 37.8-32 64-32s49.4 12.6 64 32zm55.6 288H584.4L512 195.8 439.6 320zM512 416c-62.9 0-115.2-34-126-78.9c-2.6-11 1-22.3 6.7-32.1l95.2-163.2c5-8.6 14.2-13.8 24.1-13.8s19.1 5.3 24.1 13.8l95.2 163.2c5.7 9.8 9.3 21.1 6.7 32.1C627.2 382 574.9 416 512 416zM126.8 195.8L54.4 320H199.3L126.8 195.8zM.9 337.1c-2.6-11 1-22.3 6.7-32.1l95.2-163.2c5-8.6 14.2-13.8 24.1-13.8s19.1 5.3 24.1 13.8l95.2 163.2c5.7 9.8 9.3 21.1 6.7 32.1C242 382 189.7 416 126.8 416S11.7 382 .9 337.1z" />
        </svg>
    );
}

function HashIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            xmlns="http://www.w3.org/2000/svg"
            focusable="false"
        >
            <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.5 3 7.5 21 M16.5 3 14.5 21 M4 8.5H20 M3.5 15.5H19.5"
            />
        </svg>
    );
}

export function subTabIcon(kind: SubTabIconKind) {
    if (kind === "comment") {
        return <CommentIcon />;
    }
    if (kind === "wall") {
        return <WallIcon />;
    }
    if (kind === "activity") {
        return <ActivityIcon />;
    }
    if (kind === "scale") {
        return <ScaleIcon />;
    }
    if (kind === "hash") {
        return <HashIcon />;
    }
    return <TrophyIcon />;
}

type SubTabIconButtonProps = {
    icon: ReactNode;
    active: boolean;
    onClick: () => void;
    focusKey: string;
};

export function SubTabIconButton(props: SubTabIconButtonProps) {
    return (
        <div data-focus-key={props.focusKey} style={{ display: "flex", flex: 1 }}>
            <DialogButton
                onClick={props.onClick}
                style={{
                    minWidth: 0,
                    width: "100%",
                    padding: "4px 10px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: props.active ? 1 : 0.72,
                    outline: props.active ? "1px solid rgba(255,255,255,0.65)" : undefined
                }}
            >
                {props.icon}
            </DialogButton>
        </div>
    );
}
