import { DialogButton, Focusable, ModalRoot } from "@decky/ui";

import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { useEffect, useState } from "react";
import { CornerProbe } from "../ui/CornerProbe";
import { FocusableItem } from "../ui/FocusableItem";
import { ToggleRow } from "../ui/ToggleRow";
import { UserAvatar } from "../ui/UserAvatar";
import { ErrorText } from "../ui/ErrorText";
import { getSettings, logInjectDebug, prefetchUserAvatars } from "../../api";
import { formatUnlockDate } from "../../utils/achievements";
import { FADE_IN_KEYFRAMES, modalBodyStyle } from "../../utils/style";
import { modalSize } from "../../utils/scale";
import { localizeRuntimeText, t, type LanguageCode } from "../../locales";
import type { SavedUser } from "../../types";

export type SwitchUserOutcome =
    | "switched"
    | "credentials-rejected"
    | "network-error"
    | "error"
    | "emulator-running";

export type SwitchUserModalProps = {
    users: SavedUser[];
    activeUsername: string;
    language: LanguageCode;
    onSwitchUser: (username: string) => Promise<SwitchUserOutcome>;
    onRemoveUser: (username: string) => Promise<SavedUser[]>;
    injectEnabled: boolean;
    onToggleInject: (next: boolean) => void | Promise<void>;
    onManageCredentials: (username: string, hardcore: boolean, hasToken: boolean) => void;
    onAddAccount: () => void;
    onReinject: () => Promise<{ ok: boolean; outcome?: string; error?: string; emulators?: string[] }>;
    close: () => void;
};

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function TrashIcon({ size = 15 }: { size?: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 448 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M170.5 51.6L151.5 80l145 0-19-28.4c-1.5-2.2-4-3.6-6.7-3.6l-93.7 0c-2.7 0-5.2 1.3-6.7 3.6zm147-26.6L354.2 80 368 80l48 0 8 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-8 0 0 304c0 44.2-35.8 80-80 80l-224 0c-44.2 0-80-35.8-80-80l0-304-8 0c-13.3 0-24-10.7-24-24s10.7-24 24-24l8 0 48 0 13.8 0 36.7-55c10.4-15.6 27.9-25 46.7-25l93.7 0c18.7 0 36.2 9.4 46.7 25zM80 128l0 304c0 17.7 14.3 32 32 32l224 0c17.7 0 32-14.3 32-32l0-304L80 128zm80 64l0 208c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-208c0-8.8 7.2-16 16-16s16 7.2 16 16zm80 0l0 208c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-208c0-8.8 7.2-16 16-16s16 7.2 16 16zm80 0l0 208c0 8.8-7.2 16-16 16s-16-7.2-16-16l0-208c0-8.8 7.2-16 16-16s16 7.2 16 16z" />
        </svg>
    );
}

// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
function KeyIcon({ size = 15 }: { size?: number }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M336 352c97.2 0 176-78.8 176-176S433.2 0 336 0S160 78.8 160 176c0 18.7 2.9 36.8 8.3 53.7L7 391c-4.5 4.5-7 10.6-7 17l0 80c0 13.3 10.7 24 24 24l80 0c13.3 0 24-10.7 24-24l0-40 40 0c13.3 0 24-10.7 24-24l0-40 40 0c6.4 0 12.5-2.5 17-7l33.3-33.3c16.9 5.4 35 8.3 53.7 8.3zM376 96a40 40 0 1 1 0 80 40 40 0 1 1 0-80z" />
        </svg>
    );
}

function lastUsedLabel(language: LanguageCode, lastSignedInAt: number): string {
    if (!lastSignedInAt) {
        return "";
    }
    const when = formatUnlockDate(new Date(lastSignedInAt * 1000).toISOString(), {}, language);
    if (!when) {
        return "";
    }
    return t(language, "last used {{when}}", { when });
}

