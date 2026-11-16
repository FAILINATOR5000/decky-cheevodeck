import type { ReactNode } from "react";

import { t, type LanguageCode } from "../../locales";
import type { DolphinMapping } from "../../types";
import { parseNoteTag } from "../../utils/achievements";
import { mappingSummary } from "../../utils/dolphin";
import { modalSize, textSize } from "../../utils/scale";
import { bodyTextStyle, modalBodyStyle } from "../../utils/style";

const MAX_CONTROLLER_SLOTS = 4;

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function GamepadIcon() {
    return (
        <svg
            viewBox="0 0 640 512"
            width="20"
            height="16"
            xmlns="http://www.w3.org/2000/svg"
            focusable="false"
        >
            <path
                fill="currentColor"
                d="M192 64C86 64 0 150 0 256S86 448 192 448l256 0c106 0 192-86 192-192s-86-192-192-192L192 64zM496 168a40 40 0 1 1 0 80 40 40 0 1 1 0-80zM392 304a40 40 0 1 1 80 0 40 40 0 1 1 -80 0zM168 200c0-13.3 10.7-24 24-24s24 10.7 24 24l0 32 32 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-32 0 0 32c0 13.3-10.7 24-24 24s-24-10.7-24-24l0-32-32 0c-13.3 0-24-10.7-24-24s10.7-24 24-24l32 0 0-32z"
            />
        </svg>
    );
}

export function MappingCardBody(props: { mapping: DolphinMapping; language: LanguageCode; modal?: boolean; children?: ReactNode }) {
    const { mapping, language, modal } = props;
    const parsed = parseNoteTag(mapping.name);
    const title = parsed.body.trim() || t(language, "Untitled mapping");
    const text = modal ? modalBodyStyle() : bodyTextStyle();

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, ...(modal ? { width: "100%", textAlign: "left" } : {}) }}>
            <div style={{ fontWeight: 600, wordBreak: "break-word", fontSize: `${modal ? modalSize(15) : textSize(15)}px` }}>{title}</div>
            <div style={{ ...text, opacity: 0.75 }}>{mappingSummary(mapping, language)}</div>
            {mapping.body.trim() && (
                <div style={{ ...text, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {mapping.body.trim()}
                </div>
            )}
            {props.children}
            <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", gap: "4px", marginTop: "4px" }}>
                {Array.from({ length: MAX_CONTROLLER_SLOTS }, (_, slot) => (
                    <span
                        key={slot}
                        style={{ display: "inline-flex", opacity: slot < mapping.players.length ? 1 : 0.25 }}
                    >
                        <GamepadIcon />
                    </span>
                ))}
            </div>
        </div>
    );
}
