import { DialogButton, Focusable, ModalRoot, ScrollPanelGroup, TextField } from "@decky/ui";
import { useState } from "react";

import { ConfirmRow } from "../ui/ConfirmRow";
import { FocusableItem } from "../ui/FocusableItem";
import { t, type LanguageCode } from "../../locales";
import type { FileWatcherRoot } from "../../types";
import { errorLine } from "../../utils/fileWatcher";
import { modalBodyStyle, warnAmber } from "../../utils/style";
import { modalSize } from "../../utils/scale";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

const EXCLUSION_PRESETS: Array<{ key: string; label: string; blurb: string; patterns: string[] }> = [
    {
        key: "synology",
        label: "Synology share folders",
        blurb: "Folders associated with a Synology share",
        patterns: ["@eaDir", "#recycle"]
    },
    {
        key: "syncthing",
        label: "Syncthing metadata files",
        blurb: "Various files associated with Syncthing",
        patterns: [".stfolder", ".stversions", ".stignore", ".syncthing.*.tmp", "~syncthing~*.tmp"]
    },
    {
        key: "hidden",
        label: "Hidden files and folders",
        blurb: "Anything whose name starts with a dot",
        patterns: [".*"]
    },
    {
        key: "saves",
        label: "Emulator save data",
        blurb: "Saves and save states, which change as you play",
        patterns: ["*.sav", "*.srm", "*.state*"]
    },
    {
        key: "extras",
        label: "Text Files and Images",
        blurb: "Text files and various images",
        patterns: [
            "*.txt", "*.nfo", "*.pdf", "*.url", "*.html", "*.htm",
            "*.jpg", "*.jpeg", "*.png", "*.gif", "*.bmp", "*.webp", "*.avif"
        ]
    },
    {
        key: "partials",
        label: "In-progress downloads",
        blurb: "Part-files a download or torrent hasn't finished",
        patterns: ["*.tmp", "*.part", "*.!qB"]
    }
];

const GUIDE_ENTRIES: Array<{ example: string; explains: string }> = [
    { example: "saves", explains: "Ignores any file or folder named exactly saves, anywhere under this directory, and a folder takes everything inside it with it." },
    { example: "*.sav", explains: "Ignores every file ending in .sav. A star stands for any run of characters." },
    { example: "disc?.bin", explains: "Ignores disc1.bin and disc2.bin, but not disc10.bin. A question mark stands for exactly one character." },
    { example: "disc[12].bin", explains: "Ignores disc1.bin and disc2.bin only. Square brackets are a set, and one character out of it matches." },
    { example: "saturn/*.cue", explains: "Ignores every .cue file under the saturn folder and no others. A rule with a slash is checked against the whole path below this directory, which is how you keep a rule to one console when you watch the whole collection as one directory." },
    { example: "saturn/*", explains: "Ignores everything under saturn. The star crosses slashes, so this reaches all the way down." },
    { example: "@eaDir", explains: "Ignores a folder named @eaDir. Names that begin with a symbol work as they are — nothing here needs escaping." }
];

export type FileWatcherExclusionsModalProps = {
    language: LanguageCode;
    root: FileWatcherRoot;
    locked: boolean;
    mappedFiles: number;
    onSave: (rootId: number, label: string | null, excludes: string[] | null) => Promise<string | null>;
    onForgetHashes: (rootId: number) => Promise<string | null>;
    close: () => void;
};

