import { DialogButton, Focusable, PanelSection, PanelSectionRow } from "@decky/ui";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { FaClipboardCheck, FaClock, FaCompressArrowsAlt, FaExpandAlt, FaFileAlt, FaGamepad, FaHistory, FaNetworkWired, FaSyncAlt, FaThumbtack, FaTrophy } from "react-icons/fa";
import { AchievementList } from "../components/achievements/AchievementList";
import { ButtonHints } from "../components/ui/ButtonHints";
import { playOkSound } from "../utils/navSound";
import { AwardStatusBadge } from "../components/achievements/AwardStatusBadge";
import { ErrorText } from "../components/ui/ErrorText";
import { FadeImage } from "../components/ui/FadeImage";
import { FocusClaim } from "../components/ui/FocusClaim";
import { FocusableItem } from "../components/ui/FocusableItem";
import { GuidesIcon } from "../components/guides/GuidesIcon";
import { InfoText } from "../components/ui/InfoText";
import { LabeledRow } from "../components/ui/LabeledRow";
import { subTabIcon, type SubTabIconKind } from "../components/ui/SubTabIconButton";
import { NowPlayingTabBody, type NowPlayingTabBodyProps } from "../components/social/NowPlayingTabBody";
import { RestoreCurtain } from "../components/ui/RestoreCurtain";
import { QuickGuideColumn, QuickGuidePin } from "../components/guides/QuickGuidePin";
import { ToggleRow } from "../components/ui/ToggleRow";
import { UserAvatar } from "../components/ui/UserAvatar";
import {
    clearGameTickerEvent,
    getGameTickerEvent,
    clearSocialHubTickerEvent,
    getSocialHubTickerEvent,
    getPendingGameNoteReminders,
    ackGameNoteReminders
} from "../api";
import type { LanguageCode } from "../locales";
import type {
    AchievementRow,
    AchievementSort,
    AchievementStyle,
    ActivityCardAction,
    ControllerGlyphStyle,
    ButtonSpacing,
    FriendsPayload,
    GameNoteReminderFiring,
    GameTickerEvent,
    MainAchievementAction,
    MainAchievementFilter,
    MainAchievementsTab,
    NowPlayingSubView,
    Payload,
    QuickMenuShortcut,
    SocialActivityEvent,
    SocialHubTickerEvent,
    TrackedColor,
    TrackedNotes,
    TrackedNotesColor,
    UiSize,
    ViewKey
} from "../types";

import { achievementUiMetrics } from "../utils/style";
import { useQuickGuide } from "../utils/quickGuide";
import { localizeRuntimeText, t } from "../locales";
import { QUICK_MENU_SHORTCUTS, type MainUiPreset } from "../utils/options";
import {
    achievementSortLabel,
    mainAchievementFilterLabel,
    nextAchievementSort,
    nextMainAchievementFilter,
    parseNoteTag,
    payloadAchievementSummaryLabel
} from "../utils/achievements";
import { BUTTON_OPTIONS, BUTTON_SECONDARY } from "../utils/gamepadButtons";
import { NOTES_DOT_KEYFRAMES, regularButtonSpacingStyle, smallTextStyle, bodyTextStyle, achievementGreen, warnAmber, skyBlue } from "../utils/style";
import { headerSize } from "../utils/scale";
import { consoleInlineName } from "../utils/consoles";

const GAME_TICKER_FRESHNESS_MS = 60 * 60 * 1000;

const FIRST_FOCUSABLE_SCROLL_MARGIN_PX = 24;

const NAV_ENTER_PREFERRED_CHILD = 4;

const TAB_UNDER_QUICK_ACTION: Record<QuickActionId, MainAchievementsTab> = {
    tracked: "achievements",
    notes: "comments",
    guides: "comments",
    history: "activity",
    leaderboards: "compare"
};
const QUICK_ACTION_ABOVE_TAB: Record<MainAchievementsTab, QuickActionId> = {
    achievements: "tracked",
    comments: "notes",
    activity: "history",
    compare: "leaderboards"
};
const NAV_ENTER_MAINTAIN_X = 2;

const QUICK_MENU_ROW_GAP = "6px";


type QuickActionId = "tracked" | "notes" | "guides" | "history" | "leaderboards";

type QuickAction = {
    id: QuickActionId;
    Icon: ComponentType<{ size?: number }>;
    labelKey: string;
    focusKey: string;
};

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function NotesIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M497.9 74.17l-60.07-60.06C428.55 4.74 416.27 0 403.99 0c-12.28 0-24.56 4.69-33.94 14.06L14.06 370.05L.41 491.2c-1.5 13.32 9.83 24.7 22.59 24.7c.83 0 1.66-.05 2.5-.15l121.13-13.46l356.06-355.98c18.71-18.75 18.71-49.16-.79-72.14zm-216.7 22.65L405 220.59L130.8 494.66l-86.97 9.66l9.7-87.02L281.2 96.82zm196.51 18.7L443.49 153L325.99 35.5l34.21-34.21c4.69-4.69 12.28-4.69 16.97 0l60.07 60.06c4.69 4.69 4.69 12.29 0 16.98z" />
        </svg>
    );
}

function LeaderboardIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 24 24"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M3 10h5v11H3zM9.5 6h5v15h-5zM16 13h5v8h-5z" />
        </svg>
    );
}

function QuickMenuIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 24 24"
            width={size}
            height={size}
            fill="currentColor"
        >
            <rect x="3" y="5" width="18" height="2.4" rx="1.2" />
            <rect x="3" y="10.8" width="18" height="2.4" rx="1.2" />
        </svg>
    );
}

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
function TickerCloseIcon() {
    return (
        <svg
            viewBox="0 0 352 512"
            width="1.1em"
            height="1.1em"
            fill="currentColor"
            style={{ display: "block" }}
        >
            <path d="M242.72 256l100.07-100.07c12.28-12.28 12.28-32.19 0-44.48l-22.24-22.24c-12.28-12.28-32.19-12.28-44.48 0L176 189.28 75.93 89.21c-12.28-12.28-32.19-12.28-44.48 0L9.21 111.45c-12.28 12.28-12.28 32.19 0 44.48L109.28 256 9.21 356.07c-12.28 12.28-12.28 32.19 0 44.48l22.24 22.24c12.28 12.28 32.2 12.28 44.48 0L176 322.72l100.07 100.07c12.28 12.28 32.2 12.28 44.48 0l22.24-22.24c12.28-12.28 12.28-32.19 0-44.48L242.72 256z" />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function SearchIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M505 442.7L405.3 343c-4.5-4.5-10.6-7-17-7H372c27.6-35.3 44-79.7 44-128C416 93.1 322.9 0 208 0S0 93.1 0 208s93.1 208 208 208c48.3 0 92.7-16.4 128-44v16.3c0 6.4 2.5 12.5 7 17l99.7 99.7c9.4 9.4 24.6 9.4 33.9 0l28.3-28.3c9.4-9.4 9.4-24.6.1-34zM208 336c-70.7 0-128-57.2-128-128 0-70.7 57.2-128 128-128 70.7 0 128 57.2 128 128 0 70.7-57.2 128-128 128z" />
        </svg>
    );
}


// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function LayerGroupIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 576 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M264.5 5.2c14.9-6.9 32.1-6.9 47 0l218.6 101c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L45.9 149.8C37.4 145.8 32 137.3 32 128s5.4-17.9 13.9-21.8L264.5 5.2zM476.9 209.6l53.2 24.6c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L45.9 277.8C37.4 273.8 32 265.3 32 256s5.4-17.9 13.9-21.8l53.2-24.6 152 70.2c23.4 10.8 50.4 10.8 73.8 0l152-70.2zm-152 198.2l152-70.2 53.2 24.6c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L45.9 405.8C37.4 401.8 32 393.3 32 384s5.4-17.9 13.9-21.8l53.2-24.6 152 70.2c23.4 10.8 50.4 10.8 73.8 0z" />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function FriendsIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 640 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M144 0a80 80 0 1 1 0 160A80 80 0 1 1 144 0zM512 0a80 80 0 1 1 0 160A80 80 0 1 1 512 0zM0 298.7C0 239.8 47.8 192 106.7 192h42.7c15.9 0 31 3.5 44.6 9.7c-1.3 7.2-1.9 14.7-1.9 22.3c0 38.2 16.8 72.5 43.3 96c-.2 0-.4 0-.7 0H21.3C9.6 320 0 310.4 0 298.7zM405.3 320c-.2 0-.4 0-.7 0c26.6-23.5 43.3-57.8 43.3-96c0-7.6-.7-15-1.9-22.3c13.6-6.3 28.7-9.7 44.6-9.7h42.7C592.2 192 640 239.8 640 298.7c0 11.8-9.6 21.3-21.3 21.3H405.3zM224 224a96 96 0 1 1 192 0 96 96 0 1 1 -192 0zM128 485.3C128 411.7 187.7 352 261.3 352H378.7C452.3 352 512 411.7 512 485.3c0 14.7-11.9 26.7-26.7 26.7H154.7c-14.7 0-26.7-11.9-26.7-26.7z" />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function MoonIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M279.135 512c78.756 0 150.982-35.804 198.844-94.775 28.27-34.831-2.558-85.722-46.249-77.401-82.348 15.683-158.272-47.268-158.272-130.792 0-48.424 26.06-92.292 67.434-115.836 38.745-22.05 28.999-80.788-15.022-88.919A257.936 257.936 0 0 0 279.135 0c-141.36 0-256 114.575-256 256 0 141.36 114.576 256 256 256z" />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function BatteryHalfIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 640 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M544 160v64h32v64h-32v64H64V160h480m16-64H48c-26.51 0-48 21.49-48 48v224c0 26.51 21.49 48 48 48h512c26.51 0 48-21.49 48-48v-16h8c13.255 0 24-10.745 24-24V184c0-13.255-10.745-24-24-24h-8v-16c0-26.51-21.49-48-48-48zm-256 96H96v128h208V192z" />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function KeyboardIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 576 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M528 448H48c-26.51 0-48-21.49-48-48V112c0-26.51 21.49-48 48-48h480c26.51 0 48 21.49 48 48v288c0 26.51-21.49 48-48 48zm-48-84v-8c0-6.627-5.373-12-12-12H108c-6.627 0-12 5.373-12 12v8c0 6.627 5.373 12 12 12h360c6.627 0 12-5.373 12-12zm-24-96v-8c0-6.627-5.373-12-12-12h-40c-6.627 0-12 5.373-12 12v8c0 6.627 5.373 12 12 12h40c6.627 0 12-5.373 12-12zm-96 0v-8c0-6.627-5.373-12-12-12h-40c-6.627 0-12 5.373-12 12v8c0 6.627 5.373 12 12 12h40c6.627 0 12-5.373 12-12zm-96 0v-8c0-6.627-5.373-12-12-12h-40c-6.627 0-12 5.373-12 12v8c0 6.627 5.373 12 12 12h40c6.627 0 12-5.373 12-12zm-96 0v-8c0-6.627-5.373-12-12-12h-40c-6.627 0-12 5.373-12 12v8c0 6.627 5.373 12 12 12h40c6.627 0 12-5.373 12-12zm-96 0v-8c0-6.627-5.373-12-12-12h-40c-6.627 0-12 5.373-12 12v8c0 6.627 5.373 12 12 12h40c6.627 0 12-5.373 12-12zm384-96v-8c0-6.627-5.373-12-12-12h-40c-6.627 0-12 5.373-12 12v8c0 6.627 5.373 12 12 12h40c6.627 0 12-5.373 12-12zm-96 0v-8c0-6.627-5.373-12-12-12h-40c-6.627 0-12 5.373-12 12v8c0 6.627 5.373 12 12 12h40c6.627 0 12-5.373 12-12zm-96 0v-8c0-6.627-5.373-12-12-12h-40c-6.627 0-12 5.373-12 12v8c0 6.627 5.373 12 12 12h40c6.627 0 12-5.373 12-12zm-96 0v-8c0-6.627-5.373-12-12-12h-40c-6.627 0-12 5.373-12 12v8c0 6.627 5.373 12 12 12h40c6.627 0 12-5.373 12-12zm-96 0v-8c0-6.627-5.373-12-12-12H108c-6.627 0-12 5.373-12 12v8c0 6.627 5.373 12 12 12h40c6.627 0 12-5.373 12-12z" />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function GearIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M495.9 166.6c3.2 8.7.5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.2 9.6 15.9 6.4 24.6-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9 16.3-18.2 17.8-13.8 2.3-28 3.5-42.5 3.5s-28.7-1.2-42.5-3.5c-9.2-1.5-16.2-8.7-18.2-17.8l-12.5-57.1c-15.8-6.5-30.6-15.1-44-25.4L83.1 425.9c-8.8 2.8-18.6.3-24.5-6.8-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C64.6 273.1 64 264.6 64 256s.6-17.1 1.7-25.4L22.4 191.2c-6.9-6.2-9.6-15.9-6.4-24.6 4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2 5.9-7.2 15.7-9.6 24.5-6.8l55.7 17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9-16.3 18.2-17.8C227.3 1.2 241.5 0 256 0s28.7 1.2 42.5 3.5c9.2 1.5 16.2 8.7 18.2 17.8l12.5 57.1c15.8 6.5 30.6 15.1 44 25.4l55.7-17.7c8.8-2.8 18.6-.3 24.5 6.8 8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z" />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function InfoCircleIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M256 8C119 8 8 119 8 256s111 248 248 248 248-111 248-248S393 8 256 8zm0 110c23.196 0 42 18.804 42 42s-18.804 42-42 42-42-18.804-42-42 18.804-42 42-42zm56 254c0 6.627-5.373 12-12 12h-88c-6.627 0-12-5.373-12-12v-24c0-6.627 5.373-12 12-12h12v-64h-12c-6.627 0-12-5.373-12-12v-24c0-6.627 5.373-12 12-12h64c6.627 0 12 5.373 12 12v100h12c6.627 0 12 5.373 12 12v24z" />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function CircleUserIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M399 384.2C376.9 345.8 335.4 320 288 320H224c-47.4 0-88.9 25.8-111 64.2c35.2 39.2 86.2 63.8 143 63.8s107.8-24.7 143-63.8zM0 256a256 256 0 1 1 512 0A256 256 0 1 1 0 256zm256 16a72 72 0 1 0 0-144 72 72 0 1 0 0 144z" />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function ScrewdriverWrenchIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M78.6 5C69.1-2.4 55.6-1.5 47 7L7 47c-8.5 8.5-9.4 22-2.1 31.6l80 104c4.5 5.9 11.6 9.4 19 9.4h54.1l109 109c-14.7 29-10 65.4 14.3 89.6l112 112c12.5 12.5 32.8 12.5 45.3 0l64-64c12.5-12.5 12.5-32.8 0-45.3l-112-112c-24.2-24.2-60.6-29-89.6-14.3l-109-109V104c0-7.5-3.5-14.5-9.4-19L78.6 5zM19.9 396.1C7.2 408.8 0 426.1 0 444.1C0 481.6 30.4 512 67.9 512c18 0 35.3-7.2 48-19.9L233.7 374.3c-7.8-20.9-9-43.6-3.6-65.1l-61.7-61.7L19.9 396.1zM512 144c0-10.5-1.1-20.7-3.2-30.5c-2.4-11.2-16.1-14.1-24.2-6l-63.9 63.9c-3 3-7.1 4.7-11.3 4.7H352c-8.8 0-16-7.2-16-16V102.6c0-4.2 1.7-8.3 4.7-11.3l63.9-63.9c8.1-8.1 5.2-21.8-6-24.2C388.7 1.1 378.5 0 368 0C288.5 0 224 64.5 224 144l0 .8 85.3 85.3c36-9.1 75.8 .5 104 28.7L429 274.5c49-23 83-72.8 83-130.5zM56 432a24 24 0 1 1 48 0 24 24 0 1 1 -48 0z" />
        </svg>
    );
}

function ChevronRightIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            xmlns="http://www.w3.org/2000/svg"
            focusable="false"
        >
            <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5l7 7-7 7"
            />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function NewspaperIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 576 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M552 64H88c-13.255 0-24 10.745-24 24v8H24c-13.255 0-24 10.745-24 24v272c0 30.928 25.072 56 56 56h472c26.51 0 48-21.49 48-48V88c0-13.255-10.745-24-24-24zM56 400a8 8 0 0 1-8-8V144h16v248a8 8 0 0 1-8 8zm236-16H140c-6.627 0-12-5.373-12-12v-8c0-6.627 5.373-12 12-12h152c6.627 0 12 5.373 12 12v8c0 6.627-5.373 12-12 12zm208 0H348c-6.627 0-12-5.373-12-12v-8c0-6.627 5.373-12 12-12h152c6.627 0 12 5.373 12 12v8c0 6.627-5.373 12-12 12zm-208-96H140c-6.627 0-12-5.373-12-12v-8c0-6.627 5.373-12 12-12h152c6.627 0 12 5.373 12 12v8c0 6.627-5.373 12-12 12zm208 0H348c-6.627 0-12-5.373-12-12v-8c0-6.627 5.373-12 12-12h152c6.627 0 12 5.373 12 12v8c0 6.627-5.373 12-12 12zm0-96H140c-6.627 0-12-5.373-12-12v-40c0-6.627 5.373-12 12-12h360c6.627 0 12 5.373 12 12v40c0 6.627-5.373 12-12 12z" />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function MedalIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M223.75 130.75L154.62 15.54A31.997 31.997 0 0 0 127.18 0H16.03C3.08 0-4.5 14.57 2.92 25.18l111.27 158.96c29.72-27.77 67.52-46.83 109.56-53.39zM495.97 0H384.82c-11.24 0-21.66 5.9-27.44 15.54l-69.13 115.21c42.04 6.56 79.84 25.62 109.56 53.38L509.08 25.18C516.5 14.57 508.92 0 495.97 0zM256 160c-97.2 0-176 78.8-176 176s78.8 176 176 176 176-78.8 176-176-78.8-176-176-176zm92.52 157.26l-37.93 36.96 8.97 52.22c1.6 9.36-8.26 16.51-16.65 12.09L256 393.88l-46.9 24.65c-8.4 4.45-18.25-2.74-16.65-12.09l8.97-52.22-37.93-36.96c-6.82-6.64-3.05-18.23 6.35-19.59l52.43-7.64 23.43-47.52c2.11-4.28 6.19-6.39 10.28-6.39 4.11 0 8.22 2.14 10.33 6.39l23.43 47.52 52.43 7.64c9.4 1.36 13.17 12.95 6.35 19.59z" />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function CompactDiscIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 496 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M248 8C111 8 0 119 0 256s111 248 248 248 248-111 248-248S385 8 248 8zM88 256H56c0-105.9 86.1-192 192-192v32c-88.2 0-160 71.8-160 160zm160 96c-53 0-96-43-96-96s43-96 96-96 96 43 96 96-43 96-96 96zm0-128c-17.7 0-32 14.3-32 32s14.3 32 32 32 32-14.3 32-32-14.3-32-32-32z" />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function CommentsIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 576 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M416 192c0-88.4-93.1-160-208-160S0 103.6 0 192c0 34.3 14.1 65.9 38 92-13.4 30.2-35.5 54.2-35.8 54.5-2.2 2.3-2.8 5.7-1.5 8.7S4.8 352 8 352c36.6 0 66.9-12.3 88.7-25 32.2 15.7 70.3 25 111.3 25 114.9 0 208-71.6 208-160zm122 220c23.9-26 38-57.7 38-92 0-66.9-53.5-124.2-129.3-148.1.9 6.6 1.3 13.3 1.3 20.1 0 105.9-107.7 192-240 192-10.8 0-21.3-.8-31.7-1.9C207.8 439.6 281.8 480 368 480c41 0 79.1-9.2 111.3-25 21.8 12.7 52.1 25 88.7 25 3.2 0 6.1-1.9 7.3-4.8 1.3-2.9.7-6.3-1.5-8.7-.3-.3-22.4-24.2-35.8-54.5z" />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function BookmarkIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 384 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M0 512V48C0 21.49 21.49 0 48 0h288c26.51 0 48 21.49 48 48v464L192 400 0 512z" />
        </svg>
    );
}

const QUICK_ACTIONS: QuickAction[] = [
    { id: "tracked", Icon: FaThumbtack, labelKey: "View Tracked", focusKey: "quick:tab:tracked" },
    { id: "notes", Icon: NotesIcon, labelKey: "Notes", focusKey: "quick:tab:notes" },
    { id: "guides", Icon: GuidesIcon, labelKey: "Guides", focusKey: "quick:tab:guides" },
    { id: "history", Icon: FaHistory, labelKey: "Unlock History", focusKey: "quick:tab:history" },
    { id: "leaderboards", Icon: LeaderboardIcon, labelKey: "Leaderboards", focusKey: "quick:tab:leaderboards" }
];

const MAIN_TABS: { value: MainAchievementsTab; focusKey: string; icon: SubTabIconKind }[] = [
    { value: "achievements", focusKey: "main:tab:achievements", icon: "trophy" },
    { value: "comments", focusKey: "main:tab:comments", icon: "comment" },
    { value: "activity", focusKey: "main:tab:activity", icon: "activity" },
    { value: "compare", focusKey: "main:tab:compare", icon: "scale" }
];

type QuickMenuId = "useraccounts" | "utilities" | "trackedsets" | "socialhub" | "options" | "about" | "news" | "aotw" | "newsets" | "subscribeddiscussions" | "savedcomments";

type StripButtonId =
    | "profile" | "quickmenu" | "quickguide" | "notifications"
    | "useraccounts" | "utilities" | "trackedsets" | "socialhub" | "options" | "about"
    | "refresh" | "news" | "aotw" | "newsets" | "subscribeddiscussions" | "savedcomments"
    | "dnd" | "nightmode" | "batterysaver" | "mkmode"
    | QuickMenuShortcut;

type QuickMenuEntry = {
    id: QuickMenuId;
    Icon: ComponentType<{ size?: number }>;
    labelKey: string;
    focusKey: string;
};

