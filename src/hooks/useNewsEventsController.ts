import { useCallback, useEffect, useRef, useState } from "react";
import { getAchievementOfTheWeek, getNewSetsAndRevisions, getNewsFeed, prefetchGameIcons, prefetchUserAvatars } from "../api";
import type {
    AchievementOfTheWeekResponse,
    AotwSubView,
    NewSetsAndRevisionsResponse,
    NewSetsFilter,
    NewsEntry,
    NewsEventsSubView
} from "../types";
import { takeAotwCarry } from "../utils/commentsSnapshot";

export type UseNewsEventsControllerOptions = {
    isActive: boolean;
};

export function useNewsEventsController(options: UseNewsEventsControllerOptions) {
    const { isActive } = options;

    const [subView, setSubView] = useState<NewsEventsSubView>("news");

    const [newsPayload, setNewsPayload] = useState<NewsEntry[] | null>(null);
    const [newsLoading, setNewsLoading] = useState(false);
    const [newsError, setNewsError] = useState<string | null>(null);

    const [aotwResponse, setAotwResponse] = useState<AchievementOfTheWeekResponse | null>(takeAotwCarry);
    const [aotwSubView, setAotwSubView] = useState<AotwSubView>("unlocks");
    const [aotwLoading, setAotwLoading] = useState(false);
    const [aotwError, setAotwError] = useState<string | null>(null);

    const [newSetsResponse, setNewSetsResponse] = useState<NewSetsAndRevisionsResponse | null>(null);
    const [newSetsFilter, setNewSetsFilter] = useState<NewSetsFilter>("new");
    const [newSetsLoading, setNewSetsLoading] = useState(false);
    const [newSetsError, setNewSetsError] = useState<string | null>(null);

    const fetchRunIdRef = useRef(0);
    const aotwFetchRunIdRef = useRef(0);
    const newSetsFetchRunIdRef = useRef(0);

    const loadNews = useCallback(async () => {
        const runId = fetchRunIdRef.current + 1;
        fetchRunIdRef.current = runId;
        setNewsLoading(true);
        setNewsError(null);

        try {
            const result = await getNewsFeed();
            if (fetchRunIdRef.current !== runId) {
                return;
            }
            if (result.payload) {
                setNewsPayload(result.payload);
            }
            if (result.error) {
                setNewsError(result.error);
            }
            setNewsLoading(false);
        } catch (error: any) {
            if (fetchRunIdRef.current !== runId) {
                return;
            }
            setNewsError(String(error?.message || error || "Couldn't load news."));
            setNewsLoading(false);
        }
    }, []);

    const loadAotw = useCallback(async () => {
        const runId = aotwFetchRunIdRef.current + 1;
        aotwFetchRunIdRef.current = runId;
        setAotwLoading(true);
        setAotwError(null);

        try {
            const result = await getAchievementOfTheWeek();
            if (aotwFetchRunIdRef.current !== runId) {
                return;
            }
            if (result.payload || (result.comments && result.comments.length > 0)) {
                setAotwResponse(result);
                const unlockNames = (result.payload?.unlocks ?? []).map((unlock) => unlock.user);
                void prefetchUserAvatars(unlockNames);
            }
            if (result.error) {
                setAotwError(result.error);
            }
            setAotwLoading(false);
        } catch (error: any) {
            if (aotwFetchRunIdRef.current !== runId) {
                return;
            }
            setAotwError(String(error?.message || error || "Couldn't load the Achievement of the Week."));
            setAotwLoading(false);
        }
    }, []);

    const loadNewSets = useCallback(async (filter: NewSetsFilter) => {
        const runId = newSetsFetchRunIdRef.current + 1;
        newSetsFetchRunIdRef.current = runId;
        setNewSetsLoading(true);
        setNewSetsError(null);

        try {
            const result = await getNewSetsAndRevisions(filter);
            if (newSetsFetchRunIdRef.current !== runId) {
                return;
            }
            if (result.payload) {
                setNewSetsResponse(result);
                const rows = result.payload ?? [];
                const iconEntries = rows
                    .filter((r) => r.gameId != null)
                    .map((r) => ({ gameId: r.gameId as number, imageIcon: r.gameIcon ?? null }));
                void prefetchGameIcons(iconEntries);
                void prefetchUserAvatars(rows.map((r) => r.user));
            }
            if (result.error) {
                setNewSetsError(result.error);
            }
            setNewSetsLoading(false);
        } catch (error: any) {
            if (newSetsFetchRunIdRef.current !== runId) {
                return;
            }
            setNewSetsError(String(error?.message || error || "Couldn't load new sets."));
            setNewSetsLoading(false);
        }
    }, []);

    const changeNewSetsFilter = (next: NewSetsFilter) => {
        setNewSetsFilter(next);
        void loadNewSets(next);
    };

    useEffect(() => {
        if (!isActive) {
            return;
        }
        if (subView !== "news") {
            return;
        }
        if (newsPayload) {
            return;
        }
        void loadNews();
    }, [isActive, subView, newsPayload, loadNews]);

    useEffect(() => {
        if (!isActive) {
            return;
        }
        if (subView !== "aotw") {
            return;
        }
        if (aotwResponse) {
            return;
        }
        void loadAotw();
    }, [isActive, subView, aotwResponse, loadAotw]);

    const newSetsFilterRef = useRef<NewSetsFilter>(newSetsFilter);
    useEffect(() => {
        newSetsFilterRef.current = newSetsFilter;
    }, [newSetsFilter]);

    useEffect(() => {
        if (!isActive) {
            return;
        }
        if (subView !== "newSets") {
            return;
        }
        if (newSetsResponse) {
            return;
        }
        void loadNewSets(newSetsFilterRef.current);
    }, [isActive, subView, newSetsResponse, loadNewSets]);

    const subViewRef = useRef<NewsEventsSubView>(subView);
    const aotwSubViewRef = useRef<AotwSubView>(aotwSubView);

    useEffect(() => {
        subViewRef.current = subView;
    }, [subView]);

    useEffect(() => {
        aotwSubViewRef.current = aotwSubView;
    }, [aotwSubView]);

    return {
        state: {
            subView,
            newsPayload,
            newsLoading,
            newsError,
            aotwResponse,
            aotwSubView,
            aotwLoading,
            aotwError,
            newSetsResponse,
            newSetsFilter,
            newSetsLoading,
            newSetsError
        },
        actions: {
            setSubView,
            setAotwSubView,
            setNewSetsFilter,
            changeNewSetsFilter,
            loadNewSets
        },
        refs: {
            subViewRef,
            aotwSubViewRef,
            newSetsFilterRef
        }
    };
}
