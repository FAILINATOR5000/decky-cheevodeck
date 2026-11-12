import { PanelSectionRow } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import { FaCheck } from "react-icons/fa";

import { multiplayerVote, multiplayerVoteCancel, multiplayerVoteStart } from "../../api";
import { useResilientGameIcon } from "../../hooks/useResilientGameIcon";
import { t, type LanguageCode } from "../../locales";
import type { MultiplayerVote } from "../../types";
import { getCurrentControllerGlyphStyle } from "../../utils/controllerGlyphs";
import { logError } from "../../utils/errors";
import { roomGameWhy } from "../../utils/multiplayerProblems";
import { textSize } from "../../utils/scale";
import { achievementGreen, bodyTextStyle, FADE_IN_KEYFRAMES } from "../../utils/style";
import { ButtonHints } from "../ui/ButtonHints";
import { FadeImage } from "../ui/FadeImage";
import { FocusableItem } from "../ui/FocusableItem";
import { showMultiplayerProblem } from "./ProblemModal";

const SHUFFLE_STEP_MS = 120;
const GAMES_MIN = 2;

type Banner = { gameId: number; title: string; icon: string };

function bannerKey(gameId: number): string {
    return `multiplayer:vote:game:${gameId}`;
}

function VoteBanner(props: {
    banner: Banner;
    label: string;
    lit: boolean;
    won: boolean;
    mine: boolean;
    showIcons: boolean;
    focusFallback: string[];
    onPress: () => void;
}) {
    const { banner } = props;
    const { iconDataUri, cold } = useResilientGameIcon(props.showIcons ? banner.gameId : null, banner.icon || null,
        "getGameIconCached (vote banner)");
    const size = textSize(30);
    return (
        <PanelSectionRow>
            <FocusableItem
                bottomSeparator="none"
                focusKey={bannerKey(banner.gameId)}
                focusFallback={props.focusFallback}
                onClick={props.onPress}
                outerStyle={{ width: "100%" }}
            >
                <div
                    style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "2px 4px",
                        borderRadius: "6px",
                        boxShadow: props.lit ? `0 0 0 2px ${achievementGreen}` : undefined,
                        background: props.lit ? "rgba(34, 197, 94, 0.16)" : undefined
                    }}
                >
                    <style>{FADE_IN_KEYFRAMES}</style>
                    {props.showIcons && (
                        <div
                            style={{
                                width: `${size}px`,
                                height: `${size}px`,
                                flexShrink: 0,
                                borderRadius: "6px",
                                overflow: "hidden",
                                background: "rgba(255,255,255,0.10)"
                            }}
                        >
                            {iconDataUri && (
                                <FadeImage
                                    src={iconDataUri}
                                    fadeOnLoad={cold}
                                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                />
                            )}
                        </div>
                    )}
                    <span style={{ flex: 1, minWidth: 0, textAlign: "left", overflowWrap: "anywhere",
                        fontWeight: props.won ? 800 : undefined, color: props.won ? achievementGreen : undefined }}>
                        {props.label}
                    </span>
                    {props.mine && <FaCheck style={{ flexShrink: 0, color: achievementGreen }} />}
                </div>
            </FocusableItem>
        </PanelSectionRow>
    );
}

