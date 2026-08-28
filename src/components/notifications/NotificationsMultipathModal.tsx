import { useEffect, useRef, useState } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import {
    cacheAchievementIcons,
    getAchievementIcons,
    getCachedAchievementIcons,
    getCachedGameIconDataUri,
    getGameIconCached,
    isGameIconBatchPending,
    prefetchGameIcons,
    prefetchUserAvatars,
    subscribeToAchievementIcon,
    subscribeToGameIcon
} from "../../api";
import { FadeImage } from "../ui/FadeImage";
import { UserAvatar } from "../ui/UserAvatar";
import { logError } from "../../utils/errors";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import type { LanguageCode } from "../../locales";
import { FADE_IN_KEYFRAMES } from "../../utils/style";

type MultipathOptionIcon =
    | { kind: "avatar"; username: string }
    | { kind: "game"; gameId: number; imageIcon: string | null }
    | { kind: "badge"; gameId: number; badgeName: string }
    | { kind: "none" };

export type MultipathOption = {
    label: string;
    icon: MultipathOptionIcon;
    onSelect: () => void;
};

export type NotificationsMultipathModalProps = {
    options: MultipathOption[];
    showIcons: boolean;
    language: LanguageCode;
    close: () => void;
};

const ROW_ICON_BOX = 32;
const ROW_ICON_FONT = 16;

function MultipathOptionRow(props: {
    option: MultipathOption;
    showIcons: boolean;
    onSelect: () => void;
}) {
    const { option, showIcons, onSelect } = props;
    const icon = option.icon;

    const iconKind = icon.kind;
    const iconGameId = icon.kind === "game" || icon.kind === "badge" ? icon.gameId : null;
    const iconImage = icon.kind === "game" ? icon.imageIcon : null;
    const iconBadge = icon.kind === "badge" ? icon.badgeName : "";

    const [iconUri, setIconUri] = useState<string | null>(function seedFromCache() {
        if (!showIcons || iconGameId == null) {
            return null;
        }
        if (iconKind === "game") {
            return getCachedGameIconDataUri(iconGameId);
        }
        if (iconKind === "badge" && iconBadge) {
            return getCachedAchievementIcons(iconGameId, [iconBadge])[iconBadge] ?? null;
        }
        return null;
    });

    const hadIconAtMount = useRef(iconUri !== null);

    useEffect(function resolveRowIcon() {
        if (!showIcons || iconUri || iconGameId == null) {
            return;
        }
        let cancelled = false;
        let backupTimer: ReturnType<typeof setTimeout> | null = null;

        if (iconKind === "game") {
            const url = iconImage;
            let retryTimer: ReturnType<typeof setTimeout> | null = null;

            async function fetchGameIconOnce(): Promise<string | null> {
                try {
                    const result = await getGameIconCached(iconGameId, url);
                    if (cancelled) {
                        return null;
                    }
                    if (result?.dataUri) {
                        setIconUri(result.dataUri);
                        return result.dataUri;
                    }
                    return null;
                }
                catch (e) {
                    logError("multipath chooser game icon", e);
                    return null;
                }
            }

            const unsubscribe = subscribeToGameIcon(iconGameId, (dataUri) => {
                if (cancelled) {
                    return;
                }
                if (dataUri) {
                    setIconUri(dataUri);
                    return;
                }
                void (async () => {
                    const got = await fetchGameIconOnce();
                    if (got || cancelled || !url) {
                        return;
                    }
                    retryTimer = setTimeout(() => {
                        retryTimer = null;
                        void fetchGameIconOnce();
                    }, 1500);
                })();
            });
            backupTimer = setTimeout(() => {
                backupTimer = null;
                if (cancelled) {
                    return;
                }
                const warmed = getCachedGameIconDataUri(iconGameId);
                if (warmed) {
                    setIconUri(warmed);
                    return;
                }
                if (isGameIconBatchPending(iconGameId)) {
                    return;
                }
                void (async () => {
                    const first = await fetchGameIconOnce();
                    if (first || cancelled || !url) {
                        return;
                    }
                    retryTimer = setTimeout(() => {
                        retryTimer = null;
                        void fetchGameIconOnce();
                    }, 1500);
                })();
            }, 500);

            return () => {
                cancelled = true;
                unsubscribe();
                if (backupTimer !== null) {
                    clearTimeout(backupTimer);
                }
                if (retryTimer !== null) {
                    clearTimeout(retryTimer);
                }
            };
        }

        if (iconKind === "badge" && iconBadge) {
            const unsubscribe = subscribeToAchievementIcon(iconGameId, iconBadge, (dataUri) => {
                if (cancelled || !dataUri) {
                    return;
                }
                setIconUri(dataUri);
            });
            backupTimer = setTimeout(() => {
                backupTimer = null;
                if (cancelled) {
                    return;
                }
                const warmed = getCachedAchievementIcons(iconGameId, [iconBadge])[iconBadge];
                if (warmed) {
                    setIconUri(warmed);
                    return;
                }
                void (async () => {
                    try {
                        const result = await getAchievementIcons(iconGameId, [iconBadge]);
                        if (cancelled) {
                            return;
                        }
                        const dataUri = result?.icons?.[iconBadge] ?? "";
                        if (dataUri) {
                            cacheAchievementIcons(iconGameId, { [iconBadge]: dataUri });
                            setIconUri(dataUri);
                        }
                    }
                    catch (e) {
                        logError("multipath chooser achievement icon", e);
                    }
                })();
            }, 500);

            return () => {
                cancelled = true;
                unsubscribe();
                if (backupTimer !== null) {
                    clearTimeout(backupTimer);
                }
            };
        }

        return;
    }, [showIcons, iconKind, iconGameId, iconImage, iconBadge, iconUri]);

    function renderRowIcon() {
        if (icon.kind === "avatar") {
            return (
                <UserAvatar
                    username={icon.username}
                    size={ROW_ICON_BOX}
                    fontSize={ROW_ICON_FONT}
                />
            );
        }
        return (
            <div
                style={{
                    width: `${ROW_ICON_BOX}px`,
                    height: `${ROW_ICON_BOX}px`,
                    borderRadius: "7px",
                    overflow: "hidden",
                    flexShrink: 0,
                    background: "rgba(255,255,255,0.10)",
                    border: "1px solid rgba(255,255,255,0.12)"
                }}
            >
                {iconUri ? (
                    <FadeImage
                        src={iconUri}
                        fadeOnLoad={!hadIconAtMount.current}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                ) : null}
            </div>
        );
    }

    return (
        <DialogButton
            onClick={onSelect}
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                gap: "12px",
                width: "100%",
                textAlign: "left"
            }}
        >
            {showIcons && renderRowIcon()}
            <span style={{ minWidth: 0, wordBreak: "break-word" }}>
                {option.label}
            </span>
        </DialogButton>
    );
}

