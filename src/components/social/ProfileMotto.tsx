import { Focusable } from "@decky/ui";
import { useState } from "react";
import { findLinks } from "../../utils/links";
import { openExternalUrl } from "../../utils/navigation";
import { bodyTextStyle } from "../../utils/style";

export function ProfileMotto(props: { text: string }) {
    const { text } = props;
    const [focused, setFocused] = useState(false);

    const target = findLinks(text)[0]?.url ?? null;

    function activate() {
        if (!target) {
            return;
        }
        void openExternalUrl(target);
    }

    return (
        <div style={{ width: "100%", marginTop: "10px" }}>
            <div
                style={{
                    borderTop: "1px solid rgba(255, 255, 255, 0.12)",
                    marginBottom: "10px"
                }}
            />
            <div
                onFocusCapture={() => setFocused(true)}
                onBlurCapture={() => setFocused(false)}
                style={{ width: "100%" }}
            >
                <Focusable
                    onActivate={activate}
                    noFocusRing={true}
                    style={{
                        display: "block",
                        width: "100%",
                        boxSizing: "border-box",
                        padding: "6px 8px",
                        borderRadius: "4px",
                        cursor: target ? "pointer" : undefined,
                        backgroundColor: focused ? "rgba(78, 161, 255, 0.10)" : "transparent",
                        outline: focused ? "2px solid rgba(78, 161, 255, 0.9)" : "2px solid transparent"
                    }}
                >
                    <div
                        style={{
                            ...bodyTextStyle(),
                            fontStyle: "italic",
                            color: target ? (focused ? "#8fc4ff" : "#4ea1ff") : undefined,
                            textDecoration: target ? "underline" : undefined,
                            opacity: target ? 1 : 0.8,
                            whiteSpace: "normal",
                            wordBreak: "break-word",
                            textAlign: "left"
                        }}
                    >
                        {`\u201C${text}\u201D`}
                    </div>
                </Focusable>
            </div>
            <div
                style={{
                    borderBottom: "1px solid rgba(255, 255, 255, 0.12)",
                    marginTop: "10px",
                    marginBottom: "6px"
                }}
            />
        </div>
    );
}
