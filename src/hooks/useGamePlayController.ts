import { useEffect, useState, useSyncExternalStore } from "react";

import { multiplayerCheck, multiplayerPlayChoices, multiplayerPlayInfo, multiplayerSavePlayPick } from "../api";
import { showPlayWith } from "../components/game/PlayWithModal";
import { showShortcutNeeded } from "../components/game/ShortcutNeededModal";
import { showMultiplayerProblem } from "../components/multiplayer/ProblemModal";
import { t, type LanguageCode } from "../locales";
import type { MultiplayerMode, PlayInfo, PlayPick } from "../types";
import { logError } from "../utils/errors";
import {
    multiplayerChoices,
    rememberMultiplayerGame,
    rememberMultiplayerPage,
    rememberMultiplayerTab
} from "../utils/multiplayerChoices";
import { problemText } from "../utils/multiplayerProblems";
import { useMultiplayerRoomRole } from "../utils/multiplayerRoomState";
import {
    anyGameRunning,
    launchInFlight,
    playGame,
    runningAppSnapshot,
    type PlayChoice,
    subscribeRunningApp
} from "../utils/multiplayerSession";

export type PlayMode = "play" | "host" | "with";

const NEXT_MODE: Record<PlayMode, PlayMode> = { play: "host", host: "with", with: "play" };

type HostCheck = { gameId: number; mode: MultiplayerMode | null; gate: string | null; detail: Record<string, string> };

const playInfos = new Map<number, PlayInfo>();

