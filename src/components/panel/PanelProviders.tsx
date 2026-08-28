import type { ReactNode } from "react";
import { SmbSharesProvider } from "../smb/SmbSharesContext";
import { CheevoCheckProvider } from "../cheevocheck/CheevoCheckContext";
import { FileWatcherProvider } from "../filewatcher/FileWatcherContext";
import { DolphinMapperProvider } from "../mapping/DolphinMapperContext";
import type { SettingsController } from "../../hooks/useSettingsController";
import type { LanguageCode } from "../../locales";
import type { ViewKey } from "../../types";

export function PanelProviders(props: {
    view: ViewKey;
    language: LanguageCode;
    settings: SettingsController;
    children: ReactNode;
}) {
    return (
        <SmbSharesProvider isActive={props.view === "smbShares"}>
            <CheevoCheckProvider
                isActive={props.view === "cheevoCheck"}
                language={props.language}
                settings={props.settings}
            >
                <FileWatcherProvider
                    isActive={props.view === "fileWatcher"}
                    language={props.language}
                    settings={props.settings}
                >
                    <DolphinMapperProvider
                        isActive={props.view === "dolphinMapper"}
                        language={props.language}
                    >
                        {props.children}
                    </DolphinMapperProvider>
                </FileWatcherProvider>
            </CheevoCheckProvider>
        </SmbSharesProvider>
    );
}
