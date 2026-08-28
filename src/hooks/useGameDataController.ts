import {
    useCallback,
    useEffect,
    useRef,
    type Dispatch,
    type RefObject,
    type SetStateAction
} from "react";
import { checkCurrentGame, clearResumeState, consumeValidationSkip, refreshCurrentGame, saveResumeState } from "../api";
import type { LanguageCode } from "../locales";
import type { Payload, ResumeState, ViewKey } from "../types";
import { logError } from "../utils/errors"
import { t } from "../locales"

type BootstrapState = {
    username: string;
    hasApiKey: boolean;
    autoRefresh: boolean;
    payload: Payload | null;
};

type UseGameDataControllerArgs = {
    mountedRef: RefObject<boolean>;
    payloadRef: RefObject<Payload | null>;
    payload: Payload | null;
    setPayload: Dispatch<SetStateAction<Payload | null>>;
    setLoadingText: Dispatch<SetStateAction<string>>;
    username: string;
    hasApiKey: boolean;
    autoRefresh: boolean;
    language: LanguageCode;
    setLoading: Dispatch<SetStateAction<boolean>>;
    setError: Dispatch<SetStateAction<string | null>>;
    setCheckingGame: Dispatch<SetStateAction<boolean>>;
    setSettingsMode: Dispatch<SetStateAction<boolean>>;
    setSettingsLoaded: Dispatch<SetStateAction<boolean>>;
    setPendingPrimaryViewRestoreGameId: Dispatch<SetStateAction<number | null | undefined>>;
    setTrackedValidating: Dispatch<SetStateAction<boolean>>;
    loading: boolean;
    viewRef: RefObject<ViewKey>;
    rememberLastPageRef: RefObject<boolean>;
    loadSettingsAndCache: () => Promise<BootstrapState | null>;
    buildResumeState: () => ResumeState;
};

export function useGameDataController({
    mountedRef,
    payloadRef,
    payload,
    setPayload,
    setLoadingText,
    username,
    hasApiKey,
    autoRefresh,
    language,
    setLoading,
    setError,
    setCheckingGame,
    setSettingsMode,
    setSettingsLoaded,
    setPendingPrimaryViewRestoreGameId,
    setTrackedValidating,
    loading,
    viewRef,
    rememberLastPageRef,
    loadSettingsAndCache,
    buildResumeState
}: UseGameDataControllerArgs) {
    const refreshBusyRef = useRef(false);

    useEffect(() => {
        payloadRef.current = payload;
    }, [payload, payloadRef]);

    useEffect(() => {
        if (!loading) {
            return;
        }
        setLoadingText(t(language, "Refreshing Achievements..."));
    }, [language, loading, setLoadingText]);

    const refreshGameData = useCallback(
        async (
            force: boolean,
            _preserveFocus: boolean,
            loadingMessage = t(language, "Refreshing Achievements..."),
            creds?: { username: string; hasApiKey: boolean }
        ) => {
            if (refreshBusyRef.current) {
                return;
            }
            const effectiveUsername = creds?.username ?? username;
            const effectiveHasApiKey = creds?.hasApiKey ?? hasApiKey;
            if (!effectiveUsername.trim() || !effectiveHasApiKey) {
                setSettingsMode(true);
                return;
            }

            refreshBusyRef.current = true;
            setCheckingGame(false);
            setLoadingText(loadingMessage);
            setLoading(true);
            setError(null);

            try {
                const result = await refreshCurrentGame(force);
                if (!mountedRef.current) {
                    return;
                }
                if (result.needsSettings) {
                    setSettingsMode(true);
                    setError(result.error || "Please enter your RetroAchievements username and Web API key.");
                    if (result.payload) {
                        setPayload(result.payload);
                        setPendingPrimaryViewRestoreGameId(result.payload?.gameId ?? null);
                    }
                }
                else {
                    setSettingsMode(false);
                    setError(result.error ?? null);
                    setPayload(result.payload);
                    setPendingPrimaryViewRestoreGameId(result.payload?.gameId ?? null);
                }
            } catch (e: any) {
                logError("refreshGameData", e);
                if (mountedRef.current) {
                    setError(String(e?.message || e || "Couldn't refresh your achievements right now."));
                }
            } finally {
                refreshBusyRef.current = false;
                if (mountedRef.current) {
                    setLoading(false);
                }
            }
        },
        [
            username,
            hasApiKey,
            language,
            mountedRef,
            setCheckingGame,
            setError,
            setLoading,
            setLoadingText,
            setPayload,
            setPendingPrimaryViewRestoreGameId,
            setSettingsMode
        ]
    );

    const checkForCurrentGameChange = async (
        _cachedPayload: Payload | null,
        creds?: { username: string; hasApiKey: boolean; autoRefresh?: boolean }
    ) => {
        const effectiveUsername = creds?.username ?? username;
        const effectiveHasApiKey = creds?.hasApiKey ?? hasApiKey;
        if (!effectiveUsername.trim() || !effectiveHasApiKey) {
            return;
        }

        if (consumeValidationSkip()) {
            return;
        }

        const shouldShowTrackedValidation =
            Boolean(_cachedPayload) && viewRef.current === "tracked" && Boolean(creds?.autoRefresh ?? autoRefresh);

        setCheckingGame(true);
        if (shouldShowTrackedValidation) {
            setTrackedValidating(true);
        }
        try {
            const result = await checkCurrentGame();
            if (!mountedRef.current) {
                return;
            }
            if (result.needsSettings) {
                return;
            }
            if (result.error) {
                setError(result.error);
            }
            if (result.changed) {
                if (result.sameGame && result.payload) {
                    setError(result.error ?? null);
                    setPayload(result.payload);
                    setPendingPrimaryViewRestoreGameId(result.payload?.gameId ?? null);
                }
                else {
                    await refreshGameData(true, false, t(language, "Refreshing Achievements..."), {
                        username: effectiveUsername,
                        hasApiKey: effectiveHasApiKey
                    });
                }
            }
        } catch (e: any) {
            logError("checkForCurrentGameChange", e);
            if (mountedRef.current) {
                setError(String(e?.message || e || "Couldn't check your current game right now."));
            }
        } finally {
            if (mountedRef.current) {
                setCheckingGame(false);
                setTrackedValidating(false);
            }
        }
    };

    useEffect(() => {
        mountedRef.current = true;

        void (async () => {
            try {
                const state = await loadSettingsAndCache();
                if (!mountedRef.current || !state) {
                    return;
                }
                if (!state.username.trim() || !state.hasApiKey) {
                    return;
                }
                if (state.payload) {
                    void checkForCurrentGameChange(state.payload, {
                        username: state.username,
                        hasApiKey: state.hasApiKey,
                        autoRefresh: state.autoRefresh
                    });
                }
                else {
                    await refreshGameData(false, false, t(language, "Refreshing Achievements..."), {
                        username: state.username,
                        hasApiKey: state.hasApiKey
                    });
                }
            } catch (e) {
                logError("bootstrap loadSettingsAndCache", e);
                if (mountedRef.current) {
                    setError("Couldn't load plugin settings.");
                    setSettingsLoaded(true);
                }
            }
        })();

        return () => {
            if (rememberLastPageRef.current) {
                void saveResumeState(buildResumeState());
            }
            else {
                void clearResumeState();
            }
            mountedRef.current = false;
        };
    }, []);

    return {
        refreshGameData
    };
}
