import React, { useState } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";

import { t, type LanguageCode } from "../../locales";
import type { MultiplayerAccess, MultiplayerRoomFilter, MultiplayerRoomRow } from "../../types";
import { NO_ROOM_FILTER } from "../../utils/multiplayerChoices";
import { modalSize } from "../../utils/scale";
import { compactButtonStyle } from "../../utils/style";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { ROOM_ACCESS, RoomAccessLabel, roomAccess } from "./roomAccess";

const SECTION_HEADING_STYLE: React.CSSProperties = {
    fontSize: `${modalSize(15)}px`,
    fontWeight: 700,
    marginTop: "16px",
    marginBottom: "6px"
};

type Section = {
    key: keyof MultiplayerRoomFilter;
    headingKey: string;
    choices: { value: string; labelKey: string }[];
};

const SECTIONS: Section[] = [
    { key: "game", headingKey: "Game", choices: [{ value: "mine", labelKey: "My Games" }] },
    { key: "mode", headingKey: "Mode", choices: [{ value: "link", labelKey: "Link Play" }, { value: "couch", labelKey: "Couch Play" },
        { value: "stream", labelKey: "Stream Play" }] },
    { key: "kind", headingKey: "Room", choices: [{ value: "play", labelKey: "Play" }, { value: "watch", labelKey: "Watch Only" }] },
    { key: "access", headingKey: "Who Can Join", choices: ROOM_ACCESS.map((entry) => ({ value: entry.code, labelKey: entry.labelKey })) },
    { key: "where", headingKey: "Where", choices: [{ value: "local", labelKey: "Local" }, { value: "online", labelKey: "Online" }] },
    { key: "seats", headingKey: "Seats", choices: [{ value: "open", labelKey: "Open seats" }] }
];

export function roomPasses(row: MultiplayerRoomRow, filter: MultiplayerRoomFilter): boolean {
    return (
        (filter.game !== "mine" || row.mine === true)
        && (!filter.mode || row.mode === filter.mode)
        && (!filter.kind || row.watch === (filter.kind === "watch"))
        && (!filter.access || roomAccess(row) === filter.access)
        && (!filter.where || row.where === filter.where)
        && (filter.seats !== "open" || row.seats.filter(Boolean).length < row.max)
    );
}

export function roomFilterLabel(filter: MultiplayerRoomFilter, language: LanguageCode): string {
    const picked = SECTIONS.flatMap((section) => section.choices
        .filter((choice) => filter[section.key] === choice.value)
        .map((choice) => t(language, choice.labelKey)));
    return picked.length > 0 ? picked.join(" · ") : t(language, "All");
}

function Chip(props: { label: React.ReactNode; focusKey: string; selected: boolean; preferred?: boolean; onSelect: () => void }) {
    return (
        <div data-focus-key={props.focusKey}>
            <DialogButton
                onClick={props.onSelect}
                autoFocus={props.preferred || undefined}
                style={{
                    ...compactButtonStyle,
                    fontSize: `${modalSize(14)}px`,
                    fontWeight: props.selected ? 800 : 500,
                    outline: props.selected ? "1px solid rgba(255,255,255,0.65)" : undefined
                }}
            >
                {props.label}
            </DialogButton>
        </div>
    );
}

type RoomsFilterModalProps = {
    filter: MultiplayerRoomFilter;
    language: LanguageCode;
    onChange: (filter: MultiplayerRoomFilter) => void;
    close: () => void;
};

export function RoomsFilterModal(props: RoomsFilterModalProps) {
    const { language, onChange, close } = props;
    const [filter, setFilter] = useState(props.filter);

    function pick(next: MultiplayerRoomFilter) {
        setFilter(next);
        onChange(next);
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SaveOnStart canSave label={t(language, "Close")} onSave={close}>
                <SnapshotHotkey language={language} />
                <div style={{ fontSize: `${modalSize(18)}px`, fontWeight: 800, marginBottom: "4px" }}>
                    {t(language, "Filter")}
                </div>
                {SECTIONS.map((section, index) => (
                    <React.Fragment key={section.key}>
                        <div style={SECTION_HEADING_STYLE}>{t(language, section.headingKey)}</div>
                        <Focusable
                            flow-children="grid"
                            style={{ display: "flex", flexDirection: "row", gap: "8px", flexWrap: "wrap", alignItems: "center" }}
                        >
                            {[{ value: "", labelKey: "All" }, ...section.choices].map((choice) => (
                                <Chip
                                    key={choice.value || "all"}
                                    label={section.key === "access" && choice.value
                                        ? <RoomAccessLabel access={choice.value as MultiplayerAccess} language={language} />
                                        : t(language, choice.labelKey)}
                                    focusKey={`multiplayer:roomfilter:${section.key}:${choice.value || "all"}`}
                                    selected={filter[section.key] === choice.value}
                                    preferred={index === 0 && filter[section.key] === choice.value}
                                    onSelect={() => pick({ ...filter, [section.key]: choice.value } as MultiplayerRoomFilter)}
                                />
                            ))}
                        </Focusable>
                    </React.Fragment>
                ))}
                <Focusable style={{ display: "flex", marginTop: "16px" }}>
                    <div data-focus-key="multiplayer:roomfilter:reset" style={{ width: "100%" }}>
                        <DialogButton onClick={() => pick(NO_ROOM_FILTER)} style={{ width: "100%" }}>
                            {t(language, "Reset Filter")}
                        </DialogButton>
                    </div>
                </Focusable>
                <Focusable style={{ display: "flex", marginTop: "8px" }}>
                    <div data-focus-key="multiplayer:roomfilter:close" style={{ width: "100%" }}>
                        <DialogButton onClick={close} style={{ width: "100%" }}>
                            {t(language, "Close")}
                        </DialogButton>
                    </div>
                </Focusable>
            </SaveOnStart>
        </ModalRoot>
    );
}