export function SwitchUserModal(props: SwitchUserModalProps) {
    const {
        users,
        activeUsername,
        language,
        onSwitchUser,
        onRemoveUser,
        injectEnabled,
        onToggleInject,
        onManageCredentials,
        onAddAccount,
        onReinject,
        close
    } = props;

    const [rows, setRows] = useState<SavedUser[]>(users);
    const [armedUsername, setArmedUsername] = useState<string | null>(null);
    const [focusedUsername, setFocusedUsername] = useState<string | null>(null);
    const [busyUsername, setBusyUsername] = useState<string | null>(null);
    const [error, setError] = useState<{ username: string; message: string } | null>(null);
    const [signedInUsername, setSignedInUsername] = useState<string>(activeUsername);
    const [focusedCredsUsername, setFocusedCredsUsername] = useState<string | null>(null);
    const [injectOn, setInjectOn] = useState(injectEnabled);

    const prefetchKey = users.map((user) => user.username).join("|");
    useEffect(() => {
        void prefetchUserAvatars(users.map((user) => user.username));
    }, [prefetchKey]);

    useEffect(() => {
        void getSettings()
            .then((settings) => {
                if (settings?.username) {
                    setSignedInUsername(settings.username);
                }
                if (settings?.users) {
                    setRows(settings.users);
                }
            })
            .catch(() => { });
    }, []);

    function isActive(username: string): boolean {
        return username.trim().toLowerCase() === signedInUsername.trim().toLowerCase();
    }

    function handleCardPress(user: SavedUser) {
        if (busyUsername !== null) {
            return;
        }
        if (isActive(user.username)) {
            if (injectOn && user.hasConnectToken) {
                setError(null);
                setBusyUsername(user.username);
                void (async () => {
                    const result = await onReinject();
                    logInjectDebug(
                        "reinject-result",
                        user.username,
                        `ok=${result.ok} outcome=${result.outcome ?? "-"} error=${result.error ?? "-"}`
                    );
                    if (!result.ok && result.error === "emulator-running") {
                        setBusyUsername(null);
                        setError({ username: user.username, message: t(language, "Be sure to close your emulator first.") });
                        return;
                    }
                    close();
                })();
                return;
            }
            logInjectDebug(
                "reinject-skip",
                user.username,
                `injectOn=${injectOn} hasToken=${user.hasConnectToken}`
            );
            close();
            return;
        }
        setError(null);
        setBusyUsername(user.username);
        void (async () => {
            const outcome = await onSwitchUser(user.username);
            if (outcome === "switched") {
                close();
                return;
            }
            setBusyUsername(null);
            if (outcome === "credentials-rejected") {
                setSignedInUsername(user.username);
                setError({ username: user.username, message: t(language, "These credentials were rejected. Open Edit Credentials in Options to update this account's Web API key.") });
            } else if (outcome === "network-error") {
                setError({ username: user.username, message: t(language, "Could not reach RetroAchievements. Please try again.") });
            } else if (outcome === "emulator-running") {
                setError({ username: user.username, message: t(language, "Be sure to close your emulator first.") });
            } else {
                setError({ username: user.username, message: t(language, "Couldn't switch accounts.") });
            }
        })();
    }

    function handleTrashPress(user: SavedUser) {
        if (busyUsername !== null) {
            return;
        }
        setError(null);
        if (isActive(user.username)) {
            setError({
                username: user.username,
                message: rows.length > 1
                    ? t(language, "Switch to another account before removing the one you're signed into.")
                    : t(language, "You can't remove the only account you're signed into.")
            });
            return;
        }
        if (armedUsername !== user.username) {
            setArmedUsername(user.username);
            return;
        }
        setArmedUsername(null);
        void (async () => {
            try {
                const nextUsers = await onRemoveUser(user.username);
                setRows(nextUsers);
            } catch {
                setError({ username: user.username, message: t(language, "Couldn't remove that account. Try again.") });
            }
        })();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <style>{FADE_IN_KEYFRAMES}</style>
            <CornerProbe surface="modal:switch-user" />
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                {t(language, "User Accounts")}
            </div>
            <FocusableItem
                focusKey="switch-user:add-account"
                onClick={onAddAccount}
                disabled={busyUsername !== null}
            >
                {t(language, "Add User Account")}
            </FocusableItem>
            <ToggleRow
                label={t(language, "Inject account into emulators on switch or selection")}
                value={injectOn}
                onChange={(next) => {
                    setInjectOn(next);
                    void onToggleInject(next);
                }}
                bottomSeparator="none"
            />
            <div style={{ ...modalBodyStyle(), marginBottom: "12px" }}>
                {t(language, "Automatically logs you into RetroAchievements upon account selection or switching. Currently RetroArch, Dolphin, and PCSX2 are supported, while PPSSPP and DuckStation standalone emulators are not supported for this feature. For each account below, select the key icon to enter credentials to generate the token used to sign you in automatically. Also make sure to toggle the above option on.")}
            </div>
            {rows.length === 0 ? (
                <div style={{ ...modalBodyStyle(), padding: "8px 0" }}>
                    {t(language, "No saved accounts yet.")}
                </div>
            ) : (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                        maxHeight: "60vh",
                        overflowY: "auto"
                    }}
                >
                    {rows.map((user) => {
                        const active = isActive(user.username);
                        const armed = armedUsername === user.username;
                        const focused = focusedUsername === user.username;
                        const credsFocused = focusedCredsUsername === user.username;
                        const usedLine = lastUsedLabel(language, user.lastSignedInAt);
                        const rowError = error && error.username === user.username ? error.message : null;
                        return (
                            <Focusable
                                key={user.username}
                                flow-children="row"
                                style={{
                                    position: "relative",
                                    display: "flex",
                                    alignItems: "stretch",
                                    width: "100%",
                                    opacity: busyUsername !== null && busyUsername !== user.username ? 0.5 : 1
                                }}
                            >
                                <FocusableItem
                                    outerStyle={{ width: "100%", minWidth: 0 }}
                                    focusKey={`switch-user:card:${user.username}`}
                                    onClick={() => handleCardPress(user)}
                                    disabled={busyUsername !== null}
                                >
                                    <div
                                        style={{
                                            width: "100%",
                                            display: "flex",
                                            gap: "12px",
                                            alignItems: "center",
                                            paddingRight: "40px",
                                            minWidth: 0
                                        }}
                                    >
                                        <UserAvatar username={user.username} size={44} fontSize={18} />
                                        <div
                                            style={{
                                                flex: 1,
                                                minWidth: 0,
                                                display: "flex",
                                                flexDirection: "column",
                                                gap: "2px",
                                                textAlign: "left"
                                            }}
                                        >
                                            <div
                                                style={{
                                                    fontSize: `${modalSize(15)}px`,
                                                    fontWeight: 700,
                                                    minWidth: 0,
                                                    wordBreak: "break-word"
                                                }}
                                            >
                                                {user.username}
                                                {active && (
                                                    <span style={{ ...modalBodyStyle(), marginLeft: "8px" }}>
                                                        {t(language, "(signed in)")}
                                                    </span>
                                                )}
                                            </div>
                                            {usedLine && (
                                                <div style={{ ...modalBodyStyle(), wordBreak: "break-word" }}>
                                                    {usedLine}
                                                </div>
                                            )}
                                            {rowError && (
                                                <div style={{ marginTop: "2px" }}>
                                                    <ErrorText>{localizeRuntimeText(language, rowError)}</ErrorText>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </FocusableItem>

                                <Focusable
                                    flow-children="column"
                                    style={{
                                        position: "absolute",
                                        top: "11px",
                                        right: "6px",
                                        bottom: "11px",
                                        zIndex: 2,
                                        width: "32px",
                                        display: "flex",
                                        flexDirection: "column",
                                        justifyContent: "space-between"
                                    }}
                                >
                                    <DialogButton
                                        onClick={() => handleTrashPress(user)}
                                        onGamepadFocus={() => setFocusedUsername(user.username)}
                                        onGamepadBlur={() => {
                                            setFocusedUsername((current) => (current === user.username ? null : current));
                                            setArmedUsername((armedUser) => (armedUser === user.username ? null : armedUser));
                                        }}
                                        disabled={busyUsername !== null}
                                        style={{
                                            minWidth: 0,
                                            width: "32px",
                                            height: "32px",
                                            padding: 0,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            color: armed
                                                ? "rgba(255,255,255,0.98)"
                                                : focused
                                                    ? "rgba(24,24,24,0.98)"
                                                    : "rgba(255,255,255,0.92)",
                                            background: armed
                                                ? "rgba(220,38,38,0.92)"
                                                : focused
                                                    ? "rgba(255,255,255,0.96)"
                                                    : "rgba(24,24,24,0.78)",
                                            border: armed
                                                ? "1px solid rgba(255,255,255,0.9)"
                                                : focused
                                                    ? "1px solid rgba(255,255,255,1)"
                                                    : "1px solid rgba(255,255,255,0.36)",
                                            boxShadow: focused
                                                ? "0 0 0 2px rgba(255,255,255,0.78), 0 2px 8px rgba(0,0,0,0.45)"
                                                : armed
                                                    ? "0 0 0 2px rgba(220,38,38,0.65), 0 2px 8px rgba(0,0,0,0.45)"
                                                    : "0 2px 6px rgba(0,0,0,0.35)",
                                            transition: "background 120ms ease, box-shadow 120ms ease, color 120ms ease"
                                        }}
                                    >
                                        <TrashIcon size={15} />
                                    </DialogButton>
                                    <DialogButton
                                        onClick={() => onManageCredentials(user.username, user.hardcore, user.hasConnectToken)}
                                        onGamepadFocus={() => setFocusedCredsUsername(user.username)}
                                        onGamepadBlur={() => setFocusedCredsUsername((current) => (current === user.username ? null : current))}
                                        disabled={busyUsername !== null}
                                        style={{
                                            minWidth: 0,
                                            width: "32px",
                                            height: "32px",
                                            padding: 0,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            color: credsFocused
                                                ? "rgba(24,24,24,0.98)"
                                                : user.hasConnectToken
                                                    ? "rgba(120,200,255,0.95)"
                                                    : "rgba(255,255,255,0.45)",
                                            background: credsFocused
                                                ? "rgba(255,255,255,0.96)"
                                                : "rgba(24,24,24,0.78)",
                                            border: credsFocused
                                                ? "1px solid rgba(255,255,255,1)"
                                                : "1px solid rgba(255,255,255,0.36)",
                                            boxShadow: credsFocused
                                                ? "0 0 0 2px rgba(255,255,255,0.78), 0 2px 8px rgba(0,0,0,0.45)"
                                                : "0 2px 6px rgba(0,0,0,0.35)",
                                            transition: "background 120ms ease, box-shadow 120ms ease, color 120ms ease"
                                        }}
                                    >
                                        <KeyIcon size={15} />
                                    </DialogButton>
                                </Focusable>
                            </Focusable>
                        );
                    })}
                </div>
            )}
            <Focusable
                style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "8px",
                    marginTop: "16px"
                }}
                flow-children="row"
            >
                <DialogButton onClick={close} disabled={busyUsername !== null}>
                    {t(language, "Close")}
                </DialogButton>
            </Focusable>
        </ModalRoot>
    );
}
