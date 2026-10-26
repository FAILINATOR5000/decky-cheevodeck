import { addEventListener, removeEventListener } from "@decky/api";
import type { DataKind } from "../types";

const DATA_IMPORTED_EVENT = "cheevodeck_data_imported";

type DataImported = { kind?: DataKind; gameId?: number | null };

export function onDataImported(kind: DataKind, listener: (gameId: number | null) => void): () => void {
    const heard = (event: DataImported) => {
        if (event?.kind === kind) {
            listener(typeof event.gameId === "number" ? event.gameId : null);
        }
    };
    addEventListener(DATA_IMPORTED_EVENT, heard);
    return () => {
        removeEventListener(DATA_IMPORTED_EVENT, heard);
    };
}
