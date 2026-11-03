import { createContext, useContext, useState, type ReactNode } from "react";
import { useMultiplayerController } from "../../hooks/useMultiplayerController";
import { useMultiplayerFriendsController } from "../../hooks/useMultiplayerFriendsController";
import type { MultiplayerTab } from "../../types";
import { multiplayerChoices, rememberMultiplayerPage } from "../../utils/multiplayerChoices";

type Multiplayer = ReturnType<typeof useMultiplayerController> & {
    friends: ReturnType<typeof useMultiplayerFriendsController>;
    page: {
        tab: MultiplayerTab;
        show: (tab: MultiplayerTab) => void;
    };
};

const MultiplayerContext = createContext<Multiplayer | null>(null);

export function MultiplayerProvider(props: {
    isActive: boolean;
    children: ReactNode;
}) {
    const multiplayer = useMultiplayerController({ isActive: props.isActive });
    const [tab, setTab] = useState<MultiplayerTab>(() => multiplayerChoices().page);
    const room = multiplayer.state.hosted?.seats.map((seat) => seat?.pic ?? "")
        ?? multiplayer.state.joined?.status?.ids.map((entry) => entry.pic)
        ?? [];
    const friends = useMultiplayerFriendsController({
        isActive: props.isActive,
        tabOpen: props.isActive && tab === "friends",
        seatPics: room
    });

    function show(next: MultiplayerTab) {
        rememberMultiplayerPage(next);
        setTab(next);
    }

    return (
        <MultiplayerContext.Provider value={{ ...multiplayer, friends, page: { tab, show } }}>
            {props.children}
        </MultiplayerContext.Provider>
    );
}

export function useMultiplayer(): Multiplayer {
    return useContext(MultiplayerContext)!;
}
