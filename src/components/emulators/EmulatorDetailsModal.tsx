import { DialogButton, Focusable, ModalRoot } from "@decky/ui";

import type { EmulatorAppImage, EmulatorBackup, EmulatorEntry, EmulatorFlatpak, RetroArchCore } from "../../api";
import { deleteOldCopy, forgetEmulatorPath, restoreOldCopy } from "../../hooks/useEmulatorsController";
import { sizeText } from "./CleanUpModal";
import { t, type LanguageCode } from "../../locales";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { smallTextStyle } from "../../utils/style";
import { FocusTarget } from "../ui/FocusTarget";

export type EmulatorDetails =
    | { type: "core"; core: RetroArchCore; coresDir: string; systems: string[] }
    | { type: "retroarch"; name: string; flatpak: EmulatorFlatpak; coresDir: string; found: boolean }
    | { type: "flatpak"; emulator: EmulatorEntry }
    | { type: "appimage"; emulator: EmulatorEntry; image: EmulatorAppImage }
    | { type: "offer"; emulator: EmulatorEntry; appsDir: string };

const HOW_FOUND: Record<EmulatorAppImage["howFound"], string> = {
    pointed: "You pointed to it.",
    updInfo: "Its update info names its project.",
    launcher: "A launcher uses it.",
    name: "Its file name."
};

type DetailLine = { label: string; value: string };

function joinPath(folder: string, name: string): string {
    return folder.endsWith("/") ? folder + name : `${folder}/${name}`;
}

function latestLine(language: LanguageCode, latest: string): DetailLine[] {
    return latest ? [{ label: t(language, "Latest stable"), value: latest }] : [];
}

function flatpakLines(language: LanguageCode, flatpak: EmulatorFlatpak): DetailLine[] {
    if (!flatpak.installed) {
        return [
            { label: t(language, "Source"), value: "Flathub" },
            { label: "Flatpak", value: t(language, "Not installed") },
            ...latestLine(language, flatpak.latest)
        ];
    }
    return [
        { label: t(language, "Version"), value: flatpak.version || "?" },
        ...latestLine(language, flatpak.latest),
        { label: t(language, "Source"), value: "Flathub" },
        { label: "Flatpak", value: `${flatpak.id} (${flatpak.scope})` }
    ];
}

function detailLines(language: LanguageCode, details: EmulatorDetails): { title: string; lines: DetailLine[]; note: string } {
    if (details.type === "core") {
        const { core } = details;
        return {
            title: core.name,
            lines: [
                { label: t(language, "Version"), value: core.version || "?" },
                { label: t(language, "File"), value: joinPath(details.coresDir, `${core.core}_libretro.so`) },
                { label: t(language, "Runs"), value: details.systems.join(", ") }
            ],
            note: core.installed
                ? core.ours ? t(language, "CheevoDeck installed this.") : t(language, "CheevoDeck didn't install this.")
                : t(language, "Not installed")
        };
    }
    if (details.type === "retroarch") {
        return {
            title: details.name,
            lines: [
                ...flatpakLines(language, details.flatpak),
                ...(details.coresDir ? [{ label: t(language, "Cores folder"), value: details.coresDir }] : [])
            ],
            note: details.found ? "" : t(language, "Not found")
        };
    }
    if (details.type === "flatpak") {
        return { title: details.emulator.name, lines: flatpakLines(language, details.emulator.flatpak), note: "" };
    }
    if (details.type === "offer") {
        return {
            title: details.emulator.name,
            lines: [
                { label: t(language, "Source"), value: "GitHub" },
                { label: t(language, "File"), value: joinPath(details.appsDir, details.emulator.fileName) }
            ],
            note: t(language, "AppImage · Not installed")
        };
    }
    const { image } = details;
    return {
        title: details.emulator.name,
        lines: [
            { label: t(language, "Version"), value: image.version || "?" },
            ...latestLine(language, image.latest),
            { label: t(language, "File"), value: image.path },
            { label: t(language, "Source"), value: image.repo || "?" },
            { label: t(language, "How it was found"), value: t(language, HOW_FOUND[image.howFound]) }
        ],
        note: image.missing
            ? t(language, "This file isn't there anymore.")
            : image.ours ? t(language, "CheevoDeck installed this.") : ""
    };
}

function EmulatorDetailsModal(props: { language: LanguageCode; details: EmulatorDetails; close: () => void }) {
    const { language, details, close } = props;
    const { title, lines, note } = detailLines(language, details);
    const forgettable = details.type === "appimage" && details.image.howFound === "pointed" ? details : null;
    let old: { backup: EmulatorBackup; target: string; name: string } | null = null;
    if (details.type === "appimage" && details.image.backup) {
        old = { backup: details.image.backup, target: details.image.path, name: details.emulator.name };
    }
    else if (details.type === "core" && details.core.backup) {
        old = { backup: details.core.backup, target: joinPath(details.coresDir, `${details.core.core}_libretro.so`), name: "" };
    }

    function forget() {
        if (forgettable !== null) {
            void forgetEmulatorPath(forgettable.emulator.kind, forgettable.image.path);
        }
        close();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>{title}</div>
            {lines.map((line) => (
                <div key={line.label} style={{ display: "flex", gap: "12px", marginBottom: "6px", fontSize: `${modalSize(15)}px` }}>
                    <div style={{ flex: "0 0 30%", opacity: 0.7 }}>{line.label}</div>
                    <div style={{ flex: 1, minWidth: 0, wordBreak: "break-all" }}>{line.value}</div>
                </div>
            ))}
            {note && <div style={{ ...smallTextStyle(), marginTop: "8px" }}>{note}</div>}
            {old !== null && (
                <Focusable style={{ display: "flex", gap: "8px", marginTop: "16px" }} flow-children="row">
                    <FocusTarget focusKey="emulators:details:restore">
                        <DialogButton onClick={() => { void restoreOldCopy(old.target, old.name); close(); }}>
                            {old.backup.version
                                ? t(language, "Restore {{version}}", { version: old.backup.version })
                                : t(language, "Restore Previous")}
                        </DialogButton>
                    </FocusTarget>
                    <FocusTarget focusKey="emulators:details:delete-old">
                        <DialogButton onClick={() => {
                            const path = old.backup.path;
                            close();
                            void deleteOldCopy(path, path.slice(path.lastIndexOf("/") + 1), old.backup.size);
                        }}>
                            {t(language, "Delete old copy ({{size}})", { size: sizeText(old.backup.size) })}
                        </DialogButton>
                    </FocusTarget>
                </Focusable>
            )}
            <Focusable style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }} flow-children="row">
                {forgettable !== null && (
                    <FocusTarget focusKey="emulators:details:forget">
                        <DialogButton onClick={forget}>{t(language, "Forget")}</DialogButton>
                    </FocusTarget>
                )}
                <FocusTarget focusKey="emulators:details:close">
                    <DialogButton autoFocus onClick={close}>{t(language, "Close")}</DialogButton>
                </FocusTarget>
            </Focusable>
        </ModalRoot>
    );
}

export function openEmulatorDetails(language: LanguageCode, details: EmulatorDetails) {
    showManagedModal((close) => <EmulatorDetailsModal language={language} details={details} close={close} />);
}
