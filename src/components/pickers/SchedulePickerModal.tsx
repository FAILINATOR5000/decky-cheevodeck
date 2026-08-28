import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useState } from "react";

import { FocusableItem } from "../ui/FocusableItem";
import { t, type LanguageCode } from "../../locales";
import type { FileWatcherSchedule, FileWatcherWindow } from "../../types";
import {
    EVERY_WEEKS_OPTIONS,
    clockLabel,
    everyWeeksLabel,
    scheduleIsBlacked,
    weekdayLabel
} from "../../utils/fileWatcher";
import { modalBodyStyle } from "../../utils/style";
import { modalSize } from "../../utils/scale";
import { warnAmber } from "../../utils/style";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

const MINUTE_STEP = 5;

function pad(value: number): string {
    return String(value).padStart(2, "0");
}

export type SchedulePickerModalProps = {
    language: LanguageCode;
    schedule: FileWatcherSchedule;
    window: FileWatcherWindow;
    onSaveSchedule: (enabled: boolean, everyWeeks: number, weekday: number, hour: number, minute: number) => void | Promise<void>;
    onSaveWindow: (enabled: boolean, blockFrom: [number, number], blockTo: [number, number]) => void | Promise<void>;
    close: () => void;
};

export function SchedulePickerModal(props: SchedulePickerModalProps) {
    const { language, close } = props;

    const [enabled, setEnabled] = useState(props.schedule.enabled);
    const [everyWeeks, setEveryWeeks] = useState(props.schedule.everyWeeks);
    const [weekday, setWeekday] = useState(props.schedule.weekday);
    const [hour, setHour] = useState(props.schedule.hour);
    const [minute, setMinute] = useState(props.schedule.minute);

    const [windowEnabled, setWindowEnabled] = useState(props.window.enabled);
    const [blockFrom, setBlockFrom] = useState<[number, number]>(props.window.blockFrom);
    const [blockTo, setBlockTo] = useState<[number, number]>(props.window.blockTo);

    const draftSchedule: FileWatcherSchedule = {
        ...props.schedule, enabled, everyWeeks, weekday, hour, minute
    };
    const draftWindow: FileWatcherWindow = { enabled: windowEnabled, blockFrom, blockTo };
    const clashes = scheduleIsBlacked(draftSchedule, draftWindow);

    function cycleEveryWeeks() {
        const index = EVERY_WEEKS_OPTIONS.indexOf(everyWeeks);
        setEveryWeeks(EVERY_WEEKS_OPTIONS[(index + 1) % EVERY_WEEKS_OPTIONS.length]);
    }

    function bumpClock(current: [number, number], part: "hour" | "minute"): [number, number] {
        if (part === "hour") {
            return [(current[0] + 1) % 24, current[1]];
        }
        return [current[0], (current[1] + MINUTE_STEP) % 60];
    }

    async function handleSave() {
        await props.onSaveSchedule(enabled, everyWeeks, weekday, hour, minute);
        await props.onSaveWindow(windowEnabled, blockFrom, blockTo);
        close();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <SaveOnStart
                canSave
                label={t(language, "Save")}
                onSave={handleSave}
            >
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                    {t(language, "Schedule")}
                </div>

                <FocusableItem
                    focusKey="fileWatcher:schedule:enabled"
                    onClick={() => setEnabled(!enabled)}
                    bottomSeparator="none"
                >
                    {t(language, enabled ? "Scheduled Scans: On" : "Scheduled Scans: Off")}
                </FocusableItem>

                <FocusableItem
                    focusKey="fileWatcher:schedule:every"
                    disabled={!enabled}
                    skipWhenDisabled
                    onClick={cycleEveryWeeks}
                    bottomSeparator="none"
                >
                    {everyWeeksLabel(everyWeeks, language)}
                </FocusableItem>

                <FocusableItem
                    focusKey="fileWatcher:schedule:weekday"
                    disabled={!enabled}
                    skipWhenDisabled
                    onClick={() => setWeekday((weekday + 1) % 7)}
                    bottomSeparator="none"
                >
                    {`${t(language, "Day")}: ${weekdayLabel(weekday, language)}`}
                </FocusableItem>

                <Focusable style={{ display: "flex", gap: "8px" }} flow-children="row">
                    <FocusableItem
                        focusKey="fileWatcher:schedule:hour"
                        disabled={!enabled}
                        skipWhenDisabled
                        onClick={() => setHour((hour + 1) % 24)}
                        outerStyle={{ flex: 1 }}
                        bottomSeparator="none"
                    >
                        {`${t(language, "Hour")}: ${pad(hour)}`}
                    </FocusableItem>
                    <FocusableItem
                        focusKey="fileWatcher:schedule:minute"
                        disabled={!enabled}
                        skipWhenDisabled
                        onClick={() => setMinute((minute + MINUTE_STEP) % 60)}
                        outerStyle={{ flex: 1 }}
                        bottomSeparator="none"
                    >
                        {`${t(language, "Minutes")}: ${pad(minute)}`}
                    </FocusableItem>
                </Focusable>

                <div style={{ ...modalBodyStyle(), marginTop: "12px", fontWeight: 700 }}>
                    {t(language, "Activity Window")}
                </div>
                <div style={modalBodyStyle()}>
                    {t(language, "help_file_watcher_window")}
                </div>

                <FocusableItem
                    focusKey="fileWatcher:schedule:windowEnabled"
                    onClick={() => setWindowEnabled(!windowEnabled)}
                    bottomSeparator="none"
                >
                    {t(language, windowEnabled ? "Activity Window: On" : "Activity Window: Off")}
                </FocusableItem>

                <Focusable style={{ display: "flex", gap: "8px" }} flow-children="row">
                    <FocusableItem
                        focusKey="fileWatcher:schedule:blockFromHour"
                        disabled={!windowEnabled}
                        skipWhenDisabled
                        onClick={() => setBlockFrom(bumpClock(blockFrom, "hour"))}
                        outerStyle={{ flex: 1 }}
                        bottomSeparator="none"
                    >
                        {`${t(language, "From Hour")}: ${pad(blockFrom[0])}`}
                    </FocusableItem>
                    <FocusableItem
                        focusKey="fileWatcher:schedule:blockFromMinute"
                        disabled={!windowEnabled}
                        skipWhenDisabled
                        onClick={() => setBlockFrom(bumpClock(blockFrom, "minute"))}
                        outerStyle={{ flex: 1 }}
                        bottomSeparator="none"
                    >
                        {`${t(language, "Minutes")}: ${pad(blockFrom[1])}`}
                    </FocusableItem>
                </Focusable>

                <Focusable style={{ display: "flex", gap: "8px" }} flow-children="row">
                    <FocusableItem
                        focusKey="fileWatcher:schedule:blockToHour"
                        disabled={!windowEnabled}
                        skipWhenDisabled
                        onClick={() => setBlockTo(bumpClock(blockTo, "hour"))}
                        outerStyle={{ flex: 1 }}
                        bottomSeparator="none"
                    >
                        {`${t(language, "To Hour")}: ${pad(blockTo[0])}`}
                    </FocusableItem>
                    <FocusableItem
                        focusKey="fileWatcher:schedule:blockToMinute"
                        disabled={!windowEnabled}
                        skipWhenDisabled
                        onClick={() => setBlockTo(bumpClock(blockTo, "minute"))}
                        outerStyle={{ flex: 1 }}
                        bottomSeparator="none"
                    >
                        {`${t(language, "Minutes")}: ${pad(blockTo[1])}`}
                    </FocusableItem>
                </Focusable>

                {clashes && (
                    <div style={{ ...modalBodyStyle(), color: warnAmber, opacity: 1, marginTop: "10px" }}>
                        {t(language, "{{start}} is inside your activity window ({{from}}–{{to}}). The scan will wait until {{to}} to start.", {
                            start: clockLabel(hour, minute),
                            from: clockLabel(blockFrom[0], blockFrom[1]),
                            to: clockLabel(blockTo[0], blockTo[1])
                        })}
                    </div>
                )}

                <Focusable
                    style={{ display: "flex", justifyContent: "flex-start", gap: "8px", marginTop: "16px" }}
                    flow-children="row"
                >
                    <DialogButton onClick={handleSave}>{t(language, "Save")}</DialogButton>
                    <DialogButton onClick={close}>{t(language, "Cancel")}</DialogButton>
                </Focusable>
            </SaveOnStart>
        </ModalRoot>
    );
}
