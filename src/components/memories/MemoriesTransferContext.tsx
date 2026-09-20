import { createContext, useContext, type ReactNode } from "react";
import { useMemoriesTransferController } from "../../hooks/useMemoriesTransferController";
import type { LanguageCode } from "../../locales";

type MemoriesTransfer = ReturnType<typeof useMemoriesTransferController>;

const MemoriesTransferContext = createContext<MemoriesTransfer | null>(null);

export function MemoriesTransferProvider(props: {
    isActive: boolean;
    language: LanguageCode;
    children: ReactNode;
}) {
    const transfer = useMemoriesTransferController({
        isActive: props.isActive,
        language: props.language
    });
    return (
        <MemoriesTransferContext.Provider value={transfer}>
            {props.children}
        </MemoriesTransferContext.Provider>
    );
}

export function useMemoriesTransfer(): MemoriesTransfer {
    return useContext(MemoriesTransferContext)!;
}
