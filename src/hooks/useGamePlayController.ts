import { useEffect, useState, useSyncExternalStore } from "react";

import { multiplayerCheck, multiplayerPlayChoices, multiplayerPlayInfo, multiplayerSavePlayPick } from "../api";
import { showPlayWith } from "../components/game/PlayWithModal";
import { openFixIt } from "../components/multiplayer/FixItModal";
import { showMultiplayerProblem } from "../components/multiplayer/ProblemModal";
import { t, type LanguageCode } from "../locales";
import type { PlayInfo, PlayPick } from "../types";
import { logError } from "../utils/errors";
import { HOST_GATES, useFixPlan } from "../utils/fixPlan";
import { useGameFilePick } from "../utils/gameFilePick";
import { rememberMultiplayerGame, rememberMultiplayerPage } from "../utils/multiplayerChoices";
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

type HostCheck = { gameId: number; gate: string | null };

const playInfos = new Map<number, PlayInfo>();

export function useGamePlayController(props: {
    gameId: number | null;
    title: string;
    isActive: boolean;
    language: LanguageCode;
    openMultiplayer: () => void;
}) {
    const { gameId, isActive, language } = props;
    const gameFilesChanged = useGameFilePick().changed;
    const fixPlan = useFixPlan();
    const fixesFinished = fixPlan.finished;
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
    }, [isActive, gameId, gameFilesChanged, fixesFinished]);

    useEffect(() => {
        setHostCheck(null);
    }, [gameFilesChanged, fixesFinished]);

    const hostChecked = host !== null;
    useEffect(() => {
        if (!isActive || mode !== "host" || gameId == null || roomRole !== null || hostChecked) {
            return;
        }
        let alive = true;
        multiplayerCheck("couch", gameId, "", "")
            .then((checked) => {
                if (alive) {
                    setHostCheck({ gameId, gate: checked.gate && HOST_GATES.includes(checked.gate) ? checked.gate : null });
                }
            })
            .catch((e) => logError("play: couldn't check whether this game can host", e));
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
            explain = () => showMultiplayerProblem(language, "Can't Host", t(language, "Cannot host now since you are already in a room."));
        }
        else if (playing) {
            explain = () => showMultiplayerProblem(language, "Can't Host", t(language, "You're playing this game right now. Close it first, then host it."));
        }
        else if (gameRunning) {
            explain = anotherGameRunning;
        }
        else if (host !== null && host.gate === null && gameId != null) {
            const hostGame = gameId;
            press = () => {
                rememberMultiplayerGame(hostGame);
                rememberMultiplayerPage("play");
                props.openMultiplayer();
            };
        }
        else if (host?.gate && gameId != null) {
            const about = { target: "couch" as const, gameId, title: props.title, host: true, tools: info?.tools ?? null };
            explain = () => void openFixIt(language, about);
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
        else if (info && gameId != null) {
            const about = { target: "play" as const, gameId, title: props.title };
            explain = () => void openFixIt(language, about);
        }
    }
    else {
        label = t(language, "play_game");
        if (info?.launchable && gameId != null) {
            const ready = { gameId, appid: info.appid, fallback: info.fallback, kind: info.kind ?? "" };
            press = () => launch(ready.gameId, ready.appid, ready.fallback, null, ready.kind);
        }
        else if (info && gameId != null) {
            const about = { target: "play" as const, gameId, title: props.title };
            explain = () => void openFixIt(language, about);
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

    const run = fixPlan.run;
    const fixRun = run !== null && run.gameId === gameId && (run.running || run.failed) ? run : null;

    return { mode, label, disabled: hostPending ? !playLit : press === null, onPress, onToggleMode, fixRun };
}
