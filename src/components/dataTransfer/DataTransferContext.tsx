import { createContext, useContext, type ReactNode } from "react";
import { useDataTransferController } from "../../hooks/useDataTransferController";

type DataTransfer = ReturnType<typeof useDataTransferController>;

const DataTransferContext = createContext<DataTransfer | null>(null);

export function DataTransferProvider(props: {
    isActive: boolean;
    children: ReactNode;
}) {
    const transfer = useDataTransferController({ isActive: props.isActive });
    return (
        <DataTransferContext.Provider value={transfer}>
            {props.children}
        </DataTransferContext.Provider>
    );
}

export function useDataTransfer(): DataTransfer {
    return useContext(DataTransferContext)!;
}
