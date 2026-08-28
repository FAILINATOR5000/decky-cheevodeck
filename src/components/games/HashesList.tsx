import { t, type LanguageCode } from "../../locales";
import { FocusableItem } from "../ui/FocusableItem";
import { bodyTextStyle } from "../../utils/style";
import { getCurrentTextScale, scaleMultiplier } from "../../utils/scale";
import type { GameHashRow } from "../../api";

const KNOWN_LABELS: Record<string, string> = {
    nointro: "NO-INTRO",
    redump: "REDUMP",
    rapatches: "RAPATCHES"
};

function prettyLabel(label: string): string {
    const key = label.trim().toLowerCase();
    return KNOWN_LABELS[key] ?? label.trim().toUpperCase();
}

type HashesListProps = {
    results: GameHashRow[];
    language: LanguageCode;
    downloadingMd5: string | null;
    onDownloadPatch: (row: GameHashRow) => void;
};

export function HashesList(props: HashesListProps) {
    const { results, language, downloadingMd5, onDownloadPatch } = props;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {results.map((row, index) => (
                <FocusableItem
                    key={row.md5 || `hash:${index}`}
                    focusKey={`gameoverview:hash:${row.md5 || index}`}
                    bottomSeparator="none"
                    outerStyle={{ width: "100%", minWidth: 0 }}
                    disabled={Boolean(downloadingMd5) && downloadingMd5 !== row.md5}
                    onClick={row.patchUrl ? () => onDownloadPatch(row) : undefined}
                >
                    <div
                        style={{
                            width: "100%",
                            boxSizing: "border-box",
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                            padding: "8px 10px",
                            borderRadius: "8px",
                            background: "rgba(255,255,255,0.05)",
                            border: "1px solid rgba(255,255,255,0.12)",
                            minWidth: 0
                        }}
                    >
                        {row.name && (
                            <div
                                style={{
                                    fontSize: `${scaleMultiplier(getCurrentTextScale())}em`,
                                    fontWeight: 700,
                                    lineHeight: 1.25,
                                    textAlign: "left",
                                    wordBreak: "break-word"
                                }}
                            >
                                {row.name}
                            </div>
                        )}
                        <div
                            style={{
                                ...bodyTextStyle(),
                                fontFamily: "monospace",
                                textAlign: "left",
                                wordBreak: "break-all"
                            }}
                        >
                            {row.md5}
                        </div>
                        {row.labels.length > 0 && (
                            <div
                                style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: "6px"
                                }}
                            >
                                {row.labels.map((label) => (
                                    <div
                                        key={label}
                                        style={{
                                            fontSize: "11px",
                                            lineHeight: 1,
                                            fontWeight: 800,
                                            padding: "2px 6px",
                                            borderRadius: "8px",
                                            background: "rgba(56, 189, 248, 0.18)",
                                            border: "1px solid rgba(56, 189, 248, 0.45)",
                                            color: "#38bdf8"
                                        }}
                                    >
                                        {prettyLabel(label)}
                                    </div>
                                ))}
                            </div>
                        )}
                        {row.patchUrl && (
                            <div
                                style={{
                                    ...bodyTextStyle(),
                                    color: "#7dd3fc",
                                    fontWeight: 600,
                                    textAlign: "left"
                                }}
                            >
                                {downloadingMd5 === row.md5
                                    ? t(language, "Saving patch...")
                                    : t(language, "Compatibility patch available — press to save")}
                            </div>
                        )}
                    </div>
                </FocusableItem>
            ))}
        </div>
    );
}
