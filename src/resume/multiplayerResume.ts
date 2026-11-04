import type { GameOverviewSource, MultiplayerSource, ResumeState } from "../types";
import { getSavedGameOverviewSource } from "./gameOverviewResume";

export function getSavedMultiplayerSource(savedState: ResumeState): MultiplayerSource {
    const value = savedState.multiplayerSource;
    if (value === "utils" || value === "gameOverview") {
        return value;
    }
    return "achievements";
}

const REBUILT_GAME_OVERVIEW_SOURCES: GameOverviewSource[] = [
    "main", "search", "cheevoCheck", "mainNowPlaying", "socialActivity", "subscribedDiscussions", "newsEvents", "activity"
];

export function getSavedGameOverviewSourceUnderMultiplayer(savedState: ResumeState): GameOverviewSource {
    const source = getSavedGameOverviewSource(savedState);
    return REBUILT_GAME_OVERVIEW_SOURCES.includes(source) ? source : "main";
}
