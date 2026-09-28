import React, { useState } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { t, type LanguageCode } from "../../locales";
import type { EventsListView, EventsShow, EventsSort, EventsType, EventsViewPrefs } from "../../types";
import { eventsShowLabel, eventsSortLabel, eventsTypeLabel } from "../../utils/events";
import { modalSize } from "../../utils/scale";
import { compactButtonStyle } from "../../utils/style";

const SECTION_HEADING_STYLE: React.CSSProperties = {
    fontSize: `${modalSize(15)}px`,
    fontWeight: 700,
    marginTop: "16px",
    marginBottom: "6px"
};

const SHOW_VALUES: Record<EventsListView, EventsShow[]> = {
    all: ["all", "active", "evergreen", "ended", "completed"],
    tracked: ["all", "active", "evergreen", "ended"]
};

const SORT_VALUES: Record<EventsListView, EventsSort[]> = {
    all: ["latest", "activity", "name", "progress"],
    tracked: ["manual", "latest", "activity", "name", "progress"]
};

type EventsFilterModalProps = {
    view: EventsListView;
    prefs: EventsViewPrefs;
    showUnscanned: boolean;
    language: LanguageCode;
    onChange: (change: Partial<EventsViewPrefs>) => void;
    close: () => void;
};

function Chip(props: { label: string; focusKey: string; selected: boolean; preferred?: boolean; onSelect: () => void }) {
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

function ChipRow(props: { children: React.ReactNode }) {
    return (
        <Focusable
            flow-children="grid"
            style={{ display: "flex", flexDirection: "row", gap: "8px", flexWrap: "wrap", alignItems: "center" }}
        >
            {props.children}
        </Focusable>
    );
}

export function EventsFilterModal(props: EventsFilterModalProps) {
    const { view, language, onChange, close } = props;
    const [show, setShow] = useState<EventsShow>(props.prefs.show);
    const [type, setType] = useState<EventsType>(props.prefs.type);
    const [sort, setSort] = useState<EventsSort>(props.prefs.sort);

    const types: EventsType[] = props.showUnscanned || type === "unscanned"
        ? ["all", "automated", "checklist", "spreadsheet", "other", "unscanned"]
        : ["all", "automated", "checklist", "spreadsheet", "other"];

    function pickShow(next: EventsShow) {
        setShow(next);
        onChange({ show: next });
    }

    function pickType(next: EventsType) {
        setType(next);
        onChange({ type: next });
    }

    function pickSort(next: EventsSort) {
        setSort(next);
        onChange({ sort: next });
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SaveOnStart canSave label={t(language, "Close")} onSave={close}>
                <SnapshotHotkey language={language} />
                <div style={{ fontSize: `${modalSize(18)}px`, fontWeight: 800, marginBottom: "4px" }}>
                    {t(language, "Filter & Sort")}
                </div>
                <div style={SECTION_HEADING_STYLE}>{t(language, "Show")}</div>
                <ChipRow>
                    {SHOW_VALUES[view].map((value) => (
                        <Chip
                            key={value}
                            label={eventsShowLabel(value, language)}
                            focusKey={`events:filter:show:${value}`}
                            selected={show === value}
                            preferred={props.prefs.show === value}
                            onSelect={() => pickShow(value)}
                        />
                    ))}
                </ChipRow>
                <div style={SECTION_HEADING_STYLE}>{t(language, "Type")}</div>
                <ChipRow>
                    {types.map((value) => (
                        <Chip
                            key={value}
                            label={eventsTypeLabel(value, language)}
                            focusKey={`events:filter:type:${value}`}
                            selected={type === value}
                            onSelect={() => pickType(value)}
                        />
                    ))}
                </ChipRow>
                <div style={SECTION_HEADING_STYLE}>{t(language, "Sort")}</div>
                <ChipRow>
                    {SORT_VALUES[view].map((value) => (
                        <Chip
                            key={value}
                            label={eventsSortLabel(value, language)}
                            focusKey={`events:filter:sort:${value}`}
                            selected={sort === value}
                            onSelect={() => pickSort(value)}
                        />
                    ))}
                </ChipRow>
                <Focusable style={{ display: "flex", marginTop: "16px" }}>
                    <DialogButton onClick={close} style={{ width: "100%" }}>
                        {t(language, "Close")}
                    </DialogButton>
                </Focusable>
            </SaveOnStart>
        </ModalRoot>
    );
}
