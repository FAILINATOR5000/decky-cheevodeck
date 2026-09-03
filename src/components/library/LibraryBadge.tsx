import { Focusable } from "@decky/ui";
import { FaTrophy } from "react-icons/fa";
import { useEffect, useRef, useState } from "react";
import { getLibraryBadgeIdentity } from "../../api";
import { ensureLanguageLoaded, getCurrentLanguage, t } from "../../locales";
import { textSize } from "../../utils/scale";
import { FADE_IN_KEYFRAMES } from "../../utils/style";
import { loadProgress, readCachedProgress } from "./libraryBadgeProgress";
import { openGameOverviewForGame } from "./openGameOverview";

type Settled = {
    gameId: number;
    label: string;
};

export type LibraryBadgeProps = {
    appId: number;
};

export function LibraryBadge({ appId }: LibraryBadgeProps) {
    const [settled, setSettled] = useState<Settled | null>(null);
    const [focused, setFocused] = useState(false);
    const live = useRef(true);

    useEffect(() => {
        live.current = true;
        return () => {
            live.current = false;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        setSettled(null);

        void Promise.all([getLibraryBadgeIdentity(appId), ensureLanguageLoaded(getCurrentLanguage())])
            .then(async ([found]) => {
                const gameId = Number(found?.gameId ?? 0);
                if (cancelled || !live.current || !gameId) {
                    return;
                }
                const activeUlid = String(found?.activeUlid ?? "");
                const cached = readCachedProgress(activeUlid, gameId);
                const progress = cached !== undefined
                    ? cached
                    : await loadProgress(activeUlid, gameId);
                if (cancelled || !live.current) {
                    return;
                }
                const total = progress ? progress.total : Number(found?.achievements ?? 0);
                if (!total) {
                    return;
                }
                const language = getCurrentLanguage();
                setSettled({
                    gameId,
                    label: progress
                        ? t(language, "{{earned}} / {{total}} Unlocked", {
                            earned: progress.earned,
                            total: progress.total
                        })
                        : t(language, "{{count}} achievements", { count: total })
                });
            })
            .catch(() => {
            });

        return () => {
            cancelled = true;
        };
    }, [appId]);

    if (!settled) {
        return null;
    }

    return (
        <div
            className="da-faded"
            style={{
                position: "absolute",
                top: 0,
                left: 0,
                padding: "2.8%",
                zIndex: 1000,
                animation: "da-fade-in 400ms ease-out"
            }}
        >
            <style>{FADE_IN_KEYFRAMES}</style>
            <Focusable
                onActivate={() => openGameOverviewForGame(settled.gameId)}
                onGamepadFocus={() => setFocused(true)}
                onGamepadBlur={() => setFocused(false)}
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "4px 10px",
                    borderRadius: "3px",
                    fontSize: `${textSize(13)}px`,
                    color: "#ffffff",
                    backgroundColor: focused ? "rgba(255, 255, 255, 0.22)" : "rgba(0, 0, 0, 0.45)",
                    outline: focused ? "2px solid rgba(255, 255, 255, 0.9)" : "2px solid transparent",
                    cursor: "pointer"
                }}
            >
                <FaTrophy />
                <span>{settled.label}</span>
            </Focusable>
        </div>
    );
}
