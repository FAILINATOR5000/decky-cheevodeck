import { useEffect, useState } from "react";

import {
    addSubscription,
    getAchievementComments,
    getGameComments,
    getSubscriptions,
    removeSubscription
} from "../api";
import { t, type LanguageCode } from "../locales";
import { logError } from "../utils/errors";
import type { AddSubscriptionPayload, SubscriptionKind } from "../types";

const SEED_FETCH_COUNT = 10;

type ThreadSubscriptionArgs = {
    language: LanguageCode;
    kind: SubscriptionKind;
    id: number | null;
    buildEntry: () => AddSubscriptionPayload | null;
};

export function useThreadSubscription(args: ThreadSubscriptionArgs) {
    const { language, kind, id, buildEntry } = args;

    const [isSubscribed, setIsSubscribed] = useState(false);
    const [subscribeError, setSubscribeError] = useState<string | null>(null);

    useEffect(() => {
        if (id == null) {
            setIsSubscribed(false);
            return;
        }
        let live = true;
        void (async () => {
            try {
                const result = await getSubscriptions();
                if (!live) {
                    return;
                }
                const followed = (result?.subscriptions ?? []).some(
                    (entry) => entry.kind === kind && entry.id === id
                );
                setIsSubscribed(followed);
                setSubscribeError(null);
            } catch {
                if (live) {
                    setIsSubscribed(false);
                }
            }
        })();
        return () => {
            live = false;
        };
    }, [kind, id]);

    async function withTrustedSeed(entry: AddSubscriptionPayload): Promise<AddSubscriptionPayload> {
        if (entry.seedLoaded && entry.seedSort === "newest") {
            return entry;
        }
        if (entry.seedLoaded && (entry.seedComments?.length ?? 0) === 0) {
            return entry;
        }
        if (id == null) {
            return entry;
        }
        try {
            const response = kind === "achievement"
                ? await getAchievementComments(id, "newest", 0, SEED_FETCH_COUNT)
                : await getGameComments(id, "newest", 0, SEED_FETCH_COUNT);
            if (!response || response.needsSettings || response.error) {
                return { ...entry, seedLoaded: false };
            }
            return {
                ...entry,
                seedComments: response.comments ?? [],
                seedSort: "newest",
                seedLoaded: true
            };
        }
        catch (e) {
            logError("withTrustedSeed", e);
            return { ...entry, seedLoaded: false };
        }
    }

    async function onToggleSubscribe() {
        if (id == null) {
            return;
        }
        try {
            if (isSubscribed) {
                const result = await removeSubscription(kind, id);
                if (result?.ok) {
                    setIsSubscribed(false);
                    setSubscribeError(null);
                }
                return;
            }

            const entry = buildEntry();
            if (!entry) {
                return;
            }
            const result = await addSubscription(await withTrustedSeed(entry));
            if (result?.ok || result?.alreadySubscribed) {
                setIsSubscribed(true);
                setSubscribeError(null);
            } else if (result?.error === "at_capacity") {
                setSubscribeError(t(language, "You can subscribe to up to 10 discussions."));
            }
        } catch {
        }
    }

    return { isSubscribed, subscribeError, onToggleSubscribe };
}
