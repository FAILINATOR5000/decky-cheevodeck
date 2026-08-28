import type { NewsEntry } from "../../types";
import type { LanguageCode } from "../../locales";
import { formatUnlockDate } from "../../utils/achievements";
import { FocusableItem } from "../ui/FocusableItem";
import { type AchievementUiMetrics, smallTextStyle } from "../../utils/style";

const SUMMARY_MAX_CHARS = 180;

function clipSummary(value: string | null | undefined) {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
        return "";
    }
    if (trimmed.length <= SUMMARY_MAX_CHARS) {
        return trimmed;
    }
    const cut = trimmed.slice(0, SUMMARY_MAX_CHARS);
    const lastSpace = cut.lastIndexOf(" ");
    const stem = lastSpace > SUMMARY_MAX_CHARS - 30 ? cut.slice(0, lastSpace) : cut;
    return `${stem.trimEnd()}\u2026`;
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function NewspaperThumb({ size }: { size: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 576 512"
            width={size * 0.62}
            height={size * 0.62}
            fill="currentColor"
        >
            <path d="M0 96C0 78.3 14.3 64 32 64H416c17.7 0 32 14.3 32 32V384c0 17.7-14.3 32-32 32H32C14.3 416 0 401.7 0 384V96zM64 144c0 8.8 7.2 16 16 16H368c8.8 0 16-7.2 16-16s-7.2-16-16-16H80c-8.8 0-16 7.2-16 16zm0 64c0 8.8 7.2 16 16 16H368c8.8 0 16-7.2 16-16s-7.2-16-16-16H80c-8.8 0-16 7.2-16 16zm0 64c0 8.8 7.2 16 16 16H224c8.8 0 16-7.2 16-16s-7.2-16-16-16H80c-8.8 0-16 7.2-16 16zM272 256H368c8.8 0 16 7.2 16 16v64c0 8.8-7.2 16-16 16H272c-8.8 0-16-7.2-16-16V272c0-8.8 7.2-16 16-16zM80 320c-8.8 0-16 7.2-16 16s7.2 16 16 16H224c8.8 0 16-7.2 16-16s-7.2-16-16-16H80zM480 128h32c17.7 0 32 14.3 32 32V384c0 35.3-28.7 64-64 64H64c-17.7 0-32-14.3-32-32s14.3-32 32-32H480V128z" />
        </svg>
    );
}

export type NewsCardProps = {
    entry: NewsEntry;
    language: LanguageCode;
    metrics: AchievementUiMetrics;
    focusKey: string;
    onOpen: (url: string) => void | Promise<void>;
};

export function NewsCard(props: NewsCardProps) {
    const { entry, language, metrics, focusKey, onOpen } = props;

    const title = String(entry.title || "").trim();
    const summary = clipSummary(entry.summary);
    const date = formatUnlockDate(entry.publishedAt, { includeYear: true }, language);

    function handleClick() {
        const link = String(entry.link || "").trim();
        if (!link) {
            return;
        }
        void onOpen(link);
    }

    return (
        <FocusableItem focusKey={focusKey} onClick={handleClick}>
            <div
                style={{
                    width: "100%",
                    display: "flex",
                    gap: `${Math.max(8, metrics.iconGap - 2)}px`,
                    alignItems: "flex-start",
                    padding: "2px 0",
                    minWidth: 0
                }}
            >
                <div
                    style={{
                        width: `${metrics.iconSize}px`,
                        height: `${metrics.iconSize}px`,
                        borderRadius: "7px",
                        flexShrink: 0,
                        background: "rgba(255,255,255,0.10)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                    }}
                >
                    <NewspaperThumb size={metrics.iconSize} />
                </div>
                <div
                    style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: `${Math.max(2, metrics.contentGap - 1)}px`,
                        textAlign: "left"
                    }}
                >
                    <div
                        style={{
                            fontSize: `${metrics.titleFontSize - 1}px`,
                            lineHeight: metrics.titleLineHeight,
                            fontWeight: 800,
                            minWidth: 0,
                            wordBreak: "break-word"
                        }}
                    >
                        {title}
                    </div>
                    {summary && (
                        <div
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${metrics.bodyFontSize}px`,
                                lineHeight: metrics.bodyLineHeight,
                                opacity: 0.9,
                                minWidth: 0,
                                wordBreak: "break-word"
                            }}
                        >
                            {summary}
                        </div>
                    )}
                    {date && (
                        <div
                            style={{
                                ...smallTextStyle(),
                                fontSize: `${metrics.pointsFontSize}px`,
                                lineHeight: metrics.pointsLineHeight,
                                opacity: 1,
                                fontWeight: 700
                            }}
                        >
                            {date}
                        </div>
                    )}
                </div>
            </div>
        </FocusableItem>
    );
}
