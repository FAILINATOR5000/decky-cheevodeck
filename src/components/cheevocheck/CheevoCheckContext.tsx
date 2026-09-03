import { createContext, useContext, type ReactNode } from "react";
import {
    saveCheevoCheckCacheHashes,
    saveCheevoCheckExtractToRam,
    saveCheevoCheckOptionsCollapsed,
    saveCheevoCheckResultsCollapsed,
    saveCheevoCheckScanCollapsed,
    saveCheevoCheckSkipCartVerify,
    saveCheevoCheckSkipDiscVerify,
    saveCheevoCheckVerifyCollapsed,
    saveCheevoCheckVerifyHashes,
    saveCheevoCheckVerifySpeed,
    saveLibraryBadge
} from "../../api";
import { useCheevoCheckController } from "../../hooks/useCheevoCheckController";
import type { SettingsController } from "../../hooks/useSettingsController";
import type { LanguageCode } from "../../locales";
import type { CheevoCheckVerifySpeed } from "../../types";
import { applyLibraryBadge } from "../library/libraryBadgePatch";

type CheevoCheck = ReturnType<typeof useCheevoCheckController> & {
    settings: ReturnType<typeof cheevoCheckSettings>;
};

const CheevoCheckContext = createContext<CheevoCheck | null>(null);

function cheevoCheckSettings(controller: SettingsController) {
    const { state, actions } = controller;
    return {
        cacheHashes: state.cheevoCheckCacheHashes,
        extractToRam: state.cheevoCheckExtractToRam,
        verifyHashes: state.cheevoCheckVerifyHashes,
        verifySpeed: state.cheevoCheckVerifySpeed,
        scanCollapsed: state.cheevoCheckScanCollapsed,
        resultsCollapsed: state.cheevoCheckResultsCollapsed,
        verifyCollapsed: state.cheevoCheckVerifyCollapsed,
        optionsCollapsed: state.cheevoCheckOptionsCollapsed,
        skipDiscVerify: state.cheevoCheckSkipDiscVerify,
        skipCartVerify: state.cheevoCheckSkipCartVerify,
        libraryBadge: state.libraryBadge,

        saveLibraryBadge: (nextValue: boolean) =>
            actions.saveSettingWithRollback<boolean>({
                nextValue,
                previousValue: state.libraryBadge,
                applyValue: (value: boolean) => {
                    actions.setLibraryBadge(value);
                    applyLibraryBadge(value);
                },
                saveCall: saveLibraryBadge,
                getSavedValue: (result, fallbackValue) => result.libraryBadge ?? fallbackValue,
            }),

        saveCacheHashes: (nextValue: boolean) =>
            actions.saveSettingWithRollback<boolean>({
                nextValue,
                previousValue: state.cheevoCheckCacheHashes,
                applyValue: actions.setCheevoCheckCacheHashes,
                saveCall: saveCheevoCheckCacheHashes,
                getSavedValue: (result, fallbackValue) => result.cheevoCheckCacheHashes ?? fallbackValue,
            }),

        saveExtractToRam: (nextValue: boolean) =>
            actions.saveSettingWithRollback<boolean>({
                nextValue,
                previousValue: state.cheevoCheckExtractToRam,
                applyValue: actions.setCheevoCheckExtractToRam,
                saveCall: saveCheevoCheckExtractToRam,
                getSavedValue: (result, fallbackValue) => result.cheevoCheckExtractToRam ?? fallbackValue,
            }),

        saveVerifyHashes: (nextValue: boolean) =>
            actions.saveSettingWithRollback<boolean>({
                nextValue,
                previousValue: state.cheevoCheckVerifyHashes,
                applyValue: actions.setCheevoCheckVerifyHashes,
                saveCall: saveCheevoCheckVerifyHashes,
                getSavedValue: (result, fallbackValue) => result.cheevoCheckVerifyHashes ?? fallbackValue,
            }),

        saveVerifySpeed: (nextValue: CheevoCheckVerifySpeed) =>
            actions.saveSettingWithRollback<CheevoCheckVerifySpeed>({
                nextValue,
                previousValue: state.cheevoCheckVerifySpeed,
                applyValue: actions.setCheevoCheckVerifySpeed,
                saveCall: saveCheevoCheckVerifySpeed,
                getSavedValue: (result, fallbackValue) =>
                    (result.cheevoCheckVerifySpeed as CheevoCheckVerifySpeed) ?? fallbackValue,
            }),

        saveSkipDiscVerify: (nextValue: boolean) =>
            actions.saveSettingWithRollback<boolean>({
                nextValue,
                previousValue: state.cheevoCheckSkipDiscVerify,
                applyValue: actions.setCheevoCheckSkipDiscVerify,
                saveCall: saveCheevoCheckSkipDiscVerify,
                getSavedValue: (result, fallbackValue) => result.cheevoCheckSkipDiscVerify ?? fallbackValue,
            }),

        saveSkipCartVerify: (nextValue: boolean) =>
            actions.saveSettingWithRollback<boolean>({
                nextValue,
                previousValue: state.cheevoCheckSkipCartVerify,
                applyValue: actions.setCheevoCheckSkipCartVerify,
                saveCall: saveCheevoCheckSkipCartVerify,
                getSavedValue: (result, fallbackValue) => result.cheevoCheckSkipCartVerify ?? fallbackValue,
            }),

        saveScanCollapsed: (next: boolean) => {
            state.setCheevoCheckScanCollapsed(next);
            void saveCheevoCheckScanCollapsed(next);
        },

        saveResultsCollapsed: (next: boolean) => {
            state.setCheevoCheckResultsCollapsed(next);
            void saveCheevoCheckResultsCollapsed(next);
        },

        saveVerifyCollapsed: (next: boolean) => {
            state.setCheevoCheckVerifyCollapsed(next);
            void saveCheevoCheckVerifyCollapsed(next);
        },

        saveOptionsCollapsed: (next: boolean) => {
            state.setCheevoCheckOptionsCollapsed(next);
            void saveCheevoCheckOptionsCollapsed(next);
        }
    };
}

export function CheevoCheckProvider(props: {
    isActive: boolean;
    language: LanguageCode;
    settings: SettingsController;
    children: ReactNode;
}) {
    const scan = useCheevoCheckController({ isActive: props.isActive, language: props.language });
    return (
        <CheevoCheckContext.Provider value={{ ...scan, settings: cheevoCheckSettings(props.settings) }}>
            {props.children}
        </CheevoCheckContext.Provider>
    );
}

export function useCheevoCheck(): CheevoCheck {
    return useContext(CheevoCheckContext)!;
}
