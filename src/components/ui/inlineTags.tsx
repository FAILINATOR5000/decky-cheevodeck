import type { ReactNode } from "react";

const TAG_PAIR = /<(b|i)>([\s\S]*?)<\/\1>/;

const TAG_STYLE: Record<string, { fontWeight?: number; fontStyle?: string }> = {
    b: { fontWeight: 700 },
    i: { fontStyle: "italic" },
};

export function withInlineTags(text: string): ReactNode {
    if (!text.includes("<b>") && !text.includes("<i>")) {
        return text;
    }

    const pieces = text.split(TAG_PAIR);
    const out: ReactNode[] = [];

    for (let at = 0; at < pieces.length; at += 3) {
        out.push(pieces[at]);

        const tag = pieces[at + 1];
        if (tag === undefined) {
            break;
        }

        out.push(
            <span key={at} style={TAG_STYLE[tag]}>
                {pieces[at + 2]}
            </span>
        );
    }

    return out;
}
