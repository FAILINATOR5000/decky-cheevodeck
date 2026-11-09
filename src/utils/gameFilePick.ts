import { useSyncExternalStore } from "react";

import { multiplayerForgetPickedGame, multiplayerPickGameFile, multiplayerPickStartFolder } from "../api";
import { openPathPicker } from "../components/pickers/FilePickerModal";
import { t, type LanguageCode } from "../locales";
import { logError } from "./errors";

export type GameFilePick = {
    gameId: number;
    title: string;
    fileName: string;
    state: "running" | "done" | "failed";
    error: string;
    label: string;
};

type GameFilePickStore = { pick: GameFilePick | null; changed: number };

let store: GameFilePickStore = { pick: null, changed: 0 };
let lastFolder = "";
const listeners = new Set<() => void>();

function publish(next: Partial<GameFilePickStore>) {
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

export function useGameFilePick(): GameFilePickStore {
    return useSyncExternalStore(subscribe, () => store);
}

export function gameFilePickFailure(language: LanguageCode, pick: GameFilePick): string {
    if (pick.error === "not_this_game") {
        return t(language, "That file isn't {{game}}, or it's a version RetroAchievements doesn't recognize.", { game: pick.title });
    }
    if (pick.error === "no_network") {
        return t(language, "Couldn't reach RetroAchievements");
    }
    if (pick.error === "no_account") {
        return t(language, "Sign in to RetroAchievements first");
    }
    if (pick.error === "needs_dolphin") {
        return t(language, "GameCube and Wii games need Dolphin's Flatpak installed for Cheevo Check");
    }
    return t(language, "Couldn't read that file.");
}

export async function pickGameFile(language: LanguageCode, gameId: number, title: string,
    chosen = ""): Promise<GameFilePick | null> {
    if (store.pick?.state === "running") {
        return null;
    }
    if (chosen) {
        return checkGameFile(gameId, title, chosen);
    }
    let folder = lastFolder;
    if (!folder) {
        try {
            folder = (await multiplayerPickStartFolder()).folder ?? "";
        }
        catch (e) {
            logError("ez: finding where to pick a game's file", e);
        }
    }
    let path: string;
    try {
        path = (await openPathPicker({
            language,
            prompt: title ? t(language, "Choose {{game}}'s file", { game: title }) : t(language, "Choose the game's file"),
            startPath: folder,
            includeFiles: true,
            selectFile: true
        })).path;
    }
    catch {
        return null;
    }
    lastFolder = path.slice(0, path.lastIndexOf("/")) || "/";
    return checkGameFile(gameId, title, path);
}

async function checkGameFile(gameId: number, title: string, path: string): Promise<GameFilePick> {
    publish({ pick: { gameId, title, fileName: path.split("/").pop() ?? path, state: "running", error: "", label: "" } });
    let result: Awaited<ReturnType<typeof multiplayerPickGameFile>> | null = null;
    try {
        result = await multiplayerPickGameFile(gameId, path);
    }
    catch (e) {
        logError("ez: checking a picked game file", e);
    }
    const ended: GameFilePick = {
        ...store.pick!,
        title: result?.title || title,
        state: result?.ok ? "done" : "failed",
        error: result?.ok ? "" : result?.error ?? "unreadable",
        label: result?.label ?? ""
    };
    publish({ pick: ended, changed: store.changed + 1 });
    return ended;
}

export async function forgetGameFile(gameId: number) {
    try {
        await multiplayerForgetPickedGame(gameId);
    }
    catch (e) {
        logError("ez: forgetting a picked game file", e);
    }
    if (store.pick?.gameId === gameId && store.pick.state !== "running") {
        publish({ pick: null });
    }
    publish({ changed: store.changed + 1 });
}
