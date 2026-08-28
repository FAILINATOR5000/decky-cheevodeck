import { useState, type Dispatch, type RefObject, type SetStateAction } from "react";

import { useLatestRef } from "./useLatestRef";

import {
    addUser,
    clearApiKey,
    clearConnectLogin,
    clearResumeState,
    factoryReset,
    generateConnectToken,
    getSettings,
    markIntroViewed,
    reinjectActiveLogin,
    removeUser,
    saveInjectEmulatorLogin,
    saveSettings,
    switchUser
} from "../api";
import { AddUserModal } from "../components/account/AddUserModal";
import { ConnectTokenModal } from "../components/account/ConnectTokenModal";
import { CredentialsModal } from "../components/account/CredentialsModal";
import { LanguageModal } from "../components/account/LanguageModal";
import { SwitchUserModal, type SwitchUserOutcome } from "../components/account/SwitchUserModal";
import { WelcomeFollowupModal } from "../components/account/WelcomeFollowupModal";
import { WelcomeModal } from "../components/account/WelcomeModal";
import { t, type LanguageCode } from "../locales";
import type {
    SavedUser,
    SettingsResponse,
    SwitchUserResult,
    ViewKey
} from "../types";
import { getErrorMessage, logError } from "../utils/errors";
import { showManagedModal } from "../utils/modalRegistry";
import type { ScalePreset } from "../types";

type UseAccountActionsArgs = {
    language: LanguageCode;
    mountedRef: RefObject<boolean>;
    runClearWithSpinner: (
        focusKey: string,
        setSpinner: (busy: boolean) => void,
        errorLabel: string,
        fallbackMessage: string,
        work: () => Promise<void>
    ) => Promise<void>;
    wipeFrontendMirrors: () => void;
    refreshGameData: (
        force: boolean,
        preserveFocus: boolean,
        loadingMessage: string,
        creds?: { username: string; hasApiKey: boolean }
    ) => Promise<void>;
    onApplySetupProfile: (profile: string, preserveOtherSettings: boolean) => void | Promise<void>;
    onApplyScalePreset: (preset: ScalePreset) => void | Promise<void>;
    onSelectLanguage: (code: LanguageCode) => void | Promise<void>;
    username: string;
    hasApiKey: boolean;
    users: SavedUser[];
    injectEmulatorLogin: boolean;
    viewedIntro: boolean;
    applySettings: (source: SettingsResponse, options: { skipButtonToggles?: boolean }) => void;
    setUsers: Dispatch<SetStateAction<SavedUser[]>>;
    setInjectEmulatorLogin: Dispatch<SetStateAction<boolean>>;
    setHasApiKey: Dispatch<SetStateAction<boolean>>;
    setViewedIntro: Dispatch<SetStateAction<boolean>>;
    setView: (next: ViewKey) => void;
    setPendingFocusKey: Dispatch<SetStateAction<string | null>>;
    setSettingsMode: Dispatch<SetStateAction<boolean>>;
    setSaving: Dispatch<SetStateAction<boolean>>;
    setError: Dispatch<SetStateAction<string | null>>;
    clearPendingResumeState: () => void;
    setFriendsError: Dispatch<SetStateAction<string | null>>;
    setFriendGameError: Dispatch<SetStateAction<string | null>>;
};

