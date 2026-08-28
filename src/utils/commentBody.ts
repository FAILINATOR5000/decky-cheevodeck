export const BODY_LINE_CLAMP = 12;

const BODY_COLUMN_PX = 250;

const CHAR_WIDTH_RATIO = 0.52;

export type CommentBodyPreview = {
    text: string;
    truncated: boolean;
};

export function commentBodyPreview(body: string, fontSize: number): CommentBodyPreview {
    const perLine = Math.max(16, Math.round(BODY_COLUMN_PX / Math.max(1, fontSize * CHAR_WIDTH_RATIO)));
    const kept: string[] = [];
    let usedLines = 0;

    for (const line of body.split("\n")) {
        if (usedLines >= BODY_LINE_CLAMP) {
            return cutTo(kept);
        }

        const cost = Math.max(1, Math.ceil(line.length / perLine));
        if (usedLines + cost <= BODY_LINE_CLAMP) {
            kept.push(line);
            usedLines += cost;
            continue;
        }

        kept.push(line.slice(0, (BODY_LINE_CLAMP - usedLines) * perLine));
        return cutTo(kept);
    }

    return { text: body, truncated: false };
}

function cutTo(kept: string[]): CommentBodyPreview {
    return { text: `${kept.join("\n").trimEnd()}…`, truncated: true };
}
