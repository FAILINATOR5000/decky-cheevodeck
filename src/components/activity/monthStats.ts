import type { ActivityMonth, ActivityRow } from "../../types";

export type MonthStats = {
    activeDays: number;
    totalDays: number;
    longestStreak: number;
    bestDay: string;
    bestDayCount: number;
    topGame: ActivityRow;
    topGameCount: number;
    hardcorePoints: number;
    softcorePoints: number;
};

type GameTally = {
    row: ActivityRow;
    count: number;
    points: number;
    firstTs: number;
};

function daysInMonth(month: string): number {
    const [year, monthNumber] = month.split("-").map(Number);
    return new Date(year, monthNumber, 0).getDate();
}

export function monthStats(month: ActivityMonth): MonthStats | null {
    if (month.rows.length === 0) {
        return null;
    }

    const length = daysInMonth(month.month);
    let activeDays = 0;
    let run = 0;
    let longestStreak = 0;
    let bestDay = "";
    let bestDayCount = 0;
    for (let date = 1; date <= length; date += 1) {
        const day = `${month.month}-${String(date).padStart(2, "0")}`;
        const count = month.dayCounts[day] ?? 0;
        if (count > 0) {
            activeDays += 1;
            run += 1;
            longestStreak = Math.max(longestStreak, run);
        }
        else {
            run = 0;
        }
        if (count > bestDayCount) {
            bestDay = day;
            bestDayCount = count;
        }
    }
    if (bestDayCount === 0) {
        return null;
    }

    const unique = new Map<number, ActivityRow>();
    for (const row of month.rows) {
        const seen = unique.get(row.achievementId);
        if (!seen || (row.hardcore && !seen.hardcore)) {
            unique.set(row.achievementId, row);
        }
    }

    let hardcorePoints = 0;
    let softcorePoints = 0;
    const games = new Map<number, GameTally>();
    for (const row of unique.values()) {
        const points = Number(row.points) || 0;
        if (row.hardcore) {
            hardcorePoints += points;
        }
        else {
            softcorePoints += points;
        }
        const tally = games.get(row.gameId);
        if (tally) {
            tally.count += 1;
            tally.points += points;
            tally.firstTs = Math.min(tally.firstTs, row.ts);
        }
        else {
            games.set(row.gameId, { row, count: 1, points, firstTs: row.ts });
        }
    }

    let top: GameTally | null = null;
    for (const tally of games.values()) {
        if (
            top === null
            || tally.count > top.count
            || (tally.count === top.count && tally.points > top.points)
            || (tally.count === top.count && tally.points === top.points && tally.firstTs < top.firstTs)
        ) {
            top = tally;
        }
    }
    if (top === null) {
        return null;
    }

    return {
        activeDays,
        totalDays: month.month === month.currentMonth ? Number(month.today.slice(8, 10)) : length,
        longestStreak,
        bestDay,
        bestDayCount,
        topGame: top.row,
        topGameCount: top.count,
        hardcorePoints,
        softcorePoints
    };
}
