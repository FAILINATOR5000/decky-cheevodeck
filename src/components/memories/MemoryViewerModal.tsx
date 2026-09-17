import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
// Font Awesome Free icon, CC BY 4.0. See ATTRIBUTIONS.md.
import { FaTrophy } from "react-icons/fa";
import {
    cacheAchievementIcons,
    deleteMemory,
    getAchievementIcons,
    getCachedAchievementIcons,
    loadMemoryFull
} from "../../api";
import { armMemoriesFocusKey, armMemoriesFocusReturn } from "../../utils/memoriesFocusReturn";
import { FadeImage } from "../ui/FadeImage";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { PencilIcon } from "../ui/PencilIcon";
import { AwardStamp } from "../achievements/AwardStamp";
import { HardcoreBadge } from "../achievements/HardcoreBadge";
import { POINTS_LABEL_STYLES, PointsLabel } from "../achievements/PointsLabel";
import { UnlockStamp } from "../achievements/UnlockStamp";
import { MemoryEditorModal } from "./MemoryEditorModal";
import { showMemoryFullscreen } from "./memoryFullscreen";
import { showManagedModal } from "../../utils/modalRegistry";
import { logError } from "../../utils/errors";
import { formatUnlockDate, noteBodyColor } from "../../utils/achievements";
import { getDeviceIsSteamMachine, modalSize } from "../../utils/scale";
import { errorRed } from "../../utils/style";
import { t, type LanguageCode } from "../../locales";
import type { AchievementRow, MemoryRecord } from "../../types";

const MEMORY_DIALOG_CSS = `
.cheevo-memory-dialog.DialogContent, .cheevo-memory-dialog {
    width: min(86vw, 1100px);
    max-width: min(86vw, 1100px);
}
.cheevo-memory-full.DialogContent, .cheevo-memory-full {
    width: 100vw;
    max-width: 100vw;
    padding: 0;
    border: none;
    background: transparent;
}
.cheevo-memory-fullpos .ModalPosition_Content {
    max-width: 100vw;
    max-height: 100vh;
    box-shadow: none;
}
.cheevo-memory-full [class*="gpfocus"],
.cheevo-memory-full [class*="GPFocus"],
.cheevo-memory-full *:focus,
.cheevo-memory-full *:focus-visible {
    outline: none !important;
    box-shadow: none !important;
    border-color: transparent !important;
}
.cheevo-memory-full [class*="gpfocus"]::before,
.cheevo-memory-full [class*="gpfocus"]::after,
.cheevo-memory-full [class*="GPFocus"]::before,
.cheevo-memory-full [class*="GPFocus"]::after {
    display: none !important;
}
`;

const RAIL_CARD_LIMIT = 3;

const IMAGE_LAYER_STYLE: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "contain",
    display: "block"
};

export type MemoryViewerModalProps = {
    memory: MemoryRecord;
    gameId: number;
    thumbDataUri: string | null;
    language: LanguageCode;
    showRetroPoints: boolean;
    tagVocabulary: string[];
    allTags: string[];
    activeUlid: string;
    tagFilter: string;
    removalLandingId: string | null;
    close: () => void;
};

