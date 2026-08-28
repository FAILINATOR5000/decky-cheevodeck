import React from "react";
import { DialogButton, Focusable } from "@decky/ui";
import { NOTES_DOT_KEYFRAMES, regularButtonSpacingStyle, warnAmber } from "../../utils/style";
import { QuickGuideColumn, QuickGuidePin } from "../guides/QuickGuidePin";
import { useQuickGuide } from "../../utils/quickGuide";
import { useNotificationsChrome } from "../notifications/NotificationsContext";
import type { ButtonSpacing } from "../../types";
import { getCurrentTitleScale, scaleMultiplier } from "../../utils/scale";

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function BellIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 448 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M224 512c35.32 0 63.97-28.65 63.97-64H160.03c0 35.35 28.65 64 63.97 64zm215.39-149.71c-19.32-20.76-55.47-51.99-55.47-154.29 0-77.7-54.48-139.9-127.94-155.16V32c0-17.67-14.32-32-31.98-32s-31.98 14.33-31.98 32v20.84C118.56 68.1 64.08 130.3 64.08 208c0 102.3-36.15 133.53-55.47 154.29-6 6.45-8.66 14.16-8.61 21.71.11 16.4 12.98 32 32.1 32h383.8c19.12 0 32-15.6 32.1-32 .05-7.55-2.61-15.27-8.61-21.71z" />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function BellSlashIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 640 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M633.82 458.1l-90.62-70.05c.19-1.38.8-2.66.8-4.06.05-7.55-2.61-15.27-8.61-21.71-19.32-20.76-55.47-51.99-55.47-154.29 0-77.7-54.48-139.9-127.94-155.16V32c0-17.67-14.32-32-31.98-32s-31.98 14.33-31.98 32v20.84c-40.33 8.38-74.66 31.07-97.59 62.57L45.47 3.37C38.49-2.05 28.43-.8 23.01 6.18L3.37 31.45C-2.05 38.42-.8 48.47 6.18 53.9l588.35 454.73c6.98 5.43 17.03 4.17 22.46-2.81l19.64-25.27c5.42-6.97 4.17-17.02-2.81-22.45zM157.23 251.54c-8.61 67.96-36.41 93.33-52.62 110.75-6 6.45-8.66 14.16-8.61 21.71.11 16.4 12.98 32 32.1 32h241.92L157.23 251.54zM320 512c35.32 0 63.97-28.65 63.97-64H256.03c0 35.35 28.65 64 63.97 64z" />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function HomeIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 576 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M280.37 148.26L96 300.11V464a16 16 0 0 0 16 16l112.06-.29a16 16 0 0 0 15.92-16V368a16 16 0 0 1 16-16h64a16 16 0 0 1 16 16v95.64a16 16 0 0 0 16 16.05L464 480a16 16 0 0 0 16-16V300L295.67 148.26a12.19 12.19 0 0 0-15.3 0zM571.6 251.47L488 182.56V44.05a12 12 0 0 0-12-12h-56a12 12 0 0 0-12 12v72.61L318.47 43a48 48 0 0 0-61 0L4.34 251.47a12 12 0 0 0-1.6 16.9l25.5 31A12 12 0 0 0 45.15 301l235.22-193.74a12.19 12.19 0 0 1 15.3 0L530.9 301a12 12 0 0 0 16.9-1.6l25.5-31a12 12 0 0 0-1.7-16.93z" />
        </svg>
    );
}

const HEADER_SCROLL_CLEARANCE_PX = 24;

const navButtonStyle: React.CSSProperties = {
    minWidth: 0,
    width: "36px",
    height: "36px",
    padding: "2px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    scrollMarginTop: `${HEADER_SCROLL_CLEARANCE_PX}px`
};

type PageNavStripProps = {
    title: string;
    buttonSpacing: ButtonSpacing;
    onHome: () => void | Promise<void>;
};

export function PageNavStrip(props: PageNavStripProps) {
    const quickGuide = useQuickGuide();
    const notifications = useNotificationsChrome();

    const iconRow = (
        <Focusable
            flow-children="row"
            style={{ display: "flex", gap: "6px" }}
        >
            <div style={{ position: "relative" }}>
                <DialogButton
                    onClick={() => { void props.onHome(); }}
                    style={navButtonStyle}
                >
                    <HomeIcon size={18} />
                </DialogButton>
            </div>
            <div style={{ position: "relative" }}>
                <DialogButton
                    onClick={notifications.openNotifications}
                    style={navButtonStyle}
                >
                    {notifications.doNotDisturb ? <BellSlashIcon size={18} /> : <BellIcon size={18} />}
                </DialogButton>
                {notifications.hasUnread && (
                    <div
                        className="da-notes-dot"
                        style={{
                            position: "absolute",
                            top: "-4px",
                            right: "-4px",
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            background: warnAmber,
                            boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
                            animation: "da-notes-dot-pulse 3.2s ease-in-out infinite"
                        }}
                    >
                        <style>{NOTES_DOT_KEYFRAMES}</style>
                    </div>
                )}
            </div>
        </Focusable>
    );

    return (
        <div
            style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                width: "100%",
                ...regularButtonSpacingStyle(props.buttonSpacing)
            }}
        >
            <div
                style={{
                    fontSize: `${scaleMultiplier(getCurrentTitleScale())}em`,
                    textTransform: "uppercase",
                    fontWeight: 700,
                    color: "#ffffff",
                    letterSpacing: "0.5px",
                    display: "flex",
                    alignItems: "center",
                    height: "36px"
                }}
            >
                {props.title}
            </div>
            {quickGuide.visible ? (
                <QuickGuideColumn>
                    <div data-focus-key="quickguide:pin" style={{ display: "flex" }}>
                        <QuickGuidePin onPress={quickGuide.onPress} />
                    </div>
                    {iconRow}
                </QuickGuideColumn>
            ) : iconRow}
        </div>
    );
}