export function FileWatcherExclusionsModal(props: FileWatcherExclusionsModalProps) {
    const { language, root, locked, close } = props;

    const [label, setLabel] = useState(root.label);
    const [patterns, setPatterns] = useState<string[]>(root.excludes);
    const [draft, setDraft] = useState("");
    const [guideFocused, setGuideFocused] = useState(false);
    const [refused, setRefused] = useState<string | null>(null);

    function presetIsOn(preset: { patterns: string[] }): boolean {
        return preset.patterns.every((pattern) => patterns.includes(pattern));
    }

    const covered = new Set(
        EXCLUSION_PRESETS.filter(presetIsOn).flatMap((preset) => preset.patterns)
    );
    const custom = patterns.filter((pattern) => !covered.has(pattern));

    function togglePreset(preset: { patterns: string[] }) {
        if (presetIsOn(preset)) {
            setPatterns(patterns.filter((pattern) => !preset.patterns.includes(pattern)));
            return;
        }
        setPatterns([...patterns, ...preset.patterns.filter((pattern) => !patterns.includes(pattern))]);
    }

    function addDraft() {
        const trimmed = draft.trim().replace(/^\/+|\/+$/g, "");
        if (!trimmed || patterns.includes(trimmed)) {
            setDraft("");
            return;
        }
        setPatterns([...patterns, trimmed]);
        setDraft("");
    }

    async function handleSave() {
        const refusal = await props.onSave(root.id, label.trim(), patterns);
        if (refusal) {
            setRefused(refusal);
            return;
        }
        close();
    }

    async function handleForget() {
        const refusal = await props.onForgetHashes(root.id);
        if (refusal) {
            setRefused(refusal);
            return;
        }
        close();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <SaveOnStart
                canSave={!locked}
                label={t(language, "Save")}
                onSave={handleSave}
            >
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "4px" }}>
                    {root.label}
                </div>
                <div style={{ ...modalBodyStyle(), wordBreak: "break-all", marginBottom: "12px" }}>
                    {root.path}
                </div>

                {(locked || refused) && (
                    <div style={{ ...modalBodyStyle(), color: warnAmber, opacity: 1, marginBottom: "10px" }}>
                        {t(language, refused
                            ? errorLine(refused)
                            : "Cancel the scan first, then change the directories.")}
                    </div>
                )}

                <div style={{ ...modalBodyStyle(), fontWeight: 700 }}>{t(language, "Name")}</div>
                <TextField
                    value={label}
                    disabled={locked}
                    onChange={(e: any) => setLabel(e?.target?.value ?? "")}
                />

                <div style={{ ...modalBodyStyle(), fontWeight: 700, marginTop: "12px" }}>
                    {t(language, "Ignore")}
                </div>
                {EXCLUSION_PRESETS.map((preset) => (
                    <FocusableItem
                        key={preset.key}
                        focusKey={`filewatcher:exclude:${preset.key}`}
                        disabled={locked}
                        skipWhenDisabled
                        onClick={() => togglePreset(preset)}
                        bottomSeparator="none"
                    >
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px", textAlign: "left" }}>
                            <div>{`${presetIsOn(preset) ? "☑" : "☐"}  ${t(language, preset.label)}`}</div>
                            <div style={{ ...modalBodyStyle(), opacity: 0.75 }}>
                                {t(language, preset.blurb)}
                            </div>
                            <div style={{ ...modalBodyStyle(), opacity: 0.75, wordBreak: "break-word" }}>
                                {preset.patterns.join("  ")}
                            </div>
                        </div>
                    </FocusableItem>
                ))}

                <div style={{ ...modalBodyStyle(), fontWeight: 700, marginTop: "12px" }}>
                    {t(language, "Custom Ignore")}
                </div>
                <div style={modalBodyStyle()}>{t(language, "help_file_watcher_exclusions")}</div>

                <TextField
                    value={draft}
                    disabled={locked}
                    onChange={(e: any) => setDraft(e?.target?.value ?? "")}
                />
                <Focusable style={{ display: "flex", marginTop: "8px" }} flow-children="row">
                    <DialogButton onClick={addDraft} disabled={locked} focusable={!locked}>
                        {t(language, "Add")}
                    </DialogButton>
                </Focusable>

                {custom.map((pattern) => (
                    <FocusableItem
                        key={`custom:${pattern}`}
                        focusKey={`filewatcher:exclude:custom:${pattern}`}
                        disabled={locked}
                        skipWhenDisabled
                        onClick={() => setPatterns(patterns.filter((entry) => entry !== pattern))}
                        bottomSeparator="none"
                    >
                        {`✕  ${pattern}`}
                    </FocusableItem>
                ))}

                {
}
                <div
                    data-focus-key="filewatcher:exclude:guide"
                    style={{
                        maxHeight: "30vh",
                        marginTop: "12px",
                        background: "rgba(255,255,255,0.04)",
                        border: guideFocused ? "1px solid #4a9eff" : "1px solid rgba(255,255,255,0.10)",
                        borderRadius: "6px",
                        boxShadow: guideFocused ? "0 0 0 2px rgba(74,158,255,0.55)" : "none",
                        overflow: "hidden",
                        display: "flex",
                        flexDirection: "column"
                    }}
                >
                    {ScrollPanelGroup ? (
                        <ScrollPanelGroup focusable={false} style={{ flex: 1, minHeight: 0 }}>
                            <Focusable
                                onActivate={() => { }}
                                noFocusRing={true}
                                onGamepadFocus={() => setGuideFocused(true)}
                                onGamepadBlur={() => setGuideFocused(false)}
                            >
                                <GuideBody language={language} />
                            </Focusable>
                        </ScrollPanelGroup>
                    ) : (
                        <div style={{ maxHeight: "30vh", overflowY: "auto" }}>
                            <GuideBody language={language} />
                        </div>
                    )}
                </div>

                <div style={{ ...modalBodyStyle(), fontWeight: 700, marginTop: "12px" }}>
                    {t(language, "{{count}} files hashed", { count: props.mappedFiles })}
                </div>
                <ConfirmRow
                    focusKey="filewatcher:exclude:forget"
                    idleLabel={t(language, "Forget this directory's hashes")}
                    armedLabel={t(language, "Press again — this erases its corruption history")}
                    disabled={locked || props.mappedFiles === 0}
                    skipWhenDisabled
                    bottomSeparator="none"
                    onConfirm={handleForget}
                />

                <Focusable
                    style={{ display: "flex", justifyContent: "flex-start", gap: "8px", marginTop: "16px" }}
                    flow-children="row"
                >
                    <DialogButton onClick={handleSave} disabled={locked} focusable={!locked}>
                        {t(language, "Save")}
                    </DialogButton>
                    <DialogButton onClick={close}>{t(language, "Cancel")}</DialogButton>
                </Focusable>
            </SaveOnStart>
        </ModalRoot>
    );
}

function GuideBody({ language }: { language: LanguageCode }) {
    return (
        <div style={{ ...modalBodyStyle(), padding: "10px 12px", lineHeight: 1.45 }}>
            <div style={{ fontWeight: 700, marginBottom: "6px" }}>
                {t(language, "help_file_watcher_exclusions_guide")}
            </div>
            {GUIDE_ENTRIES.map((entry) => (
                <div key={entry.example} style={{ marginBottom: "8px" }}>
                    <div style={{ fontWeight: 700, wordBreak: "break-word" }}>{entry.example}</div>
                    <div style={{ opacity: 0.85 }}>{t(language, entry.explains)}</div>
                </div>
            ))}
            <div style={{ opacity: 0.85 }}>
                {t(language, "help_file_watcher_exclusions_footer")}
            </div>
        </div>
    );
}
