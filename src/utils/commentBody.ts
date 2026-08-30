export const BODY_LINE_CLAMP = 12;

const CARD_ROW_PX = 220;

const CHAR_WIDTH_RATIO = 0.52;

export function commentBodyColumnPx(leftPx: number, insetPx: number): number {
    return Math.max(120, CARD_ROW_PX - leftPx - insetPx);
}

export type CommentBodyPreview = {
    text: string;
    truncated: boolean;
};

export function commentBodyPreview(body: string, fontSize: number, columnPx: number): CommentBodyPreview {
    const perLine = Math.max(16, Math.round(columnPx / Math.max(1, fontSize * CHAR_WIDTH_RATIO)));
    const kept: string[] = [];
    let usedLines = 0;

    for (const line of body.split("\n")) {
        if (usedLines >= BODY_LINE_CLAMP) {
            return cutTo(kept);
        }

        const breaks = wrapBreaks(line, perLine);
        if (usedLines + breaks.length <= BODY_LINE_CLAMP) {
            kept.push(line);
            usedLines += breaks.length;
            continue;
        }

        kept.push(line.slice(0, breaks[BODY_LINE_CLAMP - usedLines - 1]));
        return cutTo(kept);
    }

    return { text: body, truncated: false };
}

function wrapBreaks(line: string, perLine: number): number[] {
    const breaks: number[] = [];
    let lineStart = 0;
    let pos = 0;

    for (const word of line.split(" ")) {
        const end = pos + word.length;
        if (end - lineStart > perLine && pos > lineStart) {
            breaks.push(pos - 1);
            lineStart = pos;
        }

        while (end - lineStart > perLine) {
            breaks.push(lineStart + perLine);
            lineStart += perLine;
        }

        pos = end + 1;
    }

    breaks.push(line.length);
    return breaks;
}

function cutTo(kept: string[]): CommentBodyPreview {
    return { text: `${kept.join("\n").trimEnd()}…`, truncated: true };
}
