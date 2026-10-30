import { createContext, useContext, type ReactNode } from "react";
import { useMultiplayerController } from "../../hooks/useMultiplayerController";

type Multiplayer = ReturnType<typeof useMultiplayerController>;

const MultiplayerContext = createContext<Multiplayer | null>(null);

export function MultiplayerProvider(props: {
    isActive: boolean;
    children: ReactNode;
}) {
    const multiplayer = useMultiplayerController({ isActive: props.isActive });
    return (
        <MultiplayerContext.Provider value={multiplayer}>
            {props.children}
        </MultiplayerContext.Provider>
    );
}

export function useMultiplayer(): Multiplayer {
    return useContext(MultiplayerContext)!;
}
