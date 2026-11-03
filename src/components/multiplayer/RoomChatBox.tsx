import { useLayoutEffect, useRef } from "react";

import { t, type LanguageCode } from "../../locales";
import type { MultiplayerChatLine } from "../../types";
import { achievementGreen, bodyTextStyle } from "../../utils/style";

const CHAT_LINES = 6;
const PAD_PX = 4;

export function RoomChatBox(props: { language: LanguageCode; chat: MultiplayerChatLine[] }) {
    const { language, chat } = props;
    const box = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const element = box.current;
        if (!element) {
            return;
        }
        const top = element.getBoundingClientRect().top + PAD_PX;
        for (const line of Array.from(element.children) as HTMLElement[]) {
            line.style.visibility = "";
            if (line.getBoundingClientRect().top < top - 0.5) {
                line.style.visibility = "hidden";
            }
        }
    });

    return (
        <div
            ref={box}
            style={{
                ...bodyTextStyle(),
                opacity: 1,
                width: "100%",
                height: `${CHAT_LINES * 1.4}em`,
                lineHeight: 1.4,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                padding: `${PAD_PX}px 0`
            }}
        >
            {chat.length === 0 ? (
                <div style={{ fontStyle: "italic", opacity: 0.7 }}>{t(language, "No messages yet")}</div>
            ) : chat.slice(-CHAT_LINES).map((line) => (
                <div key={line.seq} style={{ flexShrink: 0, overflowWrap: "anywhere" }}>
                    <span style={{ fontWeight: 800, color: achievementGreen }}>{line.name}</span>
                    {": "}
                    {line.text}
                </div>
            ))}
        </div>
    );
}