export function GameVoteTab(props: {
    language: LanguageCode;
    showIcons: boolean;
    host: boolean;
    inLobby: boolean;
    vote: MultiplayerVote | null;
    buttonStyle: React.CSSProperties;
    exitKey: string;
    onPickGames: (onDone: (gameIds: number[]) => void) => void;
}) {
    const { language, vote, host } = props;
    const pressing = useRef(false);
    const shuffling = vote !== null && vote.kind === "pick" && vote.ended === "";
    const [spot, setSpot] = useState(0);
    useEffect(() => {
        if (!shuffling || vote === null) {
            return;
        }
        setSpot(0);
        const count = vote.games.length;
        const timer = window.setInterval(() => setSpot((current) => (current + 1) % count), SHUFFLE_STEP_MS);
        return () => window.clearInterval(timer);
    }, [shuffling, vote?.id]);

    const voteOpen = Boolean(vote?.open);
    const shown = vote !== null && vote.ended !== "canceled" && vote.ended !== "started" ? vote : null;
    const banners: Banner[] = shown?.games.map((game) => ({ gameId: game.gameId, title: game.title, icon: game.icon })) ?? [];

    function explain(titleKey: string, code: string, vars?: Record<string, string>) {
        showMultiplayerProblem(language, titleKey, roomGameWhy(language, code, vars));
    }

    async function send(titleKey: string, task: () => Promise<{ ok: boolean; error?: string }>) {
        if (pressing.current) {
            return;
        }
        pressing.current = true;
        try {
            const result = await task();
            if (!result.ok) {
                explain(titleKey, result.error ?? "unavailable");
            }
        }
        catch (e) {
            logError("multiplayer: a Game Vote press", e);
        }
        finally {
            pressing.current = false;
        }
    }

    function pressVote() {
        if (shuffling) {
            explain("Start Vote", "pick_landing");
            return;
        }
        if (voteOpen) {
            void send("Cancel Voting", () => multiplayerVoteCancel());
            return;
        }
        if (!props.inLobby) {
            explain("Start Vote", "vote_wait_lobby");
            return;
        }
        pickThenStart("Start Vote", "vote");
    }

    function pickThenStart(titleKey: string, kind: "vote" | "pick") {
        props.onPickGames((gameIds) => {
            if (gameIds.length === 0) {
                return;
            }
            if (gameIds.length < GAMES_MIN) {
                explain(titleKey, "vote_games");
                return;
            }
            void send(titleKey, () => multiplayerVoteStart(kind, gameIds));
        });
    }

    function pressPick() {
        if (shuffling) {
            explain("Random Pick", "pick_landing");
            return;
        }
        if (!props.inLobby) {
            explain("Random Pick", "vote_wait_lobby");
            return;
        }
        if (voteOpen) {
            explain("Random Pick", "vote_open");
            return;
        }
        pickThenStart("Random Pick", "pick");
    }

    function pressBanner(banner: Banner, index: number) {
        if (vote === null) {
            return;
        }
        if (vote.kind === "pick") {
            explain(banner.title, shuffling ? "pick_landing" : "pick_not_vote");
            return;
        }
        if (!props.inLobby) {
            explain(banner.title, "vote_in_game");
            return;
        }
        if (!vote.open) {
            explain(banner.title, "vote_over");
            return;
        }
        if (vote.mine >= 0) {
            explain(banner.title, "vote_voted");
            return;
        }
        void send(banner.title, () => multiplayerVote(vote.id, index));
    }

    const buttonKeys = host ? ["multiplayer:vote:toggle", "multiplayer:vote:pick"] : [];
    const tail = [...buttonKeys, "multiplayer:roomtab:vote", props.exitKey, "multiplayer:back"];
    function bannerHeirs(index: number): string[] {
        const heirs: string[] = [];
        for (const other of [banners[index + 1], banners[index - 1]]) {
            if (other) {
                heirs.push(bannerKey(other.gameId));
            }
        }
        return [...heirs, ...tail];
    }

    const lit = shuffling ? spot : vote?.ended === "won" ? vote.winner : -1;
    const hint = voteOpen && vote?.mine === -1 ? "Vote" : "";

    return (
        <>
            {host && (
                <>
                    <PanelSectionRow>
                        <FocusableItem
                            bottomSeparator="none"
                            outerStyle={props.buttonStyle}
                            focusKey="multiplayer:vote:toggle"
                            focusFallback={["multiplayer:vote:pick", "multiplayer:roomtab:vote", props.exitKey]}
                            onClick={pressVote}
                        >
                            {t(language, voteOpen ? "Cancel Voting" : "Start Vote")}
                        </FocusableItem>
                    </PanelSectionRow>
                    <PanelSectionRow>
                        <FocusableItem
                            bottomSeparator="none"
                            outerStyle={props.buttonStyle}
                            focusKey="multiplayer:vote:pick"
                            focusFallback={["multiplayer:vote:toggle", "multiplayer:roomtab:vote", props.exitKey]}
                            onClick={pressPick}
                        >
                            <span style={{ opacity: voteOpen ? 0.6 : 1 }}>{t(language, "Random Pick")}</span>
                        </FocusableItem>
                    </PanelSectionRow>
                </>
            )}
            <PanelSectionRow>
                <div style={{ minHeight: "1.6em", display: "flex", alignItems: "center" }}>
                    {hint ? (
                        <ButtonHints style={getCurrentControllerGlyphStyle()} hints={[{ button: "a", label: t(language, hint) }]} />
                    ) : banners.length === 0 ? (
                        <span style={bodyTextStyle()}>
                            {t(language, host ? "Press “Start Vote” or “Random Pick” to choose two to four games." : "No vote yet.")}
                        </span>
                    ) : null}
                </div>
            </PanelSectionRow>
            {banners.map((banner, index) => (
                <VoteBanner
                    key={banner.gameId}
                    banner={banner}
                    label={vote === null || vote.kind === "pick"
                        ? banner.title
                        : `${banner.title} (${vote.counts[index] ?? 0})`}
                    lit={index === lit}
                    won={!shuffling && vote?.ended === "won" && vote.winner === index}
                    mine={vote?.mine === index}
                    showIcons={props.showIcons}
                    focusFallback={bannerHeirs(index)}
                    onPress={() => pressBanner(banner, index)}
                />
            ))}
        </>
    );
}
