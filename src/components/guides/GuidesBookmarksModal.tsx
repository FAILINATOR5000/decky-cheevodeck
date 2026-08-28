import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useMemo, useState } from "react";

import { FADE_IN_KEYFRAMES, errorRed } from "../../utils/style";
import { t, type LanguageCode } from "../../locales";
import { modalSize } from "../../utils/scale";
import { LabeledRow } from "../ui/LabeledRow";
import { GuidesBookmarkModal } from "./GuidesBookmarkModal";
import { showManagedModal } from "../../utils/modalRegistry";
import type { GuideSpot } from "../../utils/guidesChunk";
import type { GuideBookmark } from "../../types";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

type GuidesBookmarksModalProps = {
    language: LanguageCode;
    rows: Array<{ bookmark: GuideBookmark; label: string }>;
    onPick: (bookmark: GuideBookmark) => void;
    onSave?: (name: string) => Promise<GuideBookmark | null>;
    onDelete?: (bookmark: GuideBookmark) => void;
    onJump?: (spot: GuideSpot) => void;
    groupOf?: (bookmark: GuideBookmark) => number;
    close: () => void;
};

const SORTS = ["list", "newest", "oldest", "alpha"] as const;
type SortMode = typeof SORTS[number];

function sortLabel(mode: SortMode, language: LanguageCode): string {
    if (mode === "newest") return t(language, "Newest");
    if (mode === "oldest") return t(language, "Oldest");
    if (mode === "alpha") return t(language, "Alphabetical");
    return t(language, "List Order");
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function TrashIcon({ size = 15 }: { size?: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 448 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M170.5 51.6L151.5 80l145 0-19-28.4c-1.5-2.2-4-3.6-6.7-3.6l-93.7 0c-2.7 0-5.2 1.3-6.7 3.6zm147-26.6L354.2 80 368 80l48 0 8 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-8 0 0 304c0 44.2-35.8 80-80 80l-224 0c-44.2 0-80-35.8-80-80l0-304-8 0c-13.3 0-24-10.7-24-24s10.7-24 24-24l8 0 48 0 13.8 0 36.7-55c10.4-15.6 27.9-25 46.7-25l93.7 0c18.7 0 36.2 9.4 46.7 25zM80 128l0 304c0 17.7 14.3 32 32 32l224 0c17.7 0 32-14.3 32-32l0-304L80 128zm80 64l0 208c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-208c0-8.8 7.2-16 16-16s16 7.2 16 16zm80 0l0 208c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-208c0-8.8 7.2-16 16-16s16 7.2 16 16zm80 0l0 208c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-208c0-8.8 7.2-16 16-16s16 7.2 16 16z" />
        </svg>
    );
}

export function GuidesBookmarksModal(props: GuidesBookmarksModalProps) {
    const { language, onPick, onSave, onDelete, onJump, close } = props;
    const [items, setItems] = useState(props.rows);
    const [sort, setSort] = useState<SortMode>("list");
    const [armed, setArmed] = useState<string | null>(null);

    const sorted = useMemo(() => {
        const copy = items.slice();
        if (sort === "list") {
            const group = (row: { bookmark: GuideBookmark }) => props.groupOf?.(row.bookmark) ?? 0;
            copy.sort((a, b) => (group(a) - group(b))
                || ((a.bookmark.page || 0) - (b.bookmark.page || 0))
                || ((a.bookmark.scroll || 0) - (b.bookmark.scroll || 0)));
            return copy;
        }
        if (sort === "alpha") {
            copy.sort((a, b) => a.label.localeCompare(b.label, language));
        }
        else {
            const sign = sort === "newest" ? -1 : 1;
            copy.sort((a, b) => sign * ((a.bookmark.createdAt || 0) - (b.bookmark.createdAt || 0)));
        }
        return copy;
    }, [items, sort, language, props.groupOf]);

    function promptSave() {
        if (!onSave) {
            return;
        }
        showManagedModal((closeName) => (
            <GuidesBookmarkModal
                language={language}
                onSubmit={(name) => {
                    void onSave(name).then((bookmark) => {
                        if (bookmark) {
                            setItems((prior) => [...prior, { bookmark, label: bookmark.name }]);
                        }
                    });
                }}
                close={closeName}
            />
        ));
    }

    function pressTrash(bookmark: GuideBookmark) {
        if (armed !== bookmark.id) {
            setArmed(bookmark.id);
            return;
        }
        setArmed(null);
        setItems((prior) => prior.filter((row) => row.bookmark.id !== bookmark.id));
        onDelete?.(bookmark);
    }

    const groupLabel = { fontSize: `${modalSize(13)}px`, fontWeight: 600, opacity: 0.7 };

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <style>{FADE_IN_KEYFRAMES}</style>
                <div style={{ fontSize: `${modalSize(18)}px`, fontWeight: 700 }}>
                    {t(language, "Bookmarks")}
                </div>
                {onSave && (
                    <Focusable>
                        <DialogButton onClick={promptSave} style={{ width: "100%", textAlign: "left" }}>
                            {t(language, "Bookmark This Spot")}
                        </DialogButton>
                    </Focusable>
                )}
                {onJump && (
                    <>
                        <div style={groupLabel}>{t(language, "Shortcuts")}</div>
                        <Focusable
                            flow-children="row"
                            style={{ display: "flex", gap: "6px", alignItems: "stretch" }}
                        >
                            <DialogButton
                                onClick={() => { close(); onJump("top"); }}
                                style={{ flex: 1, minWidth: 0 }}
                            >
                                {t(language, "Top")}
                            </DialogButton>
                            <DialogButton
                                onClick={() => { close(); onJump("center"); }}
                                style={{ flex: 1, minWidth: 0 }}
                            >
                                {t(language, "Center")}
                            </DialogButton>
                            <DialogButton
                                onClick={() => { close(); onJump("bottom"); }}
                                style={{ flex: 1, minWidth: 0 }}
                            >
                                {t(language, "Bottom")}
                            </DialogButton>
                        </Focusable>
                    </>
                )}
                {items.length > 0 && (onSave || onJump) && (
                    <div style={{ height: "1px", background: "rgba(255,255,255,0.15)" }} />
                )}
                {items.length > 0 && (
                    <div style={groupLabel}>{t(language, "Bookmarks")}</div>
                )}
                {items.length > 1 && (
                    <LabeledRow
                        focusKey="guides:bookmarks:sort"
                        label={t(language, "Sort")}
                        value={sortLabel(sort, language)}
                        onClick={() => setSort((current) => SORTS[(SORTS.indexOf(current) + 1) % SORTS.length])}
                    />
                )}
                {
}
                <Focusable style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "60vh", overflowY: "auto" }}>
                    {sorted.map(({ bookmark, label }) => (
                        <Focusable
                            key={bookmark.id}
                            flow-children="row"
                            style={{ display: "flex", gap: "6px", alignItems: "stretch" }}
                        >
                            <DialogButton
                                onClick={() => onPick(bookmark)}
                                style={{ flex: 1, minWidth: 0, textAlign: "left" }}
                            >
                                {label}
                            </DialogButton>
                            {onDelete && (
                                <DialogButton
                                    onClick={() => pressTrash(bookmark)}
                                    onGamepadBlur={() => {
                                        if (armed === bookmark.id) {
                                            setArmed(null);
                                        }
                                    }}
                                    style={{
                                        minWidth: 0,
                                        width: `${modalSize(44)}px`,
                                        flex: "0 0 auto",
                                        padding: 0,
                                        color: armed === bookmark.id ? errorRed : undefined,
                                    }}
                                >
                                    <TrashIcon size={modalSize(15)} />
                                </DialogButton>
                            )}
                        </Focusable>
                    ))}
                </Focusable>
            </div>
        </ModalRoot>
    );
}
