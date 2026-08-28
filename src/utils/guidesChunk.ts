type BoundaryReason = "section" | "blank" | "hard" | "art-block" | "end";

export type GuideChunk = {
    startLine: number;
    endLine: number;
    text: string;
    reason: BoundaryReason;
};

const TARGET_LINES = 60;
const WINDOW_LINES = 15;
const CHAR_CAP = 4000;
const ORPHAN_RATIO = 0.3;
const MIN_CHUNK_LINES = 12;

const ART_MIN_RUN = 3;
const ART_SYMBOL_RATIO = 0.34;
const ART_SYMBOLS = "|-_=+/\\*#.:~[]<>()";

const DIVIDER_RE = /^\s*([=\-~*_#])\1{7,}\s*$/;
const SECTION_CODE_RE = /^\s*(\[[A-Za-z0-9_.-]{2,10}\]|[IVXLCDM]{1,6}[.)]\s|\d+(\.\d+)*[.)]\s|-=\[.*\]=-)/;

function isBlank(line: string): boolean {
    return line.trim().length === 0;
}

function isDivider(line: string): boolean {
    return DIVIDER_RE.test(line);
}

function symbolRatio(line: string): number {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
        return 0;
    }
    let symbols = 0;
    for (const ch of trimmed) {
        if (ART_SYMBOLS.includes(ch)) {
            symbols += 1;
        }
    }
    return symbols / trimmed.length;
}

function findArtBlocks(lines: string[]): Array<{ start: number; end: number }> {
    const blocks: Array<{ start: number; end: number }> = [];
    let index = 0;
    while (index < lines.length) {
        if (isBlank(lines[index])) {
            index += 1;
            continue;
        }
        let end = index;
        while (end < lines.length && !isBlank(lines[end])) {
            end += 1;
        }
        const runLength = end - index;
        if (runLength >= ART_MIN_RUN) {
            let symbolHeavy = 0;
            let shortest = Number.MAX_SAFE_INTEGER;
            let longest = 0;
            for (let i = index; i < end; i += 1) {
                if (symbolRatio(lines[i]) >= ART_SYMBOL_RATIO) {
                    symbolHeavy += 1;
                }
                const width = lines[i].trimEnd().length;
                shortest = Math.min(shortest, width);
                longest = Math.max(longest, width);
            }
            const mostlySymbols = symbolHeavy / runLength >= 0.5;
            const boxShaped = runLength >= 4 && longest >= 30 && longest - shortest <= 3;
            if (mostlySymbols || boxShaped) {
                blocks.push({ start: index, end });
            }
        }
        index = end;
    }
    return blocks;
}

function findSectionStarts(lines: string[]): Set<number> {
    const starts = new Set<number>();
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (isBlank(line)) {
            continue;
        }
        if (isDivider(line)) {
            const previous = i > 0 ? lines[i - 1] : "";
            const hasTitleAbove = i > 0 && !isBlank(previous) && !isDivider(previous);
            starts.add(hasTitleAbove ? i - 1 : i);
            continue;
        }
        if (SECTION_CODE_RE.test(line) && (i === 0 || isBlank(lines[i - 1]))) {
            starts.add(i);
        }
    }
    return starts;
}

function artBlockAt(blocks: Array<{ start: number; end: number }>, index: number) {
    for (const block of blocks) {
        if (index > block.start && index < block.end) {
            return block;
        }
    }
    return null;
}

