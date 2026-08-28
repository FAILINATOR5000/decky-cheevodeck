import { createContext, useContext, type ReactNode } from "react";
import { saveFileWatcherRunDuringGames, saveFileWatcherSpeed } from "../../api";
import { useFileWatcherController } from "../../hooks/useFileWatcherController";
import type { SettingsController } from "../../hooks/useSettingsController";
import type { LanguageCode } from "../../locales";
import type { FileWatcherSpeed } from "../../types";

type FileWatcher = ReturnType<typeof useFileWatcherController> & {
    settings: ReturnType<typeof fileWatcherSettings>;
};

const FileWatcherContext = createContext<FileWatcher | null>(null);

function fileWatcherSettings(controller: SettingsController) {
    const { state, actions } = controller;
    return {
        speed: state.fileWatcherSpeed,
        runDuringGames: state.fileWatcherRunDuringGames,

        saveSpeed: (nextValue: FileWatcherSpeed) =>
            actions.saveSettingWithRollback<FileWatcherSpeed>({
                nextValue,
                previousValue: state.fileWatcherSpeed,
                applyValue: actions.setFileWatcherSpeed,
                saveCall: saveFileWatcherSpeed,
                getSavedValue: (result, fallbackValue) => result.fileWatcherSpeed ?? fallbackValue,
            }),

        saveRunDuringGames: (nextValue: boolean) =>
            actions.saveSettingWithRollback<boolean>({
                nextValue,
                previousValue: state.fileWatcherRunDuringGames,
                applyValue: actions.setFileWatcherRunDuringGames,
                saveCall: saveFileWatcherRunDuringGames,
                getSavedValue: (result, fallbackValue) => result.fileWatcherRunDuringGames ?? fallbackValue,
            })
    };
}

export function FileWatcherProvider(props: {
    isActive: boolean;
    language: LanguageCode;
    settings: SettingsController;
    children: ReactNode;
}) {
    const watcher = useFileWatcherController({ isActive: props.isActive, language: props.language });
    return (
        <FileWatcherContext.Provider value={{ ...watcher, settings: fileWatcherSettings(props.settings) }}>
            {props.children}
        </FileWatcherContext.Provider>
    );
}

export function useFileWatcher(): FileWatcher {
    return useContext(FileWatcherContext)!;
}
