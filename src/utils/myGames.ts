import { useSyncExternalStore } from "react";

import { myGamesList, refreshMyGames, saveMyGamesLastSystemId } from "../api";
import type { MyGamesList } from "../types";
import { logError } from "./errors";

type MyGamesFailure = "" | "error" | "needsSettings";

type MyGamesStore = {
    listing: MyGamesList | null;
    fetching: "" | "quiet" | "loud";
    failure: MyGamesFailure;
    settled: boolean;
};

let store: MyGamesStore = { listing: null, fetching: "", failure: "", settled: false };
let inFlight: Promise<void> | null = null;
let fetchesDone = 0;
const listeners = new Set<() => void>();

function publish(next: Partial<MyGamesStore>) {
    store = { ...store, ...next };
    for (const listener of listeners) {
        listener();
    }
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function useMyGames(): MyGamesStore {
    return useSyncExternalStore(subscribe, () => store);
}

function usable(result: MyGamesList | null | undefined): result is MyGamesList {
    return Boolean(result?.ok) && Array.isArray(result?.games);
}

export async function readMyGames(): Promise<MyGamesList | null> {
    const startedAt = fetchesDone;
    try {
        const result = await myGamesList();
        if (usable(result) && startedAt === fetchesDone) {
            publish({ listing: result });
        }
    }
    catch (e) {
        logError("myGamesList", e);
    }
    return store.listing;
}

export function rememberMyGamesSystem(systemId: number): void {
    if (store.listing) {
        publish({ listing: { ...store.listing, recentSystemId: systemId } });
    }
    void saveMyGamesLastSystemId(systemId).catch((e) => logError("saveMyGamesLastSystemId", e));
}

export function fetchMyGames(loud: boolean): void {
    if (inFlight) {
        if (loud && store.fetching === "quiet") {
            publish({ fetching: "loud", failure: "" });
        }
        return;
    }
    publish({ fetching: loud ? "loud" : "quiet", failure: "" });
    inFlight = (async () => {
        let failure: MyGamesFailure = "";
        let listing = store.listing;
        try {
            const result = await refreshMyGames();
            if (usable(result)) {
                listing = result;
            }
            if (result?.needsSettings) {
                failure = "needsSettings";
            }
            else if (!usable(result) || result.error) {
                failure = "error";
            }
        }
        catch (e) {
            logError("refreshMyGames", e);
            failure = "error";
        }
        fetchesDone += 1;
        inFlight = null;
        publish({
            listing,
            fetching: "",
            failure: store.fetching === "loud" ? failure : "",
            settled: true
        });
    })();
}