export function NotificationsMultipathModal(props: NotificationsMultipathModalProps) {
    const { options, showIcons, language, close } = props;

    useEffect(function warmChooserIcons() {
        if (!showIcons) {
            return;
        }
        const gameRows: Array<{ gameId: number; imageIcon: string | null }> = [];
        const avatarNames: string[] = [];
        const badgesByGame = new Map<number, string[]>();
        for (const option of options) {
            const icon = option.icon;
            if (icon.kind === "game") {
                gameRows.push({ gameId: icon.gameId, imageIcon: icon.imageIcon });
            }
            else if (icon.kind === "avatar") {
                if (icon.username.trim()) {
                    avatarNames.push(icon.username);
                }
            }
            else if (icon.kind === "badge" && icon.badgeName) {
                const list = badgesByGame.get(icon.gameId);
                if (list) {
                    list.push(icon.badgeName);
                }
                else {
                    badgesByGame.set(icon.gameId, [icon.badgeName]);
                }
            }
        }
        if (gameRows.length > 0) {
            void prefetchGameIcons(gameRows);
        }
        if (avatarNames.length > 0) {
            void prefetchUserAvatars(avatarNames);
        }
        if (badgesByGame.size > 0) {
            void (async () => {
                for (const [badgeGameId, badgeNames] of badgesByGame) {
                    const cached = getCachedAchievementIcons(badgeGameId, badgeNames);
                    const missing = badgeNames.filter((name) => !cached[name]);
                    if (missing.length === 0) {
                        continue;
                    }
                    try {
                        const result = await getAchievementIcons(badgeGameId, missing);
                        cacheAchievementIcons(badgeGameId, result?.icons ?? {});
                    }
                    catch (e) {
                        logError("multipath chooser badge warm", e);
                    }
                }
            })();
        }
    }, [options, showIcons]);

    function handleSelect(option: MultipathOption) {
        option.onSelect();
        close();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <style>{FADE_IN_KEYFRAMES}</style>
            <Focusable
                flow-children="column"
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px"
                }}
            >
                {options.map((option) => (
                    <MultipathOptionRow
                        key={option.label}
                        option={option}
                        showIcons={showIcons}
                        onSelect={() => handleSelect(option)}
                    />
                ))}
            </Focusable>
        </ModalRoot>
    );
}
