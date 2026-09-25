import { DialogButton, Focusable } from "@decky/ui";
import { t, type LanguageCode } from "../../locales";
import { useBrowserPress } from "../../hooks/useBrowserPress";
import { modalSize } from "../../utils/scale";

type BrowserBookmarkLimitProps = {
    language: LanguageCode;
    url: string;
    maxBookmarks: number;
    onDismiss: () => void;
};

export function BrowserBookmarkLimit(props: BrowserBookmarkLimitProps) {
    const { language, url, maxBookmarks, onDismiss } = props;

    const act = useBrowserPress();

    const gap = `${modalSize(8)}px`;

    return (
        <Focusable
            focusable={false}
            childFocusDisabled
            style={{
                display: "flex",
                flexDirection: "column",
                flex: "1 1 auto",
                minHeight: "0",
                width: "100%",
                boxSizing: "border-box",
                padding: `${modalSize(16)}px`,
                gap,
                overflowY: "auto"
            }}
        >
            <div style={{ fontSize: `${modalSize(16)}px`, fontWeight: 700 }}>
                {t(language, "Bookmark Limit Reached")}
            </div>
            <div style={{ fontSize: `${modalSize(13)}px`, opacity: 0.8 }}>
                {t(language, "Cannot keep more than {{count}} bookmarks. Remove one to make room for this page.", { count: maxBookmarks })}
            </div>
            <div
                style={{
                    fontSize: `${modalSize(12)}px`,
                    opacity: 0.65,
                    wordBreak: "break-word"
                }}
            >
                {url}
            </div>

            <div style={{ marginTop: gap }}>
                <DialogButton
                    {...act("dismiss", onDismiss)}
                    style={{ width: "100%", minWidth: "0", padding: `0 ${modalSize(12)}px`, fontSize: `${modalSize(13)}px` }}
                >
                    {t(language, "Close")}
                </DialogButton>
            </div>
        </Focusable>
    );
}
