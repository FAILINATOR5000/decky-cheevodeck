import { DialogButton, Focusable } from "@decky/ui";
import { useState } from "react";
import { FocusTarget } from "../ui/FocusTarget";
import type { LanguageCode } from "../../locales";
import type { ActivityMonth } from "../../types";

const SHADES = ["#2a313c", "#bbf7d0", "#4ade80", "#16a34a", "#14532d"];
const DARKEST_EDGE = "inset 0 0 0 1px rgba(187, 247, 208, 0.35)";

const DARKEST_MIN_COUNT = 8;

const FOCUS_RING = "0 0 0 3px #ffffff, 0 0 8px rgba(255, 255, 255, 0.6)";

function shadeLevel(count: number, quartiles: [number, number, number]): number {
    if (count <= 0) {
        return 0;
    }
    if (count >= quartiles[2]) {
        return count >= DARKEST_MIN_COUNT ? 4 : 3;
    }
    if (count >= quartiles[1]) {
        return 3;
    }
    if (count >= quartiles[0]) {
        return 2;
    }
    return 1;
}

export function shadeStyle(level: number) {
    return {
        background: SHADES[level],
        boxShadow: level === 4 ? DARKEST_EDGE : undefined
    };
}

function localeTag(language: LanguageCode): string | undefined {
    return language === "en" ? undefined : language;
}

function weekdayLetters(language: LanguageCode): string[] {
    const format = new Intl.DateTimeFormat(localeTag(language), { weekday: "narrow" });
    return Array.from({ length: 7 }, (_, index) => format.format(new Date(2024, 0, 1 + index)));
}

export function monthLabel(month: string, language: LanguageCode): string {
    const [year, monthNumber] = month.split("-").map(Number);
    return new Intl.DateTimeFormat(localeTag(language), { month: "short", year: "numeric" }).format(new Date(year, monthNumber - 1, 1));
}

export function dayLabel(day: string, language: LanguageCode): string {
    const [year, month, date] = day.split("-").map(Number);
    return new Intl.DateTimeFormat(localeTag(language), { weekday: "long", month: "long", day: "numeric" }).format(new Date(year, month - 1, date));
}

export function shortDayLabel(day: string, language: LanguageCode): string {
    const [year, month, date] = day.split("-").map(Number);
    return new Intl.DateTimeFormat(localeTag(language), { month: "short", day: "numeric" }).format(new Date(year, month - 1, date));
}

function monthCells(month: string): (string | null)[] {
    const [year, monthNumber] = month.split("-").map(Number);
    const first = new Date(year, monthNumber - 1, 1).getDay();
    const lead = (first + 6) % 7;
    const days = new Date(year, monthNumber, 0).getDate();
    const cells: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let date = 1; date <= days; date += 1) {
        cells.push(`${month}-${String(date).padStart(2, "0")}`);
    }
    while (cells.length % 7 !== 0) {
        cells.push(null);
    }
    return cells;
}

export function ActivityGrid(props: {
    language: LanguageCode;
    month: ActivityMonth;
    cellSize: number;
    onFocusDay: (day: string) => void;
    onBlurDay: (day: string) => void;
    onOpenDay: (day: string) => void;
}) {
    const { language, month, cellSize } = props;
    const cells = monthCells(month.month);
    const [focusedDay, setFocusedDay] = useState<string | null>(null);
    const gap = Math.max(3, Math.round(cellSize * 0.12));
    const grid = {
        display: "grid",
        gridTemplateColumns: `repeat(7, minmax(0, ${cellSize}px))`,
        gap: `${gap}px`,
        justifyContent: "center",
        width: "100%"
    };
    const square = { width: "100%", aspectRatio: "1 / 1" };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: `${gap}px`, width: "100%" }}>
            <div style={grid}>
                {weekdayLetters(language).map((letter, index) => (
                    <div key={index} style={{ textAlign: "center", fontSize: `${Math.round(cellSize * 0.4)}px`, opacity: 0.7 }}>
                        {letter}
                    </div>
                ))}
            </div>
            <Focusable flow-children="grid" style={grid}>
                {cells.map((day, index) => {
                    if (day === null) {
                        return <div key={`blank:${index}`} style={square} />;
                    }
                    const count = month.dayCounts[day] ?? 0;
                    const level = shadeLevel(count, month.quartiles);
                    const isToday = day === month.today;
                    return (
                        <FocusTarget key={day} focusKey={`activity:day:${day}`} focusFallback={["activity:prev"]} style={{ minWidth: 0 }}>
                            <DialogButton
                                onClick={() => props.onOpenDay(day)}
                                onGamepadFocus={() => {
                                    setFocusedDay(day);
                                    props.onFocusDay(day);
                                }}
                                onGamepadBlur={() => {
                                    setFocusedDay((current) => (current === day ? null : current));
                                    props.onBlurDay(day);
                                }}
                                style={{
                                    ...shadeStyle(level),
                                    ...(focusedDay === day ? { boxShadow: FOCUS_RING } : null),
                                    ...square,
                                    height: "auto",
                                    minWidth: 0,
                                    padding: 0,
                                    borderRadius: "4px",
                                    fontSize: `${Math.round(cellSize * 0.38)}px`,
                                    fontWeight: isToday ? 800 : 600,
                                    color: level >= 3 ? "#ffffff" : level > 0 ? "#0b1220" : "rgba(255,255,255,0.75)",
                                    outline: isToday ? "2px solid rgba(255,255,255,0.6)" : undefined
                                }}
                            >
                                {Number(day.slice(8))}
                            </DialogButton>
                        </FocusTarget>
                    );
                })}
            </Focusable>
        </div>
    );
}
