import { createContext, useContext, type ReactNode } from "react";
import { useEmulatorsController } from "../../hooks/useEmulatorsController";
import type { LanguageCode } from "../../locales";

type Emulators = ReturnType<typeof useEmulatorsController>;

const EmulatorsContext = createContext<Emulators | null>(null);

export function EmulatorsProvider(props: { isActive: boolean; language: LanguageCode; children: ReactNode }) {
    const value = useEmulatorsController({ isActive: props.isActive, language: props.language });
    return (
        <EmulatorsContext.Provider value={value}>
            {props.children}
        </EmulatorsContext.Provider>
    );
}

export function useEmulators(): Emulators {
    return useContext(EmulatorsContext)!;
}
