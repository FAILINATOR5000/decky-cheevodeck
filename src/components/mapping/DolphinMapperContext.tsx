import { createContext, useContext, type ReactNode } from "react";
import { useDolphinMapperController } from "../../hooks/useDolphinMapperController";
import type { LanguageCode } from "../../locales";

type DolphinMapper = ReturnType<typeof useDolphinMapperController>;

const DolphinMapperContext = createContext<DolphinMapper | null>(null);

export function DolphinMapperProvider(props: { isActive: boolean; language: LanguageCode; children: ReactNode }) {
    const value = useDolphinMapperController({ isActive: props.isActive, language: props.language });
    return (
        <DolphinMapperContext.Provider value={value}>
            {props.children}
        </DolphinMapperContext.Provider>
    );
}

export function useDolphinMapper(): DolphinMapper {
    return useContext(DolphinMapperContext)!;
}
