import { DialogButton, Focusable } from "@decky/ui";
import { t, type LanguageCode } from "../../locales";
import { useBrowserPress } from "../../hooks/useBrowserPress";
import { modalSize } from "../../utils/scale";

type BrowserLegacySiteProps = {
    language: LanguageCode;
    url: string;
    full: boolean;
    onAdd: () => void;
    onDecline: () => void;
};

export function BrowserLegacySite(props: BrowserLegacySiteProps) {
    const { language, url, full, onAdd, onDecline } = props;

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
                {t(language, "Site Can't Load Securely")}
            </div>
            <div style={{ fontSize: `${modalSize(13)}px`, opacity: 0.8 }}>
                {t(language, "This site's secure version is broken, and Steam's browser won't fall back to the plain one. Add it to Legacy Sites to load it over plain HTTP?")}
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
            {full && (
                <div style={{ fontSize: `${modalSize(12)}px`, opacity: 0.8 }}>
                    {t(language, "The list is full. Remove a site to add another.")}
                </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: `${modalSize(6)}px`, marginTop: gap }}>
                <div>
                    <DialogButton
                        {...act("legacy:add", () => {
                            if (!full) {
                                onAdd();
                            }
                        })}
                        style={{ ...choiceStyle, opacity: full ? "0.35" : "1" }}
                    >
                        {t(language, "Add and Reload")}
                    </DialogButton>
                </div>
                <div>
                    <DialogButton {...act("legacy:decline", onDecline)} style={choiceStyle}>
                        {t(language, "Not Now")}
                    </DialogButton>
                </div>
            </div>
        </Focusable>
    );
}
