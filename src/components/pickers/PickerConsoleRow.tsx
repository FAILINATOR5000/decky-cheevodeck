import React from "react";

import { t, type LanguageCode } from "../../locales";
import type { TrackedSetConsole } from "../../types";
import { formatInteger } from "../../utils/format";
import { FocusableItem } from "../ui/FocusableItem";
import type { PickerRowMetrics } from "./PickerGameRow";

export function AllSystemsIcon(props: { size?: number }) {
    const size = props.size ?? 18;
    return (
        <svg
            viewBox="0 0 24 24"
            width={size}
            height={size}
            fill="currentColor"
        >
            <rect x="3" y="3" width="8" height="8" rx="1.5" />
            <rect x="13" y="3" width="8" height="8" rx="1.5" />
            <rect x="3" y="13" width="8" height="8" rx="1.5" />
            <rect x="13" y="13" width="8" height="8" rx="1.5" />
        </svg>
    );
}

export type ConsoleRowListProps = {
    language: LanguageCode;
    showIcons: boolean;
    metrics: PickerRowMetrics;
    onPick: (item: TrackedSetConsole) => void;
    keyPrefix: string;
    onRowFocus?: (index: number) => void;
};

type ConsoleRowProps = {
    item: TrackedSetConsole;
    dimmed: boolean;
    list: ConsoleRowListProps;
    rowKey?: string;
    count?: number;
    allSystems?: boolean;
    index?: number;
    onGamepadDirection?: (evt: { detail?: { button?: number } }) => boolean | void;
};

export const ConsoleRow = React.memo(function ConsoleRow(props: ConsoleRowProps) {
    const { item, dimmed, list } = props;
    const { language, showIcons, metrics } = list;

    const fallbackLetter = item.name.trim().charAt(0).toUpperCase() || "?";

    function handleClick() {
        list.onPick(item);
    }

    function handleFocus() {
        if (props.index !== undefined) {
            list.onRowFocus?.(props.index);
        }
    }

    const name = item.name || t(language, "Unknown console");

    return (
        <FocusableItem
            focusKey={`${list.keyPrefix}${props.rowKey ?? item.id}`}
            onClick={handleClick}
            onGamepadFocus={list.onRowFocus ? handleFocus : undefined}
            onGamepadDirection={props.onGamepadDirection}
            outerStyle={{ width: "100%", minWidth: 0 }}
        >
            <div
                style={{
                    width: "100%",
                    display: "flex",
                    gap: `${Math.max(8, metrics.iconGap - 2)}px`,
                    alignItems: "center",
                    padding: `${Math.max(3, Math.round(metrics.rowPaddingY * 0.42))}px 0`,
                    minWidth: 0,
                    opacity: dimmed ? 0.5 : 1
                }}
            >
                {showIcons && (
                    <div
                        style={{
                            width: `${metrics.iconSize}px`,
                            height: `${metrics.iconSize}px`,
                            borderRadius: "7px",
                            overflow: "hidden",
                            flexShrink: 0,
                            background: "rgba(255,255,255,0.10)",
                            border: "1px solid rgba(255,255,255,0.12)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: `${Math.max(16, metrics.iconSize * 0.42)}px`,
                            fontWeight: 800
                        }}
                    >
                        {props.allSystems ? (
                            <AllSystemsIcon size={Math.round(metrics.iconSize * 0.55)} />
                        ) : item.iconUrl ? (
                            <img
                                src={item.iconUrl}
                                alt=""
                                decoding="async"
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "contain",
                                    display: "block"
                                }}
                            />
                        ) : (
                            fallbackLetter
                        )}
                    </div>
                )}
                <div
                    style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: `${metrics.titleFontSize}px`,
                        lineHeight: metrics.titleLineHeight,
                        fontWeight: 800,
                        textAlign: "left",
                        wordBreak: "break-word"
                    }}
                >
                    {props.count === undefined
                        ? name
                        : t(language, "{{label}} ({{count}})", { label: name, count: formatInteger(props.count) })}
                </div>
            </div>
        </FocusableItem>
    );
});