const QUICK_MENU_TOP_ROW: QuickMenuEntry[] = [
    { id: "socialhub", Icon: FriendsIcon, labelKey: "Social Hub", focusKey: "action:socialhub" },
    { id: "news", Icon: NewspaperIcon, labelKey: "News", focusKey: "action:news" },
    { id: "aotw", Icon: MedalIcon, labelKey: "Achievement of the Week", focusKey: "action:aotw" },
    { id: "newsets", Icon: CompactDiscIcon, labelKey: "New Sets & Revisions", focusKey: "action:newsets" },
    { id: "subscribeddiscussions", Icon: CommentsIcon, labelKey: "Subscribed Discussions", focusKey: "action:subscribeddiscussions" },
    { id: "savedcomments", Icon: BookmarkIcon, labelKey: "Saved Comments", focusKey: "action:savedcomments" }
];

const QUICK_MENU_BOTTOM_ROW: QuickMenuEntry[] = [
    { id: "trackedsets", Icon: LayerGroupIcon, labelKey: "Mastery Goals", focusKey: "action:trackedsets" },
    { id: "utilities", Icon: ScrewdriverWrenchIcon, labelKey: "Utilities", focusKey: "action:utilities" },
    { id: "useraccounts", Icon: CircleUserIcon, labelKey: "User Accounts", focusKey: "action:useraccounts" },
    { id: "options", Icon: GearIcon, labelKey: "Options", focusKey: "action:optionsmenu" },
    { id: "about", Icon: InfoCircleIcon, labelKey: "About", focusKey: "action:aboutmenu" }
];

const QUICK_MENU_SHORTCUT_ICONS: Record<QuickMenuShortcut, ComponentType<{ size?: number }>> = {
    dolphinMapper: FaGamepad,
    cheevoCheck: FaClipboardCheck,
    smbShares: FaNetworkWired,
    fileWatcher: FaFileAlt,
    socialActivity: FaClock,
    visitRa: FaTrophy,
    uiDefault: FaExpandAlt,
    uiCompact: FaCompressArrowsAlt
};

const QUICK_ACTION_REFRESH_SPIN = `
@keyframes da-quick-refresh-spin {
    to { transform: rotate(360deg); }
}
`;

const QUICK_MENU_SEARCH_STYLES = `
.da-quickmenu-search {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.14);
}
[class*="gpfocus"] .da-quickmenu-search,
[class*="GPFocus"] .da-quickmenu-search {
    background: rgba(0, 0, 0, 0.06);
    border-color: rgba(0, 0, 0, 0.30);
}
`;

type MainAchievementsPageProps = {
    state: {
        view: ViewKey;
        language: LanguageCode;
        buttonSpacing: ButtonSpacing;
        metrics: ReturnType<typeof achievementUiMetrics>;
        pendingFocusKey: string | null;
        achievementsInitialAutoFocusDone: boolean;
        mainEntryToken: number;
        mainStripClaim?: {
            token: number;
            armed: boolean;
        };
        mainEntryFromView: ViewKey | null;
        friendsPayload: FriendsPayload | null;
        saving: boolean;
        loading: boolean;
        payload: Payload | null;
        trackedIds: number[];
        notesByAchievementId: TrackedNotes;
        notesColorByAchievementId: TrackedNotesColor;
        error: string | null;
        focusScopeResetToken: number;
        achievementsResumeToken: number;
        showAllAchievements: boolean;
        showAllToggleMain: boolean;
        showTrackedNotesMain: boolean;
        showRetroPoints: boolean;
        showAButtonMode: boolean;
        controllerGlyphStyle: ControllerGlyphStyle;
        showSocialHubButton: boolean;
        showTrackedSetsButton: boolean;
        showOptionsButton: boolean;
        quickMenuShortcuts: QuickMenuShortcut[];
        achievementStyle: AchievementStyle;
        trackedColor: TrackedColor;
        mainAchievementFilter: MainAchievementFilter;
        mainAchievementSort: AchievementSort;
        mainAchievementAction: MainAchievementAction;
        mainFilteredAchievementCount: number;
        socialGameTicker: boolean;
        socialHubTicker: boolean;
        showReminderTicker: boolean;
        ownUsername: string;
        showIcons: boolean;
        gameIconDataUri: string | null;
        gameIngameDataUri: string | null;
        gameIconCold: boolean;
        gameIngameCold: boolean;
        uiSize: UiSize;
        topPadding: number;
        blockPadding: number;
        bigListThreshold: number;
        alwaysStaggerMounting: boolean;
        returnStaggerFrames: number;
        dynamicLoading: boolean;
        dynamicInitialRows: number;
        dynamicRowStep: number;
        dynamicPrefetchDistance: number;
        dynamicSentinelRootMargin: number;
        listResetToken: number;
        notesPendingReminderBadge: boolean;
        showNotesDot: boolean;
        notificationsHasUnread: boolean;
        mainTab: MainAchievementsTab;
        nightMode: boolean;
        doNotDisturb: boolean;
        batterySaver: boolean;
        mouseKeyboardMode: boolean;
        nowPlayingBody: NowPlayingTabBodyProps;
    };
    actions: {
        goToFriends: () => void | Promise<void>;
        onOpenProfile: () => void | Promise<void>;
        goToLeaderboards: () => void | Promise<void>;
        goToOptions: () => void | Promise<void>;
        goToAbout: () => void | Promise<void>;
        goToUnlockHistory: () => void | Promise<void>;
        goToGuides: () => void | Promise<void>;
        goToTracked: () => void | Promise<void>;
        goToTrackedSets: () => void | Promise<void>;
        openUserAccounts: () => void | Promise<void>;
        openUtils: () => void | Promise<void>;
        goToSocialNews: () => void | Promise<void>;
        goToSocialAotw: () => void | Promise<void>;
        goToSocialNewSets: () => void | Promise<void>;
        goToSocialSubscribed: () => void | Promise<void>;
        goToSocialSavedComments: () => void | Promise<void>;
        goToSocialActivity: () => void | Promise<void>;
        openDolphinMapper: () => void | Promise<void>;
        openCheevoCheck: () => void | Promise<void>;
        openSmbShares: () => void | Promise<void>;
        openFileWatcher: () => void | Promise<void>;
        openRaSite: () => void | Promise<void>;
        onApplyMainUiPreset: (preset: MainUiPreset) => void | Promise<void>;
        goToGameNotes: (focusKeyAfter?: string) => void | Promise<void>;
        onViewGameOverview: () => void | Promise<void>;
        onOpenNotifications: () => void;
        onManualRefresh: () => void | Promise<void>;
        onShowAllChange: (nextValue: boolean) => void | Promise<void>;
        onMainAchievementFilterChange: (nextValue: MainAchievementFilter) => void | Promise<void>;
        onMainAchievementSortChange: (nextValue: AchievementSort) => void | Promise<void>;
        onMainAchievementActionChange: (nextValue: MainAchievementAction) => void | Promise<void>;
        onAchievementClick: (achievement: AchievementRow) => void | Promise<void>;
        onAchievementTrackToggle: (achievement: AchievementRow) => void | Promise<void>;
        onSocialActivityClick: (event: SocialActivityEvent, action?: ActivityCardAction) => void | Promise<void>;
        onChangeMainTab: (tab: MainAchievementsTab) => void;
        onToggleNightMode: (next: boolean) => void | Promise<void>;
        onToggleDoNotDisturb: (next: boolean) => void | Promise<void>;
        onToggleBatterySaver: (next: boolean) => void | Promise<void>;
        onToggleMouseKeyboardMode: (next: boolean) => void | Promise<void>;
        onOpenGameSearch: () => void;
        onSpendMainStripClaim: () => void;
    };
};

function tickerEventKey(event: GameTickerEvent) {
    return [
        String(event.username || ""),
        String(event.achievementId ?? ""),
        String(event.gameId ?? ""),
        String(event.occurredAt ?? "")
    ].join("|");
}

function socialHubTickerEventKey(event: SocialHubTickerEvent) {
    return [
        String(event.username || ""),
        String(event.achievementId ?? ""),
        String(event.gameId ?? ""),
        String(event.occurredAt ?? "")
    ].join("|");
}

function isTickerEventFresh(event: { occurredAt?: string | null }) {
    const occurredAt = String(event.occurredAt || "").trim();
    if (!occurredAt) {
        return false;
    }
    const normalized = occurredAt.includes("T") ? occurredAt : occurredAt.replace(" ", "T");
    const withZone = normalized.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(normalized)
        ? normalized
        : `${normalized}Z`;
    const eventMs = new Date(withZone).getTime();
    if (Number.isNaN(eventMs)) {
        return false;
    }
    return Date.now() - eventMs <= GAME_TICKER_FRESHNESS_MS;
}

type TickerVariant = "just" | "recently" | "earned" | "unlocked";

const TICKER_VARIANTS: TickerVariant[] = ["just", "recently", "earned", "unlocked"];

function pickTickerVariant(): TickerVariant {
    return TICKER_VARIANTS[Math.floor(Math.random() * TICKER_VARIANTS.length)];
}

const GAME_TICKER_TEMPLATES: Record<TickerVariant, string> = {
    just: "{{user}} just unlocked {{achievement}}",
    recently: "{{user}} recently unlocked {{achievement}}",
    earned: "{{user}} earned {{achievement}}",
    unlocked: "{{user}} unlocked {{achievement}}"
};

const SOCIAL_HUB_TICKER_TEMPLATES: Record<TickerVariant, string> = {
    just: "{{user}} just unlocked {{achievement}} in {{game}}",
    recently: "{{user}} recently unlocked {{achievement}} in {{game}}",
    earned: "{{user}} earned {{achievement}} in {{game}}",
    unlocked: "{{user}} unlocked {{achievement}} in {{game}}"
};

function renderGameTickerLine(
    language: LanguageCode,
    event: GameTickerEvent,
    variant: TickerVariant
) {
    const userToken = "__TICKER_USER__";
    const achievementToken = "__TICKER_ACHIEVEMENT__";

    const text = t(language, GAME_TICKER_TEMPLATES[variant], {
        user: userToken,
        achievement: achievementToken
    });

    const username = String(event.username || "").trim();
    const achievementTitle = String(event.achievementTitle || "").trim();

    const userSpan = (
        <span style={{ fontWeight: 700 }}>
            {username}
        </span>
    );
    const achievementSpan = (
        <span style={{ color: achievementGreen, fontWeight: 800 }}>
            {`“${achievementTitle}”`}
        </span>
    );

    const pattern = /(__TICKER_(?:USER|ACHIEVEMENT)__)/g;
    return text.split(pattern).map(function pickPart(piece, index) {
        if (piece === userToken) {
            return <span key={`u:${index}`}>{userSpan}</span>;
        }
        if (piece === achievementToken) {
            return <span key={`a:${index}`}>{achievementSpan}</span>;
        }
        return piece;
    });
}

