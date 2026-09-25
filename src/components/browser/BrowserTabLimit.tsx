import { DialogButton, Focusable } from "@decky/ui";
import { t, type LanguageCode } from "../../locales";
import { useBrowserPress } from "../../hooks/useBrowserPress";
import { modalSize } from "../../utils/scale";

type BrowserTabLimitProps = {
    language: LanguageCode;
    url: string;
    maxTabs: number;
    onEvict: () => void;
    onCancel: () => void;
};

export function BrowserTabLimit(props: BrowserTabLimitProps) {
    const { language, url, maxTabs, onEvict, onCancel } = props;

    const act = useBrowserPress();

    const gap = `${modalSize(8)}px`;
    const choiceStyle: Record<string, string> = {
        width: "100%",
        minWidth: "0",
        padding: `0 ${modalSize(12)}px`,
        fontSize: `${modalSize(13)}px`
    };

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
                {t(language, "Tab Limit Reached")}
            </div>
            <div style={{ fontSize: `${modalSize(13)}px`, opacity: 0.8 }}>
                {t(language, "Cannot exceed {{count}} tabs. Close some tabs first, or open this page in place of the oldest one.", { count: maxTabs })}
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

            <div style={{ display: "flex", flexDirection: "column", gap: `${modalSize(6)}px`, marginTop: gap }}>
                <div>
                    <DialogButton {...act("evict", onEvict)} style={choiceStyle}>
                        {t(language, "Close Oldest Tab and Open")}
                    </DialogButton>
                </div>
                <div>
                    <DialogButton {...act("cancel", onCancel)} style={choiceStyle}>
                        {t(language, "Cancel")}
                    </DialogButton>
                </div>
            </div>
        </Focusable>
    );
}