export function useGamePlayController(props: {
    gameId: number | null;
    isActive: boolean;
    language: LanguageCode;
    openMultiplayer: () => void;
}) {
    const { gameId, isActive, language } = props;
    const [chosen, setChosen] = useState<{ gameId: number | null; mode: PlayMode }>({ gameId, mode: "play" });
    const mode: PlayMode = chosen.gameId === gameId ? chosen.mode : "play";
    const [loaded, setLoaded] = useState<{ gameId: number; info: PlayInfo } | null>(null);
    const info = gameId == null ? null : loaded?.gameId === gameId ? loaded.info : playInfos.get(gameId) ?? null;
    const [hostCheck, setHostCheck] = useState<HostCheck | null>(null);
    const host = hostCheck?.gameId === gameId ? hostCheck : null;
    const running = useSyncExternalStore(subscribeRunningApp, runningAppSnapshot);
    const roomRole = useMultiplayerRoomRole();

    useEffect(() => {
        if (!isActive || gameId == null) {
            return;
        }
        let alive = true;
        multiplayerPlayInfo(gameId, null)
            .then((next) => {
                playInfos.set(gameId, next);
                if (alive) {
                    setLoaded({ gameId, info: next });
                }
            })
            .catch((e) => logError("play: couldn't ask whether this game can launch", e));
        return () => {
            alive = false;
        };
    }, [isActive, gameId]);

    const hostChecked = host !== null;
    useEffect(() => {
        if (!isActive || mode !== "host" || gameId == null || roomRole !== null || hostChecked) {
            return;
        }
        let alive = true;
        void (async () => {
            const first = multiplayerChoices().tab;
            const modes: MultiplayerMode[] = [first, ...(["link", "couch", "stream"] as MultiplayerMode[]).filter((each) => each !== first)];
            let result: HostCheck = { gameId, mode: null, gate: null, detail: {} };
            try {
                for (const each of modes) {
                    const checked = await multiplayerCheck(each, gameId, "", "");
                    if (!checked.gate) {
                        result = { gameId, mode: each, gate: null, detail: {} };
                        break;
                    }
                    if (result.gate === null) {
                        result = { gameId, mode: null, gate: checked.gate, detail: checked.detail ?? {} };
                    }
                }
            }
            catch (e) {
                logError("play: couldn't check whether this game can host", e);
                return;
            }
            if (alive) {
                setHostCheck(result);
            }
        })();
        return () => {
            alive = false;
        };
    }, [isActive, mode, gameId, roomRole, hostChecked]);

    const ownAppid = info?.launchable && !info.fallback ? info.appid : 0;
    const playing = (ownAppid !== 0 && running.appid === ownAppid)
        || (gameId != null && running.playedGameId === gameId);
    const gameRunning = anyGameRunning();

    function anotherGameRunning() {
        showMultiplayerProblem(language, "Another Game Is Running", t(language, "Close the running game first"));
    }

    function launch(forGame: number, appid: number, fallback: boolean, choice: PlayChoice = null, kind = "") {
        if (anyGameRunning() || launchInFlight()) {
            anotherGameRunning();
            return;
        }
        playGame(forGame, appid, fallback, choice, kind)
            .then((result) => {
                if (result.error === "busy") {
                    anotherGameRunning();
                }
                else if (!result.ok) {
                    showMultiplayerProblem(language, "Couldn't Start",
                        problemText(language, result.gate ?? result.error ?? "launch_failed", result.detail));
                }
            })
            .catch((e) => logError("play: the launch threw", e));
    }

    async function launchPicked(forGame: number, pick: PlayPick | null, remember: boolean) {
        try {
            if (remember) {
                await multiplayerSavePlayPick(forGame, "play", pick);
            }
            const choice = pick ?? {};
            const picked = await multiplayerPlayInfo(forGame, choice);
            if (!picked.launchable) {
                showMultiplayerProblem(language, "Couldn't Start", problemText(language, picked.gate ?? "launch_failed", picked.detail));
                return;
            }
            launch(forGame, picked.appid, picked.fallback, choice, picked.kind ?? "");
        }
        catch (e) {
            logError("play: Play With couldn't start the pick", e);
        }
    }

    function openPlayWith(forGame: number) {
        multiplayerPlayChoices(forGame)
            .then((choices) => {
                if (!choices.ok) {
                    return;
                }
                showPlayWith({
                    language,
                    purpose: "launch",
                    choices,
                    onPick: (pick, remember) => void launchPicked(forGame, pick, remember),
                    onForget: () => multiplayerSavePlayPick(forGame, "play", null)
                        .then(() => undefined)
                        .catch((e) => logError("play: Forget didn't clear the pick", e))
                });
            })
            .catch((e) => logError("play: couldn't list what can play this game", e));
    }

    let label: string;
    let press: (() => void) | null = null;
    let explain: (() => void) | null = null;
    if (mode === "host") {
        label = t(language, "Host");
        if (roomRole !== null) {
            explain = () => showMultiplayerProblem(language, "Can't Host", t(language, "You are already in a room."));
        }
        else if (playing || gameRunning) {
            explain = anotherGameRunning;
        }
        else if (host?.mode && gameId != null) {
            const hostMode = host.mode;
            const hostGame = gameId;
            press = () => {
                rememberMultiplayerGame(hostGame);
                rememberMultiplayerTab(hostMode);
                rememberMultiplayerPage("play");
                props.openMultiplayer();
            };
        }
        else if (host?.gate === "no_shortcut" && info) {
            const tools = info.tools ?? {};
            explain = () => showShortcutNeeded(language, tools, true);
        }
        else if (host?.gate) {
            const reason = problemText(language, host.gate, host.detail);
            explain = () => showMultiplayerProblem(language, "Can't Host", reason);
        }
    }
    else if (playing) {
        label = t(language, "Playing");
    }
    else if (mode === "with") {
        label = t(language, "Play With…");
        const unscanned = info?.gate === "no_scan" || info?.gate === "not_in_results";
        if (info && !unscanned && gameId != null) {
            const forGame = gameId;
            press = () => {
                if (anyGameRunning() || launchInFlight()) {
                    anotherGameRunning();
                    return;
                }
                openPlayWith(forGame);
            };
        }
        else if (info) {
            const tools = info.tools ?? {};
            explain = () => showShortcutNeeded(language, tools);
        }
    }
    else {
        label = t(language, "play_game");
        if (info?.launchable && gameId != null) {
            const ready = { gameId, appid: info.appid, fallback: info.fallback, kind: info.kind ?? "" };
            press = () => launch(ready.gameId, ready.appid, ready.fallback, null, ready.kind);
        }
        else if (info) {
            const tools = info.tools ?? {};
            explain = () => showShortcutNeeded(language, tools);
        }
    }

    function onToggleMode() {
        setChosen({ gameId, mode: NEXT_MODE[mode] });
    }

    function onPress() {
        (press ?? explain)?.();
    }

    const hostPending = mode === "host" && roomRole === null && gameId != null && host === null && !gameRunning && !playing;
    const playLit = Boolean(info?.launchable) && !playing;

    return { mode, label, disabled: hostPending ? !playLit : press === null, onPress, onToggleMode };
}
