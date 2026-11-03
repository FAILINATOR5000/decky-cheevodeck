import { addEventListener, removeEventListener } from "@decky/api";
import { useCallback, useEffect, useState } from "react";

import { multiplayerFriendAvatars, multiplayerFriends } from "../api";
import type { MultiplayerFriendsState } from "../types";
import { logError } from "../utils/errors";

const FRIENDS_EVENT = "cheevodeck_multiplayer_friends";
const OPEN_TICK_MS = 8000;
const IDLE_TICK_MS = 30000;

const avatarMemory = new Map<string, string>();

export function useMultiplayerFriendsController({ isActive, tabOpen, seatPics }: {
    isActive: boolean;
    tabOpen: boolean;
    seatPics: string[];
}) {
    const [data, setData] = useState<MultiplayerFriendsState | null>(null);
    const [avatars, setAvatars] = useState<Record<string, string>>(() => Object.fromEntries(avatarMemory));

    const load = useCallback(async () => {
        try {
            setData(await multiplayerFriends());
        }
        catch (e) {
            logError("multiplayerFriends", e);
        }
    }, []);

    useEffect(() => {
        if (!isActive) {
            return;
        }
        void load();
        const onChanged = () => {
            void load();
        };
        addEventListener(FRIENDS_EVENT, onChanged);
        const timer = window.setInterval(onChanged, tabOpen ? OPEN_TICK_MS : IDLE_TICK_MS);
        return () => {
            removeEventListener(FRIENDS_EVENT, onChanged);
            window.clearInterval(timer);
        };
    }, [isActive, tabOpen, load]);

    const wanted = [
        ...(data?.friends ?? []).map((row) => row.pic),
        ...(data?.requests ?? []).map((row) => row.pic),
        ...(data?.suggestions ?? []).map((row) => row.pic),
        data?.selfPic ?? "",
        ...seatPics
    ].filter((pic, index, all) => pic && !avatarMemory.has(pic) && all.indexOf(pic) === index);
    const wantedKey = wanted.join("|");

    useEffect(() => {
        if (!isActive || wanted.length === 0) {
            return;
        }
        void (async () => {
            try {
                const fetched = (await multiplayerFriendAvatars(wanted)).avatars ?? {};
                for (const pic of wanted) {
                    avatarMemory.set(pic, fetched[pic] ?? "");
                }
                setAvatars(Object.fromEntries(avatarMemory));
            }
            catch (e) {
                logError("multiplayerFriendAvatars", e);
            }
        })();
    }, [isActive, wantedKey]);

    return {
        state: { data, avatars },
        actions: { reload: load }
    };
}