export function chunkGuideLines(lines: string[]): GuideChunk[] {
    if (lines.length === 0) {
        return [];
    }
    const artBlocks = findArtBlocks(lines);
    const sectionStarts = findSectionStarts(lines);
    const chunks: GuideChunk[] = [];

    let start = 0;
    while (start < lines.length) {
        let target = Math.min(lines.length, start + TARGET_LINES);
        let chars = 0;
        for (let i = start; i < target; i += 1) {
            chars += lines[i].length + 1;
            if (chars > CHAR_CAP && i - start >= MIN_CHUNK_LINES) {
                target = i + 1;
                break;
            }
        }

        if (lines.length - target < TARGET_LINES * ORPHAN_RATIO) {
            chunks.push(makeChunk(lines, start, lines.length, "end"));
            break;
        }

        const low = Math.max(start + MIN_CHUNK_LINES, target - WINDOW_LINES);
        const high = Math.min(lines.length, target + WINDOW_LINES);

        let boundary = -1;
        let reason: BoundaryReason = "hard";

        let bestDistance = Number.MAX_SAFE_INTEGER;
        for (let i = low; i <= high; i += 1) {
            if (!sectionStarts.has(i)) {
                continue;
            }
            const distance = Math.abs(i - target);
            if (distance < bestDistance) {
                bestDistance = distance;
                boundary = i;
                reason = "section";
            }
        }

        if (boundary < 0) {
            let widest = 0;
            let i = low;
            while (i <= high) {
                if (!isBlank(lines[i])) {
                    i += 1;
                    continue;
                }
                let runEnd = i;
                while (runEnd < lines.length && isBlank(lines[runEnd])) {
                    runEnd += 1;
                }
                const width = runEnd - i;
                const distance = Math.abs(runEnd - target);
                if (width > widest || (width === widest && distance < bestDistance)) {
                    widest = width;
                    bestDistance = distance;
                    boundary = Math.min(runEnd, lines.length);
                    reason = "blank";
                }
                i = runEnd + 1;
            }
        }

        if (boundary < 0) {
            boundary = target;
            reason = "hard";
        }

        const straddled = artBlockAt(artBlocks, boundary);
        if (straddled) {
            boundary = straddled.end;
            reason = "art-block";
        }

        if (boundary <= start) {
            boundary = Math.min(lines.length, start + MIN_CHUNK_LINES);
            reason = "hard";
        }

        chunks.push(makeChunk(lines, start, boundary, reason));
        start = boundary;
    }

    return chunks;
}

function makeChunk(lines: string[], start: number, end: number, reason: BoundaryReason): GuideChunk {
    return {
        startLine: start,
        endLine: end,
        text: lines.slice(start, end).join("\n"),
        reason,
    };
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const CHUNK_BLOCK_CLASS = "cheevo-guide-lines";

export function chunkAnchorHtml(chunks: GuideChunk[]): string {
    return chunks
        .map((chunk, index) => {
            const span = chunk.endLine - chunk.startLine;
            const separator = index < chunks.length - 1 ? "\n" : "";
            return `<div class="${CHUNK_BLOCK_CLASS}" data-guide-line="${chunk.startLine}"`
                + ` data-guide-lines="${span}">${escapeHtml(chunk.text)}${separator}</div>`;
        })
        .join("");
}

export function findChunkForLine(chunks: GuideChunk[], lineIndex: number): number {
    if (chunks.length === 0) {
        return 0;
    }
    for (let i = 0; i < chunks.length; i += 1) {
        if (lineIndex < chunks[i].endLine) {
            return i;
        }
    }
    return chunks.length - 1;
}

export function fractionWithinChunk(chunk: GuideChunk, lineIndex: number): number {
    const span = chunk.endLine - chunk.startLine;
    if (span <= 0) {
        return 0;
    }
    const offset = lineIndex - chunk.startLine;
    return Math.min(1, Math.max(0, offset / span));
}

export type GuideSpot = "top" | "center" | "bottom";

export function spotTarget(chunks: GuideChunk[], spot: GuideSpot): { line: number; into: number } {
    const start = chunks.length > 0 ? chunks[0].startLine : 0;
    const end = chunks.length > 0 ? chunks[chunks.length - 1].endLine : 0;
    if (spot === "top") {
        return { line: start, into: 0 };
    }
    if (spot === "bottom") {
        return { line: Math.max(start, end - 1), into: 1 };
    }
    return { line: start + Math.floor(Math.max(0, end - start) / 2), into: 0 };
}
