import { createContext, useContext, useState, type ReactNode } from "react";
import { useMultiplayerController } from "../../hooks/useMultiplayerController";
import { useMultiplayerFriendsController } from "../../hooks/useMultiplayerFriendsController";
import type { MultiplayerTab } from "../../types";
import { multiplayerChoices, rememberMultiplayerPage } from "../../utils/multiplayerChoices";

type Multiplayer = ReturnType<typeof useMultiplayerController> & {
    friends: ReturnType<typeof useMultiplayerFriendsController>;
    page: {
        tab: MultiplayerTab;
        conversation: string | null;
        show: (tab: MultiplayerTab, conversation?: string | null) => void;
    };
};

const MultiplayerContext = createContext<Multiplayer | null>(null);

export function MultiplayerProvider(props: {
    isActive: boolean;
    children: ReactNode;
}) {
    const multiplayer = useMultiplayerController({ isActive: props.isActive });
    const [tab, setTab] = useState<MultiplayerTab>(() => multiplayerChoices().page);
    const [conversation, setConversation] = useState<string | null>(() => multiplayerChoices().conversation);
    const room = multiplayer.state.hosted?.seats.map((seat) => seat?.pic ?? "")
        ?? multiplayer.state.joined?.status?.ids.map((entry) => entry.pic)
        ?? [];
    const friends = useMultiplayerFriendsController({
        isActive: props.isActive,
        tabOpen: props.isActive && tab === "friends",
        seatPics: room
    });

    function show(next: MultiplayerTab, nextConversation: string | null = null) {
        rememberMultiplayerPage(next, nextConversation);
        setTab(next);
        setConversation(next === "friends" ? nextConversation : null);
    }

    return (
        <MultiplayerContext.Provider value={{ ...multiplayer, friends, page: { tab, conversation, show } }}>
            {props.children}
        </MultiplayerContext.Provider>
    );
}

export function useMultiplayer(): Multiplayer {
    return useContext(MultiplayerContext)!;
}