function renderSocialHubTickerLine(
    language: LanguageCode,
    event: SocialHubTickerEvent,
    variant: TickerVariant
) {
    const userToken = "__TICKER_USER__";
    const achievementToken = "__TICKER_ACHIEVEMENT__";
    const gameToken = "__TICKER_GAME__";

    const text = t(language, SOCIAL_HUB_TICKER_TEMPLATES[variant], {
        user: userToken,
        achievement: achievementToken,
        game: gameToken
    });

    const username = String(event.username || "").trim();
    const achievementTitle = String(event.achievementTitle || "").trim();
    const gameTitle = String(event.gameTitle || "").trim();

    const userSpan = (
        <span style={{ fontWeight: 700 }}>
            {username}
        </span>
    );
    const achievementSpan = (
        <span style={{ color: achievementGreen, fontWeight: 800 }}>
            {`“${achievementTitle}”`}
        </span>
    );
    const gameSpan = (
        <span style={{ color: skyBlue, fontWeight: 700 }}>
            {gameTitle}
        </span>
    );

    const pattern = /(__TICKER_(?:USER|ACHIEVEMENT|GAME)__)/g;
    return text.split(pattern).map(function pickPart(piece, index) {
        if (piece === userToken) {
            return <span key={`u:${index}`}>{userSpan}</span>;
        }
        if (piece === achievementToken) {
            return <span key={`a:${index}`}>{achievementSpan}</span>;
        }
        if (piece === gameToken) {
            return <span key={`g:${index}`}>{gameSpan}</span>;
        }
        return piece;
    });
}

function renderReminderTickerLine(
    language: LanguageCode,
    reminder: GameNoteReminderFiring
) {
    const title = String(reminder.title || "").trim();
    const rawBody = String(reminder.body || "").trim();
    const body = parseNoteTag(rawBody).body.trim();

    const prefixSpan = (
        <span style={{ color: warnAmber, fontWeight: 800 }}>
            {`${t(language, "Reminder:")} `}
        </span>
    );

    if (title && body) {
        return (
            <>
                {prefixSpan}
                <span style={{ fontWeight: 700 }}>{`${title} — `}</span>
                <span>{body}</span>
            </>
        );
    }

    return (
        <>
            {prefixSpan}
            <span>{body || title}</span>
        </>
    );
}

function reminderKey(reminder: GameNoteReminderFiring) {
    return `${reminder.noteId}|${reminder.firedAt}`;
}

function TickerCancelScope(props: {
    armed: boolean;
    onDismiss: () => void;
    children: ReactNode;
}) {
    if (!props.armed) {
        return <>{props.children}</>;
    }

    return (
        <Focusable onCancelButton={props.onDismiss}>
            {props.children}
        </Focusable>
    );
}