export function MemoryViewerModal(props: MemoryViewerModalProps) {
    const { memory, gameId, thumbDataUri, language, showRetroPoints, tagVocabulary, allTags, activeUlid, tagFilter, removalLandingId, close } = props;

    const [caption, setCaption] = useState(memory.caption);
    const [tag, setTag] = useState(memory.tag);
    const [color, setColor] = useState(memory.color);

    const [vocabulary, setVocabulary] = useState(tagVocabulary);
    const [knownTags, setKnownTags] = useState(allTags);

    const [fullSrc, setFullSrc] = useState<string | null>(null);
    const [downscaled, setDownscaled] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    const [badges, setBadges] = useState<Record<string, string>>({});
    const [armedDelete, setArmedDelete] = useState(false);

    const blobUrlRef = useRef<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const result = await loadMemoryFull(gameId, memory.path);
                if (cancelled || !result?.dataUri) {
                    return;
                }
                setDownscaled(Boolean(result.downscaled));
                const comma = result.dataUri.indexOf(",");
                const header = result.dataUri.slice(5, result.dataUri.indexOf(";"));
                const binary = atob(result.dataUri.slice(comma + 1));
                const bytes = new Uint8Array(binary.length);
                for (let index = 0; index < binary.length; index += 1) {
                    bytes[index] = binary.charCodeAt(index);
                }
                const url = URL.createObjectURL(new Blob([bytes], { type: header }));
                blobUrlRef.current = url;
                setFullSrc(url);
            } catch (error) {
                logError("memories: couldn't read a memory at full size", error);
            }
        })();

        return () => {
            cancelled = true;
            if (blobUrlRef.current) {
                URL.revokeObjectURL(blobUrlRef.current);
                blobUrlRef.current = null;
            }
        };
    }, [gameId, memory.path]);

    useEffect(() => {
        const names = memory.achievements.map((card) => card.badgeName).filter(Boolean);
        if (names.length === 0) {
            return;
        }
        const cached = getCachedAchievementIcons(gameId, names);
        setBadges(cached);
        const missing = names.filter((name) => !cached[name]);
        if (missing.length === 0) {
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const result = await getAchievementIcons(gameId, missing);
                if (cancelled || !result?.icons) {
                    return;
                }
                cacheAchievementIcons(gameId, result.icons);
                setBadges((current) => ({ ...current, ...result.icons }));
            } catch (error) {
                logError("memories: couldn't read achievement badges", error);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [gameId, memory.achievements]);

    useEffect(() => {
        if (!fullscreen) {
            return;
        }
        if (!fullSrc && !thumbDataUri) {
            return;
        }
        return showMemoryFullscreen(thumbDataUri, fullSrc);
    }, [fullscreen, fullSrc, thumbDataUri]);

    const handleCancel = useCallback(() => {
        if (fullscreen) {
            setFullscreen(false);
            return;
        }
        close();
    }, [fullscreen, close]);

    function pressDelete() {
        if (!armedDelete) {
            setArmedDelete(true);
            return;
        }
        void deleteMemory(gameId, memory.id).catch((e) => {
            logError("memories: couldn't delete a memory", e);
        });
        if (removalLandingId === null) {
            armMemoriesFocusKey("memories:back");
        } else {
            armMemoriesFocusReturn(gameId, removalLandingId, activeUlid);
        }
        close();
    }

    function openEditor() {
        showManagedModal((closeEditor) => (
            <MemoryEditorModal
                memory={{ ...memory, caption, tag, color }}
                gameId={gameId}
                language={language}
                tagVocabulary={vocabulary}
                allTags={knownTags}
                activeUlid={activeUlid}
                tagFilter={tagFilter}
                removalLandingId={removalLandingId}
                onSaved={(next) => {
                    setCaption(next.caption);
                    setTag(next.tag);
                    setColor(next.color);
                    setVocabulary(next.tagVocabulary);
                    setKnownTags((current) => {
                        const seen = new Set<string>();
                        const merged: string[] = [];
                        for (const entry of [...next.tagVocabulary, ...current]) {
                            const trimmed = entry.trim();
                            if (!trimmed || seen.has(trimmed.toLowerCase())) {
                                continue;
                            }
                            seen.add(trimmed.toLowerCase());
                            merged.push(trimmed);
                        }
                        return merged;
                    });
                }}
                close={closeEditor}
            />
        ));
    }

    const stampFormatter = useMemo(() => new Intl.DateTimeFormat(language, {
        day: "numeric",
        month: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
    }), [language]);

    const captured = new Date(memory.capturedAt * 1000);
    const progress = memory.progress;
    const rule = noteBodyColor(color);
    const imageMaxVh = getDeviceIsSteamMachine() ? 70 : 55;

    const railCards = memory.achievements.slice(0, RAIL_CARD_LIMIT);
    const overflow = Math.max(0, memory.achievementCount - railCards.length);

    if (fullscreen) {
        return (
            <ModalRoot
                onCancel={handleCancel}
                onEscKeypress={handleCancel}
                className="cheevo-memory-full"
                modalClassName="cheevo-memory-fullpos"
            >
                <SnapshotHotkey language={language} />
                <style>{MEMORY_DIALOG_CSS}</style>
                <Focusable
                    onActivate={() => setFullscreen(false)}
                    onOKActionDescription={t(language, "Shrink")}
                    style={{ display: "block", width: "100%" }}
                >
                    <FadeImage
                        src={fullSrc ?? thumbDataUri ?? ""}
                        fadeOnLoad={false}
                        decoding="async"
                        style={{
                            width: "100%",
                            maxHeight: "calc(100vh - 110px)",
                            objectFit: "contain",
                            display: "block"
                        }}
                    />
                </Focusable>
            </ModalRoot>
        );
    }

    return (
        <ModalRoot
            onCancel={handleCancel}
            onEscKeypress={handleCancel}
            className="cheevo-memory-dialog"
        >
            <Focusable
                onSecondaryButton={pressDelete}
                onSecondaryActionDescription={armedDelete
                    ? t(language, "Delete Again to Confirm")
                    : t(language, "Delete")}
            >
                <SnapshotHotkey language={language} />
                <style>{MEMORY_DIALOG_CSS}</style>
                <style>{POINTS_LABEL_STYLES}</style>

                <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            marginBottom: "10px",
                            fontSize: `${modalSize(14)}px`
                        }}
                    >
                        <span style={{ fontWeight: 700 }}>
                            <AwardStamp date={stampFormatter.format(captured)} />
                        </span>
                        {progress ? (
                            <>
                                <span style={{ opacity: 0.55 }}>{"\u00b7"}</span>
                                <span
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "0.35em",
                                        opacity: 0.75
                                    }}
                                >
                                    <FaTrophy style={{ flexShrink: 0 }} />
                                    <span>
                                        {t(language, "{{awarded}}/{{possible}} Achievements", {
                                            awarded: progress.unlocked,
                                            possible: progress.total
                                        })}
                                    </span>
                                </span>
                            </>
                        ) : null}
                        {downscaled ? (
                            <span style={{ marginLeft: "auto", opacity: 0.7, fontSize: `${modalSize(12)}px` }}>
                                {t(language, "Preview quality")}
                            </span>
                        ) : null}
                    </div>

                <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <Focusable
                            onActivate={() => setFullscreen((current) => !current)}
                            onOKActionDescription={t(language, "Fullscreen")}
                            style={{ display: "block" }}
                        >
                            <div
                                style={{
                                    position: "relative",
                                    width: "100%",
                                    aspectRatio: "16 / 9",
                                    maxHeight: `${imageMaxVh}vh`,
                                    background: "rgba(255,255,255,0.06)",
                                    borderRadius: "6px",
                                    overflow: "hidden"
                                }}
                            >
                                {thumbDataUri ? (
                                    <FadeImage
                                        src={thumbDataUri}
                                        fadeOnLoad={false}
                                        decoding="async"
                                        style={IMAGE_LAYER_STYLE}
                                    />
                                ) : null}
                                {fullSrc ? (
                                    <FadeImage
                                        src={fullSrc}
                                        fadeOnLoad
                                        decoding="async"
                                        style={IMAGE_LAYER_STYLE}
                                    />
                                ) : null}
                            </div>
                        </Focusable>

                        {rule ? (
                            <div style={{ height: "2px", borderRadius: "1px", background: rule, margin: "10px 0 6px" }} />
                        ) : null}
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginTop: "8px" }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: `${modalSize(15)}px`, wordBreak: "break-word" }}>
                                    {caption}
                                </div>
                                {tag ? (
                                    <div style={{ fontSize: `${modalSize(12)}px`, opacity: 0.75, marginTop: "4px" }}>
                                        {t(language, "Tag: {{tag}}", { tag })}
                                    </div>
                                ) : null}
                            </div>
                            <Focusable flow-children="row" style={{ display: "flex", flexShrink: 0 }}>
                                <DialogButton
                                    onClick={openEditor}
                                    style={{
                                        minWidth: 0,
                                        width: `${modalSize(34)}px`,
                                        height: `${modalSize(34)}px`,
                                        padding: "4px",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center"
                                    }}
                                >
                                    <PencilIcon size={modalSize(16)} />
                                </DialogButton>
                            </Focusable>
                        </div>

                        <Focusable style={{ display: "flex", marginTop: "12px" }}>
                            <DialogButton onClick={close} style={{ width: "100%" }}>
                                {t(language, "Close")}
                            </DialogButton>
                        </Focusable>
                    </div>

                    {railCards.length > 0 && (
                        <div style={{ width: `${modalSize(200)}px`, display: "flex", flexDirection: "column", gap: "6px" }}>
                            {railCards.map((card) => (
                                <div
                                    key={card.id}
                                    style={{
                                        display: "flex",
                                        gap: "8px",
                                        alignItems: "flex-start",
                                        padding: "8px",
                                        borderRadius: "6px",
                                        background: "rgba(255,255,255,0.06)"
                                    }}
                                >
                                    <div
                                        style={{
                                            width: `${modalSize(40)}px`,
                                            flexShrink: 0,
                                            display: "flex",
                                            flexDirection: "column",
                                            alignItems: "center",
                                            gap: "2px"
                                        }}
                                    >
                                        <div style={{ width: "100%", height: `${modalSize(40)}px` }}>
                                            {badges[card.badgeName] ? (
                                                <FadeImage
                                                    src={badges[card.badgeName]}
                                                    style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                                                />
                                            ) : null}
                                        </div>
                                        <div
                                            style={{
                                                width: "100%",
                                                textAlign: "center",
                                                fontSize: `${modalSize(11)}px`,
                                                lineHeight: 1.2,
                                                opacity: 0.9
                                            }}
                                        >
                                            <div>
                                                <PointsLabel
                                                    achievement={{
                                                        points: card.points,
                                                        trueRatio: card.trueRatio
                                                    } as AchievementRow}
                                                    showRetroPoints={showRetroPoints}
                                                    language={language}
                                                />
                                            </div>
                                            {card.hardcore ? (
                                                <HardcoreBadge
                                                    language={language}
                                                    fontSize={modalSize(11)}
                                                    short
                                                    style={{ marginTop: "2px" }}
                                                />
                                            ) : null}
                                        </div>
                                    </div>
                                    <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
                                        <span style={{ fontSize: `${modalSize(13)}px`, fontWeight: 700, wordBreak: "break-word" }}>
                                            {card.title}
                                        </span>
                                        <span
                                            style={{
                                                fontSize: `${modalSize(12)}px`,
                                                lineHeight: 1.3,
                                                opacity: 0.82,
                                                wordBreak: "break-word"
                                            }}
                                        >
                                            {card.description}
                                            {card.type === "missable" ? (
                                                <>
                                                    {" "}
                                                    <span style={{ color: errorRed }}>
                                                        {t(language, "(missable)")}
                                                    </span>
                                                </>
                                            ) : null}
                                        </span>
                                        {card.unlockedAt ? (
                                            <span style={{ fontSize: `${modalSize(11)}px`, opacity: 0.6 }}>
                                                <UnlockStamp
                                                    date={formatUnlockDate(
                                                        new Date(card.unlockedAt * 1000).toISOString(),
                                                        { includeYear: true, numericDate: true, shortYear: true },
                                                        language
                                                    )}
                                                />
                                            </span>
                                        ) : null}
                                    </div>
                                </div>
                            ))}
                            {overflow > 0 && (
                                <div style={{ fontSize: `${modalSize(12)}px`, opacity: 0.7, textAlign: "center" }}>
                                    {t(language, "+{{count}} more", { count: overflow })}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </Focusable>
        </ModalRoot>
    );
}
