import { createContext, useContext, type ReactNode } from "react";
import { useSmbSharesController } from "../../hooks/useSmbSharesController";

type SmbShares = ReturnType<typeof useSmbSharesController>;

const SmbSharesContext = createContext<SmbShares | null>(null);

export function SmbSharesProvider(props: { isActive: boolean; children: ReactNode }) {
    const value = useSmbSharesController({ isActive: props.isActive });
    return (
        <SmbSharesContext.Provider value={value}>
            {props.children}
        </SmbSharesContext.Provider>
    );
}

export function useSmbShares(): SmbShares {
    return useContext(SmbSharesContext)!;
}
