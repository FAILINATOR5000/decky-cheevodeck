import { createContext, useContext, type ReactNode } from "react";
import { saveDolphinPadOrderCollapsed } from "../../api";
import { useDolphinMapperController } from "../../hooks/useDolphinMapperController";
import type { SettingsController } from "../../hooks/useSettingsController";
import type { LanguageCode } from "../../locales";
import { logError } from "../../utils/errors";

type DolphinMapper = ReturnType<typeof useDolphinMapperController> & {
    padOrderCollapsed: boolean;
    savePadOrderCollapsed: (collapsed: boolean) => void;
};

const DolphinMapperContext = createContext<DolphinMapper | null>(null);

export function DolphinMapperProvider(props: {
    isActive: boolean;
    language: LanguageCode;
    settings: SettingsController;
    children: ReactNode;
}) {
    const mapper = useDolphinMapperController({ isActive: props.isActive, language: props.language });
    const { state, actions } = props.settings;
    const savePadOrderCollapsed = (collapsed: boolean) => {
        actions.setDolphinPadOrderCollapsed(collapsed);
        void saveDolphinPadOrderCollapsed(collapsed).catch((e) => {
            logError("saveDolphinPadOrderCollapsed", e);
        });
    };
    const value = { ...mapper, padOrderCollapsed: state.dolphinPadOrderCollapsed, savePadOrderCollapsed };
    return (
        <DolphinMapperContext.Provider value={value}>
            {props.children}
        </DolphinMapperContext.Provider>
    );
}

export function useDolphinMapper(): DolphinMapper {
    return useContext(DolphinMapperContext)!;
}