export function useAccountActions({
    language,
    mountedRef,
    runClearWithSpinner,
    wipeFrontendMirrors,
    refreshGameData,
    onApplySetupProfile,
    onApplyScalePreset,
    onSelectLanguage,
    username,
    hasApiKey,
    users,
    injectEmulatorLogin,
    viewedIntro,
    applySettings,
    setUsers,
    setInjectEmulatorLogin,
    setHasApiKey,
    setViewedIntro,
    setView,
    setPendingFocusKey,
    setSettingsMode,
    setSaving,
    setError,
    clearPendingResumeState,
    setFriendsError,
    setFriendGameError
}: UseAccountActionsArgs) {
    const [factoryResetting, setFactoryResetting] = useState(false);
    const [addingUser, setAddingUser] = useState(false);
    const [switchingUser, setSwitchingUser] = useState(false);

    const activeUsernameRef = useLatestRef(username);
    const injectEnabledRef = useLatestRef(injectEmulatorLogin);
    const usersRef = useLatestRef(users);

    async function persistSettings(
        nextUsernameInput: string,
        nextApiKeyInput: string
    ): Promise<{ ok: true; showWelcome: boolean; username: string } | { ok: false; error: string }> {
        setSaving(true);
        setError(null);
        setFriendsError(null);

        try {
            const result = await saveSettings(nextUsernameInput, nextApiKeyInput);
            const showWelcome = !result.viewedIntro;
            const welcomeUsername = result.username;
            if (!mountedRef.current) {
                return { ok: true, showWelcome, username: welcomeUsername };
            }
            applySettings(result, { skipButtonToggles: true });
            setSettingsMode(false);
            await refreshGameData(true, false, t(language, "Refreshing Achievements..."), {
                username: result.username,
                hasApiKey: result.hasApiKey
            });
            return { ok: true, showWelcome, username: welcomeUsername };
        } catch (e: any) {
            logError("persistSettings", e);
            const message = getErrorMessage(e, t(language, "Invalid RetroAchievements username or Web API key. Please try again."));
            return { ok: false, error: message };
        } finally {
            if (mountedRef.current) {
                setSaving(false);
            }
        }
    }

    function openCredentialsModal() {
        showManagedModal((close) => (
            <CredentialsModal
                username={username}
                hasApiKey={hasApiKey}
                language={language}
                persistSettings={persistSettings}
                onShowWelcome={openSetupProfilesModal}
                close={close}
            />
        ));
    }

    function openScaleProfileModal() {
        showManagedModal((close) => (
            <WelcomeFollowupModal
                language={language}
                onApplyScalePreset={onApplyScalePreset}
                close={close}
            />
        ));
    }

    function openSetupProfilesModal(userName?: string) {
        const alreadyViewed = viewedIntro;
        void markIntroViewed().catch(() => {});
        setViewedIntro(true);
        showManagedModal((close) => (
            <WelcomeModal
                language={language}
                userName={userName ?? username}
                showPreserveToggle={alreadyViewed}
                onApplyProfile={async (profile, preserveOtherSettings) => {
                    await onApplySetupProfile(profile, preserveOtherSettings);
                    if (!alreadyViewed) {
                        try {
                            openScaleProfileModal();
                        } catch (e) {
                            logError("openScaleProfileModal", e);
                        }
                    }
                }}
                close={close}
            />
        ));
    }

    function openAddUserModal(opts?: { returnToSwitcher?: boolean }) {
        const returnToSwitcher = opts?.returnToSwitcher ?? false;
        showManagedModal((close) => {
            let latestUsers = usersRef.current;
            const dismiss = returnToSwitcher
                ? () => {
                    close();
                    openSwitchUserModal(latestUsers);
                }
                : close;
            return (
                <AddUserModal
                    language={language}
                    addUser={async (username, apiKey) => {
                        latestUsers = await onAddUser(username, apiKey);
                    }}
                    switchUser={onSwitchUser}
                    close={dismiss}
                    onBeforeNavigate={close}
                />
            );
        });
    }

    async function onToggleInject(next: boolean) {
        const result = await saveInjectEmulatorLogin(next);
        if (mountedRef.current) {
            setInjectEmulatorLogin(result.injectEmulatorLogin);
        }
    }

    async function onReinject() {
        return await reinjectActiveLogin();
    }

    function openConnectTokenModal(cardUsername: string, hardcore: boolean, hasToken: boolean) {
        showManagedModal((close) => {
            let latestUsers = usersRef.current;
            const backToSwitcher = () => {
                close();
                openSwitchUserModal(latestUsers);
            };
            return (
                <ConnectTokenModal
                    language={language}
                    username={cardUsername}
                    initialHardcore={hardcore}
                    hasToken={hasToken}
                    onGenerate={async (password, nextHardcore) => {
                        let result: { ok: boolean; error?: string; message?: string; users?: SavedUser[] };
                        try {
                            result = await generateConnectToken(cardUsername, password, nextHardcore);
                        } catch (err) {
                            logError("openConnectTokenModal generate", err);
                            result = { ok: false };
                        }
                        if (!result.ok) {
                            const message =
                                result.error === "network_error"
                                    ? t(language, "Could not reach RetroAchievements. Please try again.")
                                    : t(language, "Invalid credentials, please re-enter your password.");
                            throw new Error(message);
                        }
                        latestUsers = result.users ?? latestUsers;
                        if (mountedRef.current) {
                            setUsers(latestUsers);
                        }
                        backToSwitcher();
                    }}
                    onClear={async () => {
                        const result = await clearConnectLogin(cardUsername);
                        latestUsers = result.users;
                        if (mountedRef.current) {
                            setUsers(result.users);
                        }
                    }}
                    close={() => backToSwitcher()}
                />
            );
        });
    }

    function openSwitchUserModal(overrideUsers?: SavedUser[]) {
        const list = overrideUsers ?? usersRef.current;
        showManagedModal((close) => (
            <SwitchUserModal
                users={list}
                activeUsername={activeUsernameRef.current}
                language={language}
                onSwitchUser={onSwitchUser}
                onRemoveUser={onRemoveUser}
                injectEnabled={injectEnabledRef.current}
                onToggleInject={onToggleInject}
                onManageCredentials={(cardUsername, hardcore, hasToken) => {
                    close();
                    openConnectTokenModal(cardUsername, hardcore, hasToken);
                }}
                onAddAccount={() => {
                    close();
                    openAddUserModal({ returnToSwitcher: true });
                }}
                onReinject={onReinject}
                close={close}
            />
        ));
    }

    function openLanguageModal() {
        showManagedModal((close) => (
            <LanguageModal
                language={language}
                onSelectLanguage={onSelectLanguage}
                close={close}
            />
        ));
    }

    async function onClearApiKey() {
        setSaving(true);
        setError(null);
        setFriendsError(null);
        try {
            await clearApiKey();
            if (!mountedRef.current) {
                return;
            }
            setHasApiKey(false);
            setView("achievements");
            setPendingFocusKey(null);
            setSettingsMode(true);
        } catch (e) {
            logError("onClearApiKey", e);
            if (mountedRef.current) {
                setError("Couldn't clear your saved API key.");
            }
        } finally {
            if (mountedRef.current) {
                setSaving(false);
            }
        }
    }

    async function onFactoryReset() {
        setFactoryResetting(true);
        setError(null);
        setFriendsError(null);
        setFriendGameError(null);

        try {
            await factoryReset();
            if (!mountedRef.current) {
                return;
            }

            wipeFrontendMirrors();

            clearPendingResumeState();

            setView("achievements");
            setPendingFocusKey(null);

            const fresh = await getSettings();
            if (!mountedRef.current) {
                return;
            }
            applySettings(fresh, {});

            setSettingsMode(true);
        } catch (e: any) {
            logError("onFactoryReset", e);
            if (mountedRef.current) {
                setError(String(e?.message || e || "Couldn't run the factory reset."));
            }
        } finally {
            if (mountedRef.current) {
                setFactoryResetting(false);
            }
        }
    }

    async function onAddUser(newUsername: string, apiKey: string): Promise<SavedUser[]> {
        setAddingUser(true);
        try {
            const result = await addUser(newUsername, apiKey);
            if (mountedRef.current) {
                setUsers(result.users);
            }
            return result.users;
        } finally {
            if (mountedRef.current) {
                setAddingUser(false);
            }
        }
    }

    async function onRemoveUser(targetUsername: string): Promise<SavedUser[]> {
        const result = await removeUser(targetUsername);
        if (mountedRef.current) {
            setUsers(result.users);
        }
        return result.users;
    }

    async function onSwitchUser(targetUsername: string): Promise<SwitchUserOutcome> {

        let outcome: SwitchUserOutcome = "error";

        await runClearWithSpinner(
            "options:switch-user",
            setSwitchingUser,
            "onSwitchUser",
            "Couldn't switch accounts.",
            async () => {
                let result: SwitchUserResult;
                try {
                    result = await switchUser(targetUsername);
                } catch (e: any) {
                    logError("onSwitchUser", e);
                    outcome = "error";
                    return;
                }

                if (!result.ok && result.error === "emulator-running") {
                    outcome = "emulator-running";
                    return;
                }

                if (!result.ok) {
                    outcome = "network-error";
                    return;
                }

                outcome = result.credentialsRejected ? "credentials-rejected" : "switched";

                if (!mountedRef.current) {
                    return;
                }

                await clearResumeState();
                if (!mountedRef.current) {
                    return;
                }

                wipeFrontendMirrors();

                applySettings(result, { skipButtonToggles: true });

                await refreshGameData(true, false, t(language, "Refreshing Achievements..."));
            }
        );

        return outcome;
    }

    return {
        factoryResetting,
        addingUser,
        switchingUser,
        openCredentialsModal,
        openSetupProfilesModal,
        openAddUserModal,
        openSwitchUserModal,
        openLanguageModal,
        onClearApiKey,
        onFactoryReset
    };
}
