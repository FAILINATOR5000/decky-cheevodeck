import { useRef } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useWindowedList } from "../../hooks/useWindowedList";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { t, type LanguageCode } from "../../locales";
import { modalSize } from "../../utils/scale";
import { compactButtonStyle } from "../../utils/style";
import { unusedTagSeeds, type TagSeed } from "../../utils/tags";

const TAGS_INITIAL_ROWS = 40;
const TAGS_ROW_STEP = 60;
const TAGS_SENTINEL_ROOT_MARGIN = "300px";

export type TagPickerModalProps = {
    tags: string[];
    seeds: ReadonlyArray<TagSeed>;
    selected: string;
    language: LanguageCode;
    focusPrefix: string;
    onSelect: (tag: string) => void;
    close: () => void;
};

function TagChip(props: {
    label: string;
    focusKey: string;
    selected: boolean;
    preferred: boolean;
    onSelect: () => void;
    onFocus?: () => void;
}) {
    const { label, focusKey, selected, preferred, onSelect, onFocus } = props;
    return (
        <div data-focus-key={focusKey}>
            <DialogButton
                onClick={onSelect}
                onGamepadFocus={onFocus}
                autoFocus={preferred || undefined}
                style={{
                    ...compactButtonStyle,
                    fontSize: `${modalSize(14)}px`,
                    fontWeight: selected ? 800 : 500,
                    outline: selected ? "2px solid rgba(120, 200, 255, 0.85)" : undefined
                }}
            >
                {label}
            </DialogButton>
        </div>
    );
}

function SectionLabel(props: { text: string }) {
    return (
        <div style={{ fontSize: `${modalSize(13)}px`, opacity: 0.8, marginBottom: "6px" }}>
            {props.text}
        </div>
    );
}

export function TagPickerModal(props: TagPickerModalProps) {
    const { tags, seeds: allSeeds, selected, language, focusPrefix, onSelect, close } = props;

    const { mountedItems: visibleTags, markerRef, onItemFocus } = useWindowedList({
        items: tags,
        dynamicLoading: true,
        initialRows: TAGS_INITIAL_ROWS,
        rowStep: TAGS_ROW_STEP,
        prefetchDistance: 8,
        sentinelRootMargin: TAGS_SENTINEL_ROOT_MARGIN,
        resetKey: "tagpicker:alltags"
    });

    const focusRef = useRef(onItemFocus);
    focusRef.current = onItemFocus;

    const seeds = unusedTagSeeds(allSeeds, tags);

    const preferredTag = visibleTags.includes(selected)
        ? selected
        : (visibleTags[0] ?? "");
    const preferredSeed = preferredTag ? "" : (seeds[0]?.tag ?? "");

    function pick(tag: string) {
        onSelect(tag);
        close();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <div style={{ fontSize: `${modalSize(18)}px`, fontWeight: 800, marginBottom: "12px" }}>
                {t(language, "All Tags")}
            </div>

            {tags.length > 0 && (
                <div style={{ marginBottom: "14px" }}>
                    <SectionLabel text={t(language, "Latest Tags")} />
                    <Focusable
                        flow-children="grid"
                        style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}
                    >
                        {visibleTags.map((tag, index) => (
                            <TagChip
                                key={tag}
                                label={tag}
                                focusKey={`${focusPrefix}:alltag:${tag}`}
                                selected={tag === selected}
                                preferred={tag === preferredTag}
                                onSelect={() => pick(tag)}
                                onFocus={() => focusRef.current(index)}
                            />
                        ))}
                        {visibleTags.length < tags.length && (
                            <div ref={markerRef} style={{ width: "1px", height: "1px" }} />
                        )}
                    </Focusable>
                </div>
            )}

            {seeds.length > 0 && (
                <div>
                    <SectionLabel text={t(language, "Suggestions")} />
                    <Focusable
                        flow-children="grid"
                        style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}
                    >
                        {seeds.map((seed) => (
                            <TagChip
                                key={seed.key}
                                label={t(language, seed.key)}
                                focusKey={`${focusPrefix}:seedtag:${seed.tag}`}
                                selected={seed.tag === selected}
                                preferred={seed.tag === preferredSeed}
                                onSelect={() => pick(seed.tag)}
                            />
                        ))}
                    </Focusable>
                </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "14px" }}>
                <Focusable flow-children="row" style={{ display: "flex", gap: "8px" }}>
                    <DialogButton onClick={close}>{t(language, "Cancel")}</DialogButton>
                </Focusable>
            </div>
        </ModalRoot>
    );
}
