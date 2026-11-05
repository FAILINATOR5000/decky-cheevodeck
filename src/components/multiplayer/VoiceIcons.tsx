// Font Awesome Free icons, CC BY 4.0. See ATTRIBUTIONS.md.
import { FaMicrophone, FaMicrophoneSlash, FaVolumeMute } from "react-icons/fa";

import { achievementGreen, warnAmber } from "../../utils/style";
import type { VoiceMine } from "../../utils/voiceChat";

const ICON = { width: "1em", height: "1em", display: "block" } as const;

export function OwnMicIcon(props: { mine: VoiceMine; available: boolean }) {
    if (!props.available) {
        return <FaMicrophoneSlash style={{ ...ICON, opacity: 0.45 }} />;
    }
    if (props.mine === "on") {
        return <FaMicrophone style={{ ...ICON, color: achievementGreen }} />;
    }
    return <FaMicrophoneSlash style={{ ...ICON, color: props.mine === "steam" ? warnAmber : undefined }} />;
}

export function MutedPlayerIcon() {
    return <FaVolumeMute style={ICON} />;
}

export function RoomVoiceIcon() {
    return <FaMicrophone style={{ ...ICON, display: "inline-block", verticalAlign: "-0.1em" }} />;
}
