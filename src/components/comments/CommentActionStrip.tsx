import { type CSSProperties } from "react";
import { DialogButton, Focusable } from "@decky/ui";

import { t, type LanguageCode } from "../../locales";

export type CommentActionStripProps = {
    language: LanguageCode;
    isSubscribed: boolean;
    onPost: () => void | Promise<void>;
    onToggleSubscribe: () => void | Promise<void>;
    postFocusKey: string;
    subscribeFocusKey: string;
    topMargin?: string;
};

const ROW_STYLE: CSSProperties = {
    width: "100%",
    display: "flex",
    gap: "6px",
    margin: "2px 0 8px 0",
};

const BUTTON_STYLE: CSSProperties = {
    minWidth: 0,
    width: "100%",
    padding: "10px 12px",
    fontWeight: 800,
    justifyContent: "center",
};

export function CommentActionStrip(props: CommentActionStripProps) {
    const { language, isSubscribed, onPost, onToggleSubscribe, postFocusKey, subscribeFocusKey, topMargin } = props;

    return (
        <Focusable
            flow-children="row"
            style={topMargin === undefined ? ROW_STYLE : { ...ROW_STYLE, marginTop: topMargin }}
        >
            <div data-focus-key={postFocusKey} style={{ display: "flex", flex: 1 }}>
                <DialogButton onClick={onPost} style={BUTTON_STYLE}>
                    {t(language, "Post")}
                </DialogButton>
            </div>
            <div data-focus-key={subscribeFocusKey} style={{ display: "flex", flex: 1 }}>
                <DialogButton onClick={onToggleSubscribe} style={BUTTON_STYLE}>
                    {t(language, isSubscribed ? "Unsubscribe" : "Subscribe")}
                </DialogButton>
            </div>
        </Focusable>
    );
}
