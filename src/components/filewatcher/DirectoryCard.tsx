import React, { useState } from "react";
import { DialogButton, Focusable } from "@decky/ui";

import { FocusableItem } from "../ui/FocusableItem";
import { t, type LanguageCode } from "../../locales";
import type { FileWatcherRoot } from "../../types";
import { bodyTextStyle, faultViolet, smallTextStyle } from "../../utils/style";

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

export type DirectoryCardListProps = {
    language: LanguageCode;
    locked: boolean;
    onOpen: (root: FileWatcherRoot) => void;
    onCardFocus: (index: number) => void;
    onTrashPress: (rootId: number) => void;
    onTrashBlur: (rootId: number) => void;
};

export type DirectoryCardProps = {
    root: FileWatcherRoot;
    fileCount: number;
    unreachable: boolean;
    armed: boolean;
    index: number;
    list: DirectoryCardListProps;
};

export const DirectoryCard = React.memo(function DirectoryCard(props: DirectoryCardProps) {
    const { root, fileCount, unreachable, armed, list } = props;
    const { language, locked } = list;

    const [trashFocused, setTrashFocused] = useState(false);

    function handleOpen() {
        list.onOpen(root);
    }

    function handleFocus() {
        list.onCardFocus(props.index);
    }

    function handleTrashPress() {
        list.onTrashPress(root.id);
    }

    function handleTrashFocus() {
        setTrashFocused(true);
    }

    function handleTrashBlur() {
        setTrashFocused(false);
        list.onTrashBlur(root.id);
    }

    const statusLine = unreachable
        ? t(language, "{{count}} files · unreachable", { count: fileCount })
        : fileCount > 0
            ? t(language, "{{count}} files", { count: fileCount })
            : "";

    return (
        <Focusable
            flow-children="row"
            style={{ position: "relative", display: "flex", alignItems: "stretch", width: "100%" }}
        >
            <FocusableItem
                focusKey={`filewatcher:card:${root.id}`}
                onClick={handleOpen}
                onFocus={handleFocus}
                outerStyle={{ width: "100%", minWidth: 0 }}
            >
                <div
                    style={{
                        width: "100%",
                        display: "flex",
                        flexDirection: "column",
                        gap: "3px",
                        textAlign: "left",
                        padding: "3px 0",
                        minWidth: 0,
                        paddingRight: "30px"
                    }}
                >
                    <div style={{ fontWeight: 800, minWidth: 0, wordBreak: "break-word" }}>
                        {root.label}
                    </div>
                    <div style={{ ...smallTextStyle(), minWidth: 0, wordBreak: "break-all" }}>
                        {root.path}
                    </div>
                    {statusLine && (
                        <div
                            style={{
                                ...bodyTextStyle(),
                                color: unreachable ? faultViolet : undefined,
                                opacity: unreachable ? 1 : undefined,
                                minWidth: 0,
                                wordBreak: "break-word"
                            }}
                        >
                            {statusLine}
                        </div>
                    )}
                </div>
            </FocusableItem>

            <div
                data-focus-key={`filewatcher:trash:${root.id}`}
                style={{
                    position: "absolute",
                    top: "11px",
                    right: "6px",
                    zIndex: 2,
                    width: "32px",
                    height: "32px",
                    display: "flex"
                }}
            >
                <DialogButton
                    onClick={handleTrashPress}
                    onGamepadFocus={handleTrashFocus}
                    onGamepadBlur={handleTrashBlur}
                    disabled={locked}
                    style={{
                        minWidth: 0,
                        width: "32px",
                        height: "32px",
                        padding: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: locked ? 0.4 : 1,
                        color: armed
                            ? "rgba(255,255,255,0.98)"
                            : trashFocused
                                ? "rgba(24,24,24,0.98)"
                                : "rgba(255,255,255,0.92)",
                        background: armed
                            ? "rgba(220,38,38,0.92)"
                            : trashFocused
                                ? "rgba(255,255,255,0.96)"
                                : "rgba(24,24,24,0.78)",
                        border: armed
                            ? "1px solid rgba(255,255,255,0.9)"
                            : trashFocused
                                ? "1px solid rgba(255,255,255,1)"
                                : "1px solid rgba(255,255,255,0.36)",
                        boxShadow: trashFocused
                            ? "0 0 0 2px rgba(255,255,255,0.78), 0 2px 8px rgba(0,0,0,0.45)"
                            : armed
                                ? "0 0 0 2px rgba(220,38,38,0.65), 0 2px 8px rgba(0,0,0,0.45)"
                                : "0 2px 6px rgba(0,0,0,0.35)",
                        transition: "background 120ms ease, box-shadow 120ms ease, color 120ms ease"
                    }}
                >
                    <TrashIcon size={15} />
                </DialogButton>
            </div>
        </Focusable>
    );
});