function MainAchievementsPage(props: MainAchievementsPageProps) {
    const {
        state: {
            view,
            language,
            buttonSpacing,
            metrics,
            friendsPayload,
            saving,
            loading,
            payload,
            trackedIds,
            notesByAchievementId,
            notesColorByAchievementId,
            error,
            focusScopeResetToken,
            achievementsResumeToken,
            showAllAchievements,
            showAllToggleMain,
            showTrackedNotesMain,
            showRetroPoints,
            showAButtonMode,
            controllerGlyphStyle,
            showSocialHubButton,
            showTrackedSetsButton,
            showOptionsButton,
            quickMenuShortcuts,
            achievementStyle,
            trackedColor,
            mainAchievementFilter,
            mainAchievementSort,
            mainAchievementAction,
            mainFilteredAchievementCount,
            socialGameTicker,
            socialHubTicker,
            showReminderTicker,
            ownUsername,
            showIcons,
            gameIconDataUri,
            gameIngameDataUri,
            gameIconCold,
            gameIngameCold,
            uiSize,
            topPadding,
            blockPadding,
            bigListThreshold,
            alwaysStaggerMounting,
            returnStaggerFrames,
            dynamicLoading,
            dynamicInitialRows,
            dynamicRowStep,
            dynamicPrefetchDistance,
            dynamicSentinelRootMargin,
            listResetToken,
            mainEntryToken,
            mainStripClaim,
            mainEntryFromView,
            showNotesDot,
            notesPendingReminderBadge,
            notificationsHasUnread,
            mainTab,
            nightMode,
            doNotDisturb,
            batterySaver,
            mouseKeyboardMode,
            nowPlayingBody
        },
        actions: {
            goToFriends,
            onOpenProfile,
            goToLeaderboards,
            goToOptions,
            goToAbout,
            goToUnlockHistory,
            goToGuides,
            goToTracked,
            goToTrackedSets,
            openUserAccounts,
            openUtils,
            goToSocialNews,
            goToSocialAotw,
            goToSocialNewSets,
            goToSocialSubscribed,
            goToSocialSavedComments,
            goToSocialActivity,
            openDolphinMapper,
            openCheevoCheck,
            openSmbShares,
            openFileWatcher,
            openRaSite,
            onApplyMainUiPreset,
            goToGameNotes,
            onViewGameOverview,
            onOpenNotifications,
            onManualRefresh,
            onShowAllChange,
            onMainAchievementFilterChange,
            onMainAchievementSortChange,
            onMainAchievementActionChange,
            onAchievementClick,
            onAchievementTrackToggle,
            onSocialActivityClick,
            onChangeMainTab,
            onToggleNightMode,
            onToggleDoNotDisturb,
            onToggleBatterySaver,
            onToggleMouseKeyboardMode,
            onOpenGameSearch,
            onSpendMainStripClaim
        }
    } = props;

    function handleGoToTracked() {
        void goToTracked();
    }

    function handleGoToGameNotes() {
        void goToGameNotes();
    }

    function handleManualRefresh() {
        void onManualRefresh();
    }

    function handleGoToUnlockHistory() {
        void goToUnlockHistory();
    }

    function handleGoToGuides() {
        void goToGuides();
    }

    function handleGoToLeaderboards() {
        void goToLeaderboards();
    }

    function handleAButtonClick() {
        void onMainAchievementActionChange(mainAchievementAction === "track" ? "info" : "track");
    }

    function handleFilterClick() {
        void onMainAchievementFilterChange(nextMainAchievementFilter(mainAchievementFilter));
    }

    function handleSortClick() {
        void onMainAchievementSortChange(nextAchievementSort(mainAchievementSort));
    }

    const BIG_LIST_MOUNT_DELAY_MS = 500;
    const initialAchievementCount = payload?.achievements?.length ?? 0;
    const effectiveShowAll = showAllToggleMain ? showAllAchievements : true;
    const shouldDeferList =
        alwaysStaggerMounting || (effectiveShowAll && initialAchievementCount > bigListThreshold);
    const [listMounted, setListMounted] = useState<boolean>(!shouldDeferList);
    const [, setResumeMountReadyToken] = useState(0);
    const lastResumeTokenRef = useRef(achievementsResumeToken);

    const [focusedQuickAction, setFocusedQuickAction] = useState<QuickActionId | null>(null);
    const [focusedMainTab, setFocusedMainTab] = useState<MainAchievementsTab | null>(null);
    const [hoveredQuickAction, setHoveredQuickAction] = useState<QuickActionId | null>(null);

    const quickGuide = useQuickGuide();
    const [focusedStripButton, setFocusedStripButton] =
        useState<StripButtonId | null>(null);
    const [hoveredStripButton, setHoveredStripButton] =
        useState<StripButtonId | null>(null);

    const [quickMenuExpanded, setQuickMenuExpanded] = useState(false);
    const tabBodyRef = useRef<HTMLDivElement | null>(null);
    const [heldBodyHeight, setHeldBodyHeight] = useState<number | null>(null);
    const releaseHeldBodyHeightRef = useRef<(() => void) | null>(null);
    const [drawerReturnToken, setDrawerReturnToken] = useState(0);

    const [tickerReturnToken, setTickerReturnToken] = useState(0);

    const entryFromComparePicker = mainEntryToken > 0 && mainEntryFromView === "comparePicker";
    const entryFromNavigation = mainEntryToken > 0 && !entryFromComparePicker;

    function collapseQuickMenuToHamburger() {
        playOkSound();
        setQuickMenuExpanded(false);
        setDrawerReturnToken((value) => value + 1);
    }

    const [tickerEvent, setTickerEvent] = useState<GameTickerEvent | null>(null);
    const [tickerVariant, setTickerVariant] = useState<TickerVariant>("just");
    const tickerClearedRef = useRef<string | null>(null);

    const [socialHubTickerEvent, setSocialHubTickerEvent] = useState<SocialHubTickerEvent | null>(null);
    const [socialHubTickerVariant, setSocialHubTickerVariant] = useState<TickerVariant>("just");
    const socialHubTickerClearedRef = useRef<string | null>(null);

    const [reminderEvent, setReminderEvent] = useState<GameNoteReminderFiring | null>(null);
    const reminderAckedRef = useRef<string | null>(null);

    const waitingForResumePaint =
        returnStaggerFrames > 0 && achievementsResumeToken !== lastResumeTokenRef.current;

    function handleQuickActionClick(id: QuickActionId) {
        if (id === "tracked") {
            handleGoToTracked();
            return;
        }

        if (id === "notes") {
            handleGoToGameNotes();
            return;
        }

        if (id === "guides") {
            handleGoToGuides();
            return;
        }

        if (id === "history") {
            handleGoToUnlockHistory();
            return;
        }

        if (id === "leaderboards") {
            handleGoToLeaderboards();
            return;
        }
    }

    function handleMainTabFocus(value: MainAchievementsTab) {
        setFocusedMainTab(value);
    }

    function handleMainTabBlur(value: MainAchievementsTab) {
        setFocusedMainTab((current) => {
            if (current !== value) {
                return current;
            }

            return null;
        });
    }

    function handleQuickActionFocus(id: QuickActionId) {
        setFocusedQuickAction(id);
    }

    function handleQuickActionBlur(id: QuickActionId) {
        setFocusedQuickAction((current) => {
            if (current !== id) {
                return current;
            }

            return null;
        });
    }

    function handleQuickActionHover(id: QuickActionId) {
        if (loading || saving) {
            return;
        }

        setHoveredQuickAction(id);
    }

    function handleQuickActionUnhover(id: QuickActionId) {
        setHoveredQuickAction((current) => {
            if (current !== id) {
                return current;
            }

            return null;
        });
    }

    const previewStripButton = hoveredStripButton ?? focusedStripButton;

    function hoverStripButton(id: StripButtonId) {
        if (saving || loading) {
            return;
        }

        setHoveredStripButton(id);
    }

    function unhoverStripButton(id: StripButtonId) {
        setHoveredStripButton((current) => current === id ? null : current);
    }

    function focusStripButton(id: StripButtonId) {
        setFocusedStripButton(id);
    }

    function blurStripButton(id: StripButtonId) {
        setFocusedStripButton((current) => current === id ? null : current);
    }

    const focusedTopRowEntry = QUICK_MENU_TOP_ROW.find((entry) => entry.id === previewStripButton) || null;
    const focusedBottomRowEntry = QUICK_MENU_BOTTOM_ROW.find((entry) => entry.id === previewStripButton) || null;
    const focusedShortcut = QUICK_MENU_SHORTCUTS.find((entry) => entry.id === previewStripButton) || null;
    const pinnedShortcuts = QUICK_MENU_SHORTCUTS.filter((entry) => quickMenuShortcuts.includes(entry.id));

    const gamepadCardActions = !mouseKeyboardMode;

    const pillLabelKey = previewStripButton === "dnd" ? "Do Not Disturb"
        : previewStripButton === "nightmode" ? "Night Mode"
            : previewStripButton === "batterysaver" ? "Battery Saver"
                : previewStripButton === "mkmode" ? "Mouse & Keyboard Mode"
                    : null;
    const topRowMenuLabel = pillLabelKey
        ? t(language, pillLabelKey)
        : (focusedTopRowEntry ? t(language, focusedTopRowEntry.labelKey) : "");
    const bottomRowMenuLabel = previewStripButton === "refresh"
        ? t(language, "Refresh")
        : focusedShortcut
            ? t(language, focusedShortcut.labelKey)
            : (focusedBottomRowEntry ? t(language, focusedBottomRowEntry.labelKey) : "");

    function renderQuickMenuCaption(label: string, marginTop: string) {
        return (
            <div
                style={{
                    ...smallTextStyle(),
                    fontWeight: 700,
                    minHeight: "17px",
                    marginTop,
                    marginBottom: "2px",
                    textAlign: "center",
                    whiteSpace: "nowrap",
                    opacity: label ? 0.95 : 0
                }}
            >
                {label}
            </div>
        );
    }

    function renderStatePill(
        id: Extract<StripButtonId, "dnd" | "nightmode" | "batterysaver" | "mkmode">,
        icon: ReactNode,
        on: boolean,
        onToggle: (nextValue: boolean) => void | Promise<void>
    ) {
        const previewed = previewStripButton === id;
        return (
            <div
                data-focus-key={`action:${id}`}
                onMouseEnter={() => hoverStripButton(id)}
                onMouseLeave={() => unhoverStripButton(id)}
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                }}
            >
                <DialogButton
                    onClick={() => { void onToggle(!on); }}
                    onGamepadFocus={() => focusStripButton(id)}
                    onGamepadBlur={() => blurStripButton(id)}
                    disabled={saving || loading}
                    style={{
                        minWidth: 0,
                        width: "58px",
                        height: "36px",
                        padding: "2px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "999px",
                        background: on ? skyBlue : undefined,
                        opacity: on || previewed ? 1 : 0.82,
                        boxShadow: previewed
                            ? "0 0 0 2px rgba(255,255,255,0.55), 0 2px 8px rgba(0,0,0,0.35)"
                            : undefined
                    }}
                >
                    {icon}
                </DialogButton>
            </div>
        );
    }

    function pressShortcut(id: QuickMenuShortcut) {
        if (id === "uiDefault") {
            void onApplyMainUiPreset("default");
            return;
        }
        if (id === "uiCompact") {
            void onApplyMainUiPreset("compact");
            return;
        }

        setQuickMenuExpanded(false);
        if (id === "dolphinMapper") {
            void openDolphinMapper();
            return;
        }
        if (id === "cheevoCheck") {
            void openCheevoCheck();
            return;
        }
        if (id === "smbShares") {
            void openSmbShares();
            return;
        }
        if (id === "fileWatcher") {
            void openFileWatcher();
            return;
        }
        if (id === "socialActivity") {
            void goToSocialActivity();
            return;
        }
        if (id === "visitRa") {
            void openRaSite();
        }
    }

    function renderShortcutPill(entry: { id: QuickMenuShortcut; labelKey: string }) {
        const Icon = QUICK_MENU_SHORTCUT_ICONS[entry.id];
        const previewed = previewStripButton === entry.id;
        return (
            <div
                key={entry.id}
                data-focus-key={`action:${entry.id}`}
                onMouseEnter={() => hoverStripButton(entry.id)}
                onMouseLeave={() => unhoverStripButton(entry.id)}
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                }}
            >
                <DialogButton
                    onClick={() => pressShortcut(entry.id)}
                    onGamepadFocus={() => focusStripButton(entry.id)}
                    onGamepadBlur={() => blurStripButton(entry.id)}
                    disabled={saving || loading}
                    style={{
                        minWidth: 0,
                        width: "58px",
                        height: "36px",
                        padding: "2px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "999px",
                        opacity: previewed ? 1 : 0.82,
                        boxShadow: previewed
                            ? "0 0 0 2px rgba(255,255,255,0.55), 0 2px 8px rgba(0,0,0,0.35)"
                            : undefined
                    }}
                >
                    <Icon size={18} />
                </DialogButton>
            </div>
        );
    }

    function renderQuickMenuTile(entry: QuickMenuEntry, rowTopMargin?: string) {
        const Icon = entry.Icon;
        const focused = previewStripButton === entry.id;
        return (
            <div
                key={entry.focusKey}
                data-focus-key={entry.focusKey}
                onMouseEnter={() => hoverStripButton(entry.id)}
                onMouseLeave={() => unhoverStripButton(entry.id)}
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginTop: rowTopMargin
                }}
            >
                <DialogButton
                    onClick={() => {
                        if (entry.id === "useraccounts") {
                            setQuickMenuExpanded(false);
                            void openUserAccounts();
                            return;
                        }
                        if (entry.id === "utilities") {
                            setQuickMenuExpanded(false);
                            void openUtils();
                            return;
                        }
                        if (entry.id === "trackedsets") {
                            setQuickMenuExpanded(false);
                            void goToTrackedSets();
                            return;
                        }
                        if (entry.id === "socialhub") {
                            setQuickMenuExpanded(false);
                            void goToFriends();
                            return;
                        }
                        if (entry.id === "options") {
                            setQuickMenuExpanded(false);
                            void goToOptions();
                            return;
                        }
                        if (entry.id === "about") {
                            setQuickMenuExpanded(false);
                            void goToAbout();
                            return;
                        }
                        if (entry.id === "news") {
                            setQuickMenuExpanded(false);
                            void goToSocialNews();
                            return;
                        }
                        if (entry.id === "aotw") {
                            setQuickMenuExpanded(false);
                            void goToSocialAotw();
                            return;
                        }
                        if (entry.id === "newsets") {
                            setQuickMenuExpanded(false);
                            void goToSocialNewSets();
                            return;
                        }
                        if (entry.id === "subscribeddiscussions") {
                            setQuickMenuExpanded(false);
                            void goToSocialSubscribed();
                            return;
                        }
                        if (entry.id === "savedcomments") {
                            setQuickMenuExpanded(false);
                            void goToSocialSavedComments();
                            return;
                        }
                    }}
                    onGamepadFocus={() => focusStripButton(entry.id)}
                    onGamepadBlur={() => blurStripButton(entry.id)}
                    disabled={saving || loading}
                    style={{
                        minWidth: 0,
                        width: "36px",
                        height: "36px",
                        padding: "2px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: focused ? 1 : 0.82,
                        boxShadow: focused
                            ? "0 0 0 2px rgba(255,255,255,0.55), 0 2px 8px rgba(0,0,0,0.35)"
                            : undefined
                    }}
                >
                    <Icon size={20} />
                </DialogButton>
            </div>
        );
    }

    function waitFrames(frameCount: number, callback: () => void): () => void {
        let cancelled = false;
        let frameId = 0;

        function step(framesLeft: number): void {
            if (cancelled) {
                return;
            }

            if (framesLeft <= 0) {
                callback();
                return;
            }

            frameId = requestAnimationFrame(function onFrame() {
                step(framesLeft - 1);
            });
        }

        step(frameCount);

        return function cancelWait(): void {
            cancelled = true;

            if (frameId !== 0) {
                cancelAnimationFrame(frameId);
            }
        };
    }

    function holdBodyHeightThroughTabChange(nextTab: MainAchievementsTab) {
        if (nextTab === mainTab) {
            return;
        }

        const height = tabBodyRef.current?.offsetHeight ?? 0;
        if (height <= 0) {
            return;
        }

        releaseHeldBodyHeightRef.current?.();
        setHeldBodyHeight(height);
        releaseHeldBodyHeightRef.current = waitFrames(6, () => {
            releaseHeldBodyHeightRef.current = null;
            setHeldBodyHeight(null);
        });
    }

    useEffect(() => {
        return () => {
            releaseHeldBodyHeightRef.current?.();
            releaseHeldBodyHeightRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (listMounted) {
            return;
        }
        const timeoutId = window.setTimeout(() => {
            setListMounted(true);
        }, BIG_LIST_MOUNT_DELAY_MS);
        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [listMounted]);

    useEffect(function allowListMountAfterResumePaint() {
        if (achievementsResumeToken === lastResumeTokenRef.current) {
            return;
        }

        if (returnStaggerFrames <= 0) {
            lastResumeTokenRef.current = achievementsResumeToken;
            return;
        }

        return waitFrames(returnStaggerFrames, function finishResumePaint() {
            lastResumeTokenRef.current = achievementsResumeToken;
            setResumeMountReadyToken(function bumpToken(current) {
                return current + 1;
            });
        });
    }, [achievementsResumeToken, returnStaggerFrames]);

    useEffect(() => {
        if (view === "achievements") {
            setFocusedQuickAction(null);
        }
    }, [view]);

    useEffect(() => {
        if (!socialGameTicker) {
            setTickerEvent(null);
            return;
        }
        if (view !== "achievements") {
            setTickerEvent(null);
            return;
        }
        if (!payload?.gameId) {
            return;
        }

        let cancelled = false;
        async function loadTickerEvent() {
            try {
                const result = await getGameTickerEvent();
                if (cancelled) {
                    return;
                }
                const event = result?.event ?? null;
                if (!event) {
                    setTickerEvent(null);
                    return;
                }

                if (event.gameId !== payload?.gameId) {
                    setTickerEvent(null);
                    return;
                }
                const ownKey = ownUsername.trim().toLowerCase();
                const eventKey = String(event.username || "").trim().toLowerCase();
                if (!eventKey || eventKey === ownKey) {
                    setTickerEvent(null);
                    return;
                }
                if (!isTickerEventFresh(event)) {
                    setTickerEvent(null);
                    return;
                }

                if (tickerClearedRef.current === tickerEventKey(event)) {
                    setTickerEvent(null);
                    return;
                }

                setTickerEvent(event);
                setTickerVariant(pickTickerVariant());
            }
            catch {
                if (!cancelled) {
                    setTickerEvent(null);
                }
            }
        }

        void loadTickerEvent();
        return () => {
            cancelled = true;
        };
    }, [socialGameTicker, view, payload?.gameId, ownUsername, achievementsResumeToken]);

    useEffect(() => {
        if (!tickerEvent) {
            return;
        }
        const eventKey = tickerEventKey(tickerEvent);
        if (tickerClearedRef.current === eventKey) {
            return;
        }
        tickerClearedRef.current = eventKey;
        void clearGameTickerEvent().catch(function ignoreClearFailure() {
        });
    }, [tickerEvent]);

    useEffect(() => {
        if (!socialHubTicker) {
            setSocialHubTickerEvent(null);
            return;
        }
        if (view !== "achievements") {
            setSocialHubTickerEvent(null);
            return;
        }

        let cancelled = false;
        async function loadSocialHubEvent() {
            try {
                const result = await getSocialHubTickerEvent();
                if (cancelled) {
                    return;
                }
                const event = result?.event ?? null;
                if (!event) {
                    setSocialHubTickerEvent(null);
                    return;
                }

                const currentGameId = payload?.gameId;
                if (currentGameId != null && event.gameId === currentGameId) {
                    setSocialHubTickerEvent(null);
                    return;
                }
                const ownKey = ownUsername.trim().toLowerCase();
                const eventKey = String(event.username || "").trim().toLowerCase();
                if (!eventKey || eventKey === ownKey) {
                    setSocialHubTickerEvent(null);
                    return;
                }
                if (!isTickerEventFresh(event)) {
                    setSocialHubTickerEvent(null);
                    return;
                }

                if (socialHubTickerClearedRef.current === socialHubTickerEventKey(event)) {
                    setSocialHubTickerEvent(null);
                    return;
                }

                setSocialHubTickerEvent(event);
                setSocialHubTickerVariant(pickTickerVariant());
            }
            catch {
                if (!cancelled) {
                    setSocialHubTickerEvent(null);
                }
            }
        }

        void loadSocialHubEvent();
        return () => {
            cancelled = true;
        };
    }, [socialHubTicker, view, payload?.gameId, ownUsername, achievementsResumeToken]);

    useEffect(() => {
        if (!socialHubTickerEvent) {
            return;
        }
        const eventKey = socialHubTickerEventKey(socialHubTickerEvent);
        if (socialHubTickerClearedRef.current === eventKey) {
            return;
        }
        socialHubTickerClearedRef.current = eventKey;
        void clearSocialHubTickerEvent().catch(function ignoreClearFailure() {
        });
    }, [socialHubTickerEvent]);

    useEffect(() => {
        if (view !== "achievements") {
            setReminderEvent(null);
            return;
        }
        if (!payload?.gameId) {
            setReminderEvent(null);
            return;
        }

        let cancelled = false;
        async function loadPendingReminder() {
            try {
                const result = await getPendingGameNoteReminders(payload!.gameId);
                if (cancelled) {
                    return;
                }
                const reminders = result?.reminders ?? [];
                if (reminders.length === 0) {
                    setReminderEvent(null);
                    return;
                }

                const head = reminders[0];

                if (reminderAckedRef.current === reminderKey(head)) {
                    setReminderEvent(null);
                    return;
                }

                setReminderEvent(head);
            }
            catch {
                if (!cancelled) {
                    setReminderEvent(null);
                }
            }
        }

        void loadPendingReminder();
        return () => {
            cancelled = true;
        };
    }, [view, payload?.gameId, achievementsResumeToken]);

    useEffect(() => {
        if (!reminderEvent) {
            return;
        }
        const key = reminderKey(reminderEvent);
        if (reminderAckedRef.current === key) {
            return;
        }
        reminderAckedRef.current = key;
        void ackGameNoteReminders(reminderEvent.gameId, [reminderEvent.noteId]).catch(
            function ignoreAckFailure() {
            }
        );
    }, [reminderEvent]);

    useEffect(() => {
        function onVisibilityChange() {
            if (document.visibilityState !== "hidden") {
                return;
            }
            setTickerEvent(null);
            setSocialHubTickerEvent(null);
            setReminderEvent(null);
        }

        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, []);

    if (view !== "achievements") {
        return null;
    }

    const buttonOuterStyle = regularButtonSpacingStyle(buttonSpacing);

    function syntheticTickerEvent(event: SocialHubTickerEvent): SocialActivityEvent {
        return {
            id: `ticker:${event.username}:${event.achievementId ?? "noach"}`,
            username: event.username,
            kind: "achievementUnlocked",
            gameId: event.gameId ?? null,
            gameTitle: event.gameTitle ?? null,
            achievementId: event.achievementId ?? null,
            achievementTitle: event.achievementTitle,
            achievementIcon: event.achievementIcon ?? null,
            achievementDescription: event.achievementDescription ?? null,
            points: event.points ?? null,
            trueRatio: event.trueRatio ?? null,
            hardcore: event.hardcore,
            timestamp: event.occurredAt ?? null,
            discoveredAt: event.discoveredAt ?? new Date().toISOString(),
            isFavorite: false
        };
    }

    function handleTickerClick() {
        if (reminderEvent && showReminderTicker) {
            void goToGameNotes();
            return;
        }
        if (!socialHubTickerEvent) {
            return;
        }
        void onSocialActivityClick(
            syntheticTickerEvent(socialHubTickerEvent),
            gamepadCardActions ? "achievement" : undefined
        );
    }

    function handleTickerButtonDown(evt: { detail?: { button?: number } }) {
        if (!gamepadCardActions || !socialHubTickerEvent || showReminderInTicker) {
            return;
        }
        const button = evt?.detail?.button;
        if (button === BUTTON_SECONDARY) {
            playOkSound();
            void onSocialActivityClick(syntheticTickerEvent(socialHubTickerEvent), "game");
            return;
        }
        if (button === BUTTON_OPTIONS) {
            playOkSound();
            void onSocialActivityClick(syntheticTickerEvent(socialHubTickerEvent), "profile");
        }
    }

    function dismissTicker() {
        playOkSound();
        if (showReminderInTicker) {
            setReminderEvent(null);
        }
        else {
            setSocialHubTickerEvent(null);
        }
        setTickerReturnToken((token) => token + 1);
    }

    const showReminderInTicker = reminderEvent !== null && showReminderTicker;

    const tickerVisible = showReminderInTicker || Boolean(socialHubTickerEvent);

    const profileButton = (
        <div
            data-focus-key="action:profilestrip"
            onMouseEnter={() => hoverStripButton("profile")}
            onMouseLeave={() => unhoverStripButton("profile")}
            style={{ position: "relative" }}
        >
            <DialogButton
                onClick={onOpenProfile}
                onGamepadFocus={() => focusStripButton("profile")}
                onGamepadBlur={() => blurStripButton("profile")}
                disabled={saving || loading}
                style={{
                    minWidth: 0,
                    width: "36px",
                    height: "36px",
                    padding: "2px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "50%",
                    scrollMarginTop: `${FIRST_FOCUSABLE_SCROLL_MARGIN_PX}px`,
                    opacity: previewStripButton === "profile" ? 1 : 0.82,
                    boxShadow: previewStripButton === "profile"
                        ? "0 0 0 2px rgba(255,255,255,0.55), 0 2px 8px rgba(0,0,0,0.35)"
                        : undefined
                }}
            >
                <UserAvatar
                    username={ownUsername}
                    size={28}
                    fontSize={13}
                />
            </DialogButton>
        </div>
    );

    const quickMenuButton = (
        <FocusClaim
            token={mainStripClaim?.token ?? 0}
            armed={Boolean(mainStripClaim?.armed)}
            onSpent={onSpendMainStripClaim}
        >
            <div
                data-focus-key="action:quickmenu"
                onMouseEnter={() => hoverStripButton("quickmenu")}
                onMouseLeave={() => unhoverStripButton("quickmenu")}
                style={{ position: "relative" }}
            >
                <DialogButton
                    onClick={() => {
                        setQuickMenuExpanded((value) => !value);
                    }}
                    onGamepadFocus={() => focusStripButton("quickmenu")}
                    onGamepadBlur={() => blurStripButton("quickmenu")}
                    preferredFocus={true}
                    disabled={saving || loading}
                    style={{
                        minWidth: 0,
                        width: "36px",
                        height: "36px",
                        padding: "2px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        scrollMarginTop: `${FIRST_FOCUSABLE_SCROLL_MARGIN_PX}px`,
                        opacity: previewStripButton === "quickmenu" ? 1 : 0.82,
                        boxShadow: previewStripButton === "quickmenu"
                            ? "0 0 0 2px rgba(255,255,255,0.55), 0 2px 8px rgba(0,0,0,0.35)"
                            : undefined
                    }}
                >
                    <QuickMenuIcon size={18} />
                </DialogButton>
            </div>
        </FocusClaim>
    );

    const notificationsButton = (
        <div
            data-focus-key="action:notifications"
            onMouseEnter={() => hoverStripButton("notifications")}
            onMouseLeave={() => unhoverStripButton("notifications")}
            style={{ position: "relative" }}
        >
            <DialogButton
                onClick={() => {
                    onOpenNotifications();
                }}
                onGamepadFocus={() => focusStripButton("notifications")}
                onGamepadBlur={() => blurStripButton("notifications")}
                disabled={saving || loading}
                style={{
                    minWidth: 0,
                    width: "36px",
                    height: "36px",
                    padding: "2px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    scrollMarginTop: `${FIRST_FOCUSABLE_SCROLL_MARGIN_PX}px`,
                    opacity: previewStripButton === "notifications" ? 1 : 0.82,
                    boxShadow: previewStripButton === "notifications"
                        ? "0 0 0 2px rgba(255,255,255,0.55), 0 2px 8px rgba(0,0,0,0.35)"
                        : undefined
                }}
            >
                {doNotDisturb ? <BellSlashIcon size={18} /> : <BellIcon size={18} />}
            </DialogButton>
            {notificationsHasUnread && (
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
    );

    const iconRow = (
        <Focusable
            key={`iconrow:${drawerReturnToken}:${tickerReturnToken}:${mainEntryToken}`}
            flow-children="row"
            navEntryPreferPosition={NAV_ENTER_PREFERRED_CHILD}
            resetNavOnEntry={true}
            autoFocus={drawerReturnToken > 0 || tickerReturnToken > 0 || entryFromNavigation || undefined}
            style={{ display: "flex", gap: "6px" }}
        >
            {profileButton}
            {quickMenuButton}
            {notificationsButton}
        </Focusable>
    );

    const headerIconRow = quickGuide.visible ? (
        <QuickGuideColumn>
            <div
                data-focus-key="action:quickguide"
                onMouseEnter={() => hoverStripButton("quickguide")}
                onMouseLeave={() => unhoverStripButton("quickguide")}
                style={{ display: "flex", justifyContent: "flex-end" }}
            >
                <div style={{ display: "flex", width: "78px" }}>
                    <QuickGuidePin
                        onPress={quickGuide.onPress}
                        onGamepadFocus={() => focusStripButton("quickguide")}
                        onGamepadBlur={() => blurStripButton("quickguide")}
                        disabled={saving || loading}
                        previewed={previewStripButton === "quickguide"}
                    />
                </div>
            </div>
            {iconRow}
        </QuickGuideColumn>
    ) : iconRow;

    const restoreCurtainClaim = nowPlayingBody.commentsCardClaim ?? nowPlayingBody.commentsPostClaim;
    const restoreCurtainArmed = nowPlayingBody.restorePending && mainTab === "comments";
    const restoreCurtainSettled = !nowPlayingBody.holdCommentsBody
        && (restoreCurtainClaim?.token ?? 0) > 0
        && !restoreCurtainClaim?.armed;

    return (
        <RestoreCurtain armed={restoreCurtainArmed} settled={restoreCurtainSettled}>
            <PanelSection>
                <div
                    style={{
                        display: "flex",
                        alignItems: "flex-end",
                        justifyContent: "space-between",
                        width: "100%",
                        ...buttonOuterStyle
                    }}
                >
                    <div
                        style={{
                            textTransform: "uppercase",
                            fontWeight: 700,
                            color: "#ffffff",
                            letterSpacing: "0.5px",
                            display: "flex",
                            alignItems: "center",
                            height: "36px"
                        }}
                    >
                        {t(language, "Main Menu")}
                    </div>
                    <div style={{ display: "flex" }}>
                        {headerIconRow}
                    </div>
                </div>
                {quickMenuExpanded && (
                    <div
                        style={{
                            ...buttonOuterStyle,
                            marginTop: "6px"
                        }}
                    >
                        <style>{QUICK_ACTION_REFRESH_SPIN}</style>
                        <style>{QUICK_MENU_SEARCH_STYLES}</style>
                        <Focusable
                            flow-children="column"
                            autoFocus
                            onCancelButton={mouseKeyboardMode ? undefined : collapseQuickMenuToHamburger}
                            onCancelActionDescription={mouseKeyboardMode ? undefined : t(language, "Close Menu")}
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "stretch",
                                gap: "2px",
                                width: "100%"
                            }}
                        >
                            <PanelSectionRow>
                                <FocusableItem
                                    focusKey="quickmenu:search"
                                    bottomSeparator="none"
                                    onClick={() => {
                                        setQuickMenuExpanded(false);
                                        onOpenGameSearch();
                                    }}
                                    outerStyle={{ width: "100%", minWidth: 0 }}
                                >
                                    <div
                                        className="da-quickmenu-search"
                                        style={{
                                            width: "100%",
                                            boxSizing: "border-box",
                                            display: "flex",
                                            flexDirection: "row",
                                            alignItems: "center",
                                            gap: "8px",
                                            padding: "7px 10px",
                                            borderRadius: "8px",
                                            minWidth: 0
                                        }}
                                    >
                                        <SearchIcon size={16} />
                                        <span
                                            style={{
                                                ...smallTextStyle(),
                                                flex: 1,
                                                minWidth: 0,
                                                textAlign: "left",
                                                opacity: 0.75,
                                                whiteSpace: "nowrap",
                                                overflow: "hidden",
                                                textOverflow: "ellipsis"
                                            }}
                                        >
                                            {t(language, "Search Game")}
                                        </span>
                                    </div>
                                </FocusableItem>
                            </PanelSectionRow>
                            <Focusable
                                flow-children="row"
                                navEntryPreferPosition={NAV_ENTER_MAINTAIN_X}
                                style={{
                                    display: "flex",
                                    flexDirection: "row",
                                    justifyContent: "center",
                                    gap: "8px",
                                    marginTop: "2px"
                                }}
                            >
                                {renderStatePill("dnd", <BellSlashIcon size={18} />, doNotDisturb, onToggleDoNotDisturb)}
                                {renderStatePill("nightmode", <MoonIcon size={18} />, nightMode, onToggleNightMode)}
                                {renderStatePill("batterysaver", <BatteryHalfIcon size={18} />, batterySaver, onToggleBatterySaver)}
                                {renderStatePill("mkmode", <KeyboardIcon size={18} />, mouseKeyboardMode, onToggleMouseKeyboardMode)}
                            </Focusable>
                            {batterySaver && (
                                <InfoText centered>
                                    {t(language, "Features disabled to save power")}
                                </InfoText>
                            )}
                            {
}
                            {renderQuickMenuCaption(topRowMenuLabel, "3px")}
                            <Focusable
                                flow-children="grid"
                                navEntryPreferPosition={NAV_ENTER_MAINTAIN_X}
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "repeat(6, 36px)",
                                    justifyContent: "center",
                                    columnGap: "8px",
                                    rowGap: "0",
                                    marginTop: "2px"
                                }}
                            >
                                {QUICK_MENU_TOP_ROW.map((entry) => renderQuickMenuTile(entry))}
                                {QUICK_MENU_BOTTOM_ROW.map((entry) => renderQuickMenuTile(entry, QUICK_MENU_ROW_GAP))}
                                {
}
                                <div
                                    data-focus-key="action:refresh"
                                    onMouseEnter={() => hoverStripButton("refresh")}
                                    onMouseLeave={() => unhoverStripButton("refresh")}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        marginTop: QUICK_MENU_ROW_GAP
                                    }}
                                >
                                    <DialogButton
                                        onClick={() => handleManualRefresh()}
                                        onGamepadFocus={() => focusStripButton("refresh")}
                                        onGamepadBlur={() => blurStripButton("refresh")}
                                        disabled={saving || loading}
                                        style={{
                                            minWidth: 0,
                                            width: "36px",
                                            height: "36px",
                                            padding: "2px",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            opacity: previewStripButton === "refresh" ? 1 : 0.82,
                                            boxShadow: previewStripButton === "refresh"
                                                ? "0 0 0 2px rgba(255,255,255,0.55), 0 2px 8px rgba(0,0,0,0.35)"
                                                : undefined
                                        }}
                                    >
                                        <span
                                            style={{
                                                display: "inline-flex",
                                                animation: loading
                                                    ? "da-quick-refresh-spin 0.9s linear infinite"
                                                    : undefined
                                            }}
                                        >
                                            <FaSyncAlt size={20} />
                                        </span>
                                    </DialogButton>
                                </div>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    {renderQuickMenuCaption(bottomRowMenuLabel, "4px")}
                                    {pinnedShortcuts.length > 0 && (
                                        <div
                                            style={{
                                                display: "flex",
                                                flexDirection: "row",
                                                justifyContent: "center",
                                                gap: "8px",
                                                marginTop: "2px",
                                                marginBottom: "4px"
                                            }}
                                        >
                                            {pinnedShortcuts.map(renderShortcutPill)}
                                        </div>
                                    )}
                                </div>
                            </Focusable>
                        </Focusable>
                    </div>
                )}
                {tickerVisible && (
                    <>
                        <PanelSectionRow>
                            <TickerCancelScope
                                armed={gamepadCardActions}
                                onDismiss={dismissTicker}
                            >
                                <FocusableItem
                                    focusKey="ticker:top"
                                    onButtonDown={gamepadCardActions ? handleTickerButtonDown : undefined}
                                    bottomSeparator="none"
                                    outerStyle={{
                                        ...regularButtonSpacingStyle(buttonSpacing),
                                        borderLeft: showReminderInTicker
                                            ? `3px solid ${warnAmber}`
                                            : `3px solid ${achievementGreen}`
                                    }}
                                    onClick={handleTickerClick}
                                >
                                    <div
                                        style={{
                                            ...bodyTextStyle(),
                                            textAlign: "left",
                                            paddingLeft: "8px"
                                        }}
                                    >
                                        {showReminderInTicker
                                            ? renderReminderTickerLine(language, reminderEvent!)
                                            : renderSocialHubTickerLine(
                                                language,
                                                socialHubTickerEvent!,
                                                socialHubTickerVariant
                                            )}
                                    </div>
                                </FocusableItem>
                            </TickerCancelScope>
                        </PanelSectionRow>
                        {gamepadCardActions && (
                            <PanelSectionRow>
                                <ButtonHints
                                    dense
                                    style={controllerGlyphStyle}
                                    hints={showReminderInTicker
                                        ? [
                                            { button: "a", label: t(language, "Notes") },
                                            { button: "b", label: <TickerCloseIcon /> }
                                        ]
                                        : [
                                            { button: "a", label: t(language, "legend_cheevo") },
                                            { button: "x", label: t(language, "Game") },
                                            { button: "y", label: t(language, "Profile") },
                                            { button: "b", label: <TickerCloseIcon /> }
                                        ]}
                                />
                            </PanelSectionRow>
                        )}
                    </>
                )}
                {showSocialHubButton && (
                    <LabeledRow
                        outerStyle={buttonOuterStyle}
                        focusKey="action:friends"
                        onClick={goToFriends}
                        disabled={saving || loading}
                        label={t(language, "Social Hub")}
                        value={
                            friendsPayload?.count
                                ? t(language, "{{count}} followed", { count: friendsPayload.count })
                                : t(language, "Open")
                        }
                        gap={metrics.iconGap}
                        bottomSeparator="none"
                    />
                )}
                {showTrackedSetsButton && (
                    <LabeledRow
                        outerStyle={buttonOuterStyle}
                        focusKey="action:trackedsetsmain"
                        onClick={goToTrackedSets}
                        disabled={saving || loading}
                        label={t(language, "Mastery Goals")}
                        value={t(language, "Open")}
                        gap={metrics.iconGap}
                        bottomSeparator="none"
                    />
                )}
                {}
                {showOptionsButton && (
                    <LabeledRow
                        outerStyle={buttonOuterStyle}
                        focusKey="action:options"
                        onClick={goToOptions}
                        disabled={loading || saving}
                        label={t(language, "Options")}
                        value={t(language, "Open")}
                        gap={metrics.iconGap}
                        bottomSeparator="none"
                    />
                )}
                {error && (
                    <PanelSectionRow>
                        <ErrorText>
                            {localizeRuntimeText(language, error)}
                        </ErrorText>
                    </PanelSectionRow>
                )}
            </PanelSection>

            {payload && (
                <PanelSection
                    key={`achievements:game:${payload.gameId ?? "none"}:${focusScopeResetToken}`}
                    title={t(language, "Currently Playing")}
                >
                    <PanelSectionRow>
                        <div
                            style={{
                                width: "100%",
                                display: "flex",
                                flexDirection: "column",
                                gap: "6px",
                                alignItems: "flex-start"
                            }}
                        >
                            {(gameIconDataUri || gameIngameDataUri) && (
                                <div
                                    style={{
                                        display: "flex",
                                        flexDirection: "row",
                                        alignItems: "center",
                                        gap: "8px",
                                        minWidth: 0
                                    }}
                                >
                                    {gameIconDataUri && (
                                        <FadeImage
                                            src={gameIconDataUri}
                                            fadeOnLoad={gameIconCold}
                                            style={{
                                                width: "64px",
                                                height: "64px",
                                                borderRadius: "8px",
                                                objectFit: "cover",
                                                display: "block",
                                                flexShrink: 0
                                            }}
                                        />
                                    )}
                                    {gameIconDataUri && gameIngameDataUri && (
                                        <div
                                            style={{
                                                width: "1px",
                                                alignSelf: "stretch",
                                                background: "rgba(255,255,255,0.18)",
                                                flexShrink: 0
                                            }}
                                        />
                                    )}
                                    {gameIngameDataUri && (
                                        <FadeImage
                                            src={gameIngameDataUri}
                                            fadeOnLoad={gameIngameCold}
                                            style={{
                                                height: "64px",
                                                width: "auto",
                                                borderRadius: "8px",
                                                objectFit: "contain",
                                                display: "block",
                                                flexShrink: 0
                                            }}
                                        />
                                    )}
                                    {
}
                                    {payload?.gameId != null && (
                                        <div
                                            data-focus-key="main:currentgame:overview"
                                            style={{
                                                alignSelf: "stretch",
                                                display: "flex",
                                                flexShrink: 0
                                            }}
                                        >
                                            <DialogButton
                                                onClick={() => { void onViewGameOverview(); }}
                                                style={{
                                                    minWidth: 0,
                                                    width: "16px",
                                                    height: "100%",
                                                    padding: "0",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center"
                                                }}
                                            >
                                                <ChevronRightIcon />
                                            </DialogButton>
                                        </div>
                                    )}
                                </div>
                            )}
                            <div
                                style={{
                                    fontSize: `${headerSize(18)}px`,
                                    pointerEvents: "all",
                                    fontWeight: 700,
                                    lineHeight: 1.2,
                                    textAlign: "left",
                                    wordBreak: "break-word"
                                }}
                            >
                                {payload.title ?? t(language, "No game found")}
                            </div>
                            <AwardStatusBadge
                                language={language}
                                kind={payload.highestAwardKind}
                                style={{ marginTop: "4px" }}
                            />
                            <div style={{ ...bodyTextStyle(), textAlign: "left" }}>
                                {payload.consoleName ? consoleInlineName(payload.consoleName) : ""}
                                {payload.consoleName && payload.userCompletion ? " • " : ""}
                                {payload.userCompletion
                                    ? t(language, "Completion: {{value}}", { value: payload.userCompletion })
                                    : ""}
                            </div>
                            <div style={{ ...bodyTextStyle(), textAlign: "left" }}>
                                {payloadAchievementSummaryLabel(payload, language)}
                            </div>
                            {tickerEvent && (
                                <div
                                    style={{
                                        ...bodyTextStyle(),
                                        textAlign: "left",
                                        marginTop: "6px",
                                        borderLeft: `3px solid ${achievementGreen}`,
                                        paddingLeft: "8px"
                                    }}
                                >
                                    {renderGameTickerLine(language, tickerEvent, tickerVariant)}
                                </div>
                            )}
                            {
}
                            {payload?.gameId && (
                                <div
                                    style={{
                                        width: "100%",
                                        marginTop: "4px",
                                        marginBottom: "0px"
                                    }}
                                >
                                    <style>{QUICK_ACTION_REFRESH_SPIN}</style>
                                    <Focusable
                                        flow-children="row"
                                        navEntryPreferPosition={focusedMainTab ? NAV_ENTER_PREFERRED_CHILD : undefined}
                                        style={{
                                            display: "flex",
                                            gap: "8px",
                                            width: "100%",
                                            justifyContent: "flex-start"
                                        }}
                                    >
                                        {QUICK_ACTIONS.map((action) => {
                                            const previewed = (hoveredQuickAction ?? focusedQuickAction) === action.id;
                                            const isTracked = action.id === "tracked";
                                            const buttonDisabled = loading || saving;
                                            const trackedCountLabel = isTracked
                                                ? t(language, "Tracked ({{count}})", { count: trackedIds.length })
                                                : null;
                                            const labelText = trackedCountLabel ?? t(language, action.labelKey);
                                            const Icon = action.Icon;

                                            return (
                                                <div
                                                    key={action.focusKey}
                                                    data-focus-key={action.focusKey}
                                                    onMouseEnter={() => handleQuickActionHover(action.id)}
                                                    onMouseLeave={() => handleQuickActionUnhover(action.id)}
                                                    style={{
                                                        position: "relative",
                                                        display: "flex",
                                                        flexDirection: "column",
                                                        alignItems: "center",
                                                        flex: 1,
                                                        minWidth: 0
                                                    }}
                                                >
                                                    <DialogButton
                                                        onClick={() => handleQuickActionClick(action.id)}
                                                        preferredFocus={(focusedMainTab && QUICK_ACTION_ABOVE_TAB[focusedMainTab] === action.id) || undefined}
                                                        onGamepadFocus={() => handleQuickActionFocus(action.id)}
                                                        onGamepadBlur={() => handleQuickActionBlur(action.id)}
                                                        disabled={buttonDisabled}
                                                        style={{
                                                            minWidth: 0,
                                                            width: "100%",
                                                            height: "38px",
                                                            padding: "4px 2px",
                                                            display: "flex",
                                                            alignItems: "center",
                                                            justifyContent: "center",
                                                            opacity: previewed ? 1 : 0.72,
                                                            boxShadow: previewed
                                                                ? "0 0 0 2px rgba(255,255,255,0.55), 0 2px 8px rgba(0,0,0,0.35)"
                                                                : undefined
                                                        }}
                                                    >
                                                        <span style={{ display: "inline-flex" }}>
                                                            <Icon size={18} />
                                                        </span>
                                                    </DialogButton>
                                                    {action.id === "notes" && notesPendingReminderBadge && showNotesDot && (
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
                                                    <div
                                                        style={{
                                                            ...smallTextStyle(),
                                                            fontWeight: 700,
                                                            textAlign: "center",
                                                            whiteSpace: "nowrap",
                                                            overflow: "visible",
                                                            marginTop: "1px",
                                                            minHeight: "1em",
                                                            opacity: previewed ? 0.95 : 0
                                                        }}
                                                    >
                                                        {labelText}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </Focusable>
                                </div>
                            )}
                        </div>
                    </PanelSectionRow>
                    {payload?.gameId && (
                        <Focusable
                            flow-children="row"
                            navEntryPreferPosition={focusedQuickAction ? NAV_ENTER_PREFERRED_CHILD : undefined}
                            style={{
                                display: "flex",
                                width: "100%",
                                marginTop: "10px",
                                gap: "1px"
                            }}
                        >
                            {MAIN_TABS.map((tab) => {
                                const selected = mainTab === tab.value;
                                return (
                                    <div
                                        key={tab.value}
                                        data-focus-key={tab.focusKey}
                                        style={{
                                            display: "flex",
                                            flex: 1,
                                            borderBottom: selected
                                                ? "2px solid #1a9fff"
                                                : "2px solid rgba(255, 255, 255, 0.14)"
                                        }}
                                    >
                                        <DialogButton
                                            onClick={() => {
                                                holdBodyHeightThroughTabChange(tab.value);
                                                onChangeMainTab(tab.value);
                                            }}
                                            preferredFocus={(focusedQuickAction && TAB_UNDER_QUICK_ACTION[focusedQuickAction] === tab.value) || undefined}
                                            onGamepadFocus={() => handleMainTabFocus(tab.value)}
                                            onGamepadBlur={() => handleMainTabBlur(tab.value)}
                                            style={{
                                                minWidth: 0,
                                                width: "100%",
                                                padding: "6px 10px",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                borderRadius: 0,
                                                opacity: selected ? 1 : 0.6
                                            }}
                                        >
                                            {subTabIcon(tab.icon)}
                                        </DialogButton>
                                    </div>
                                );
                            })}
                        </Focusable>
                    )}
                </PanelSection>
            )}

            {
}
            <div
                ref={tabBodyRef}
                style={{ minHeight: heldBodyHeight === null ? undefined : `${heldBodyHeight}px` }}
            >
                {payload && mainTab === "achievements" && (
                    <>
                        <PanelSection title={t(language, "View Options")}>
                            {mouseKeyboardMode && showAButtonMode && (
                                <LabeledRow
                                    outerStyle={buttonOuterStyle}
                                    focusKey="achievements:action-mode"
                                    onClick={handleAButtonClick}
                                    disabled={loading || saving}
                                    label={t(language, "Click")}
                                    value={
                                        mainAchievementAction === "info"
                                            ? t(language, "View Info")
                                            : t(language, "Track / Untrack")
                                    }
                                    gap={metrics.iconGap}
                                    bottomSeparator="none"
                                />
                            )}
                            {
}
                            <LabeledRow
                                outerStyle={buttonOuterStyle}
                                focusKey="achievements:sort"
                                onClick={handleSortClick}
                                disabled={loading || saving}
                                label={t(language, "Sort")}
                                value={achievementSortLabel(mainAchievementSort, language)}
                                bottomSeparator="none"
                            />
                            <LabeledRow
                                outerStyle={buttonOuterStyle}
                                focusKey="achievements:filter"
                                onClick={handleFilterClick}
                                disabled={loading || saving}
                                label={t(language, "Filter")}
                                value={mainAchievementFilterLabel(mainAchievementFilter, language)}
                                bottomSeparator="none"
                            />
                            {showAllToggleMain && (
                                <PanelSectionRow>
                                    <ToggleRow
                                        label={t(language, "Show All")}
                                        value={showAllAchievements}
                                        onChange={onShowAllChange}
                                        disabled={loading || saving}
                                        outerStyle={buttonOuterStyle}
                                        bottomSeparator="none"
                                    />
                                </PanelSectionRow>
                            )}
                            {showAllToggleMain && !showAllAchievements && mainFilteredAchievementCount > 50 && (
                                <PanelSectionRow>
                                    <div style={bodyTextStyle()}>
                                        {t(language, "Showing first 50 of {{count}} achievements.", {
                                            count: mainFilteredAchievementCount
                                        })}
                                    </div>
                                </PanelSectionRow>
                            )}
                        </PanelSection>
                        {listMounted && !waitingForResumePaint && (
                            <AchievementList
                                key={`achievements:${payload.gameId ?? "none"}:${listResetToken}:${focusScopeResetToken}`}
                                payload={payload}
                                language={language}
                                showIcons={showIcons}
                                achievementStyle={achievementStyle}
                                trackedColor={trackedColor}
                                uiSize={uiSize}
                                topPadding={topPadding}
                                blockPadding={blockPadding}
                                showAll={showAllToggleMain ? showAllAchievements : true}
                                mode="main"
                                trackedIds={trackedIds}
                                notesByAchievementId={notesByAchievementId}
                                notesColorByAchievementId={notesColorByAchievementId}
                                showTrackedNotesMain={showTrackedNotesMain}
                                showRetroPoints={showRetroPoints}
                                mainFilter={mainAchievementFilter}
                                mainSort={mainAchievementSort}
                                resetToken={listResetToken}
                                dynamicLoading={dynamicLoading}
                                dynamicInitialRows={dynamicInitialRows}
                                dynamicRowStep={dynamicRowStep}
                                dynamicPrefetchDistance={dynamicPrefetchDistance}
                                dynamicSentinelRootMargin={dynamicSentinelRootMargin}
                                onAchievementClick={onAchievementClick}
                                onAchievementTrackToggle={mouseKeyboardMode ? undefined : onAchievementTrackToggle}
                                preRows={!mouseKeyboardMode && (
                                    <PanelSectionRow>
                                        <ButtonHints
                                            style={controllerGlyphStyle}
                                            hints={[
                                                { button: "a", label: t(language, "View Info") },
                                                { button: "x", label: t(language, "Track / Untrack") }
                                            ]}
                                        />
                                    </PanelSectionRow>
                                )}
                            />
                        )}
                    </>
                )}

                {
}
                {payload?.gameId && mainTab !== "achievements" && (
                    <NowPlayingTabBody
                        {...nowPlayingBody}
                        subView={mainTab as NowPlayingSubView}
                        comparePickerEntryToken={entryFromComparePicker ? mainEntryToken : 0}
                    />
                )}
            </div>
        </RestoreCurtain>
    );
}

export default MainAchievementsPage;
