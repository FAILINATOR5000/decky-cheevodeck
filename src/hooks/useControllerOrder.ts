import { useEffect, useRef, useState } from "react";
import { logError } from "../utils/errors";
import {
    gameRunning,
    onDeckBattery,
    onSteamPadsChanged,
    pingSteamPad,
    readSteamPads,
    swapSteamPads,
    type DeckBattery,
    type SteamPad
} from "../utils/steamControllers";

const NO_PADS: SteamPad[] = [];

export function useControllerOrder(active: boolean) {
    const [pads, setPads] = useState<SteamPad[]>(NO_PADS);
    const [settled, setSettled] = useState(false);
    const [inGame, setInGame] = useState(false);
    const [deckBattery, setDeckBattery] = useState<DeckBattery | null>(null);
    const readRef = useRef<() => void>(() => { });

    useEffect(() => {
        if (!active) {
            setSettled(false);
            return;
        }
        let live = true;
        let latest = 0;
        const read = async () => {
            const seq = ++latest;
            let next: SteamPad[] | null = null;
            try {
                next = await readSteamPads();
            }
            catch (e) {
                logError("reading Steam's controller list", e);
            }
            if (!live || seq !== latest) {
                return;
            }
            setPads(next ?? NO_PADS);
            setInGame(gameRunning());
            setSettled(true);
        };
        readRef.current = () => {
            void read();
        };
        void read();
        const stop = onSteamPadsChanged(() => {
            void read();
        });
        const stopDeck = onDeckBattery((battery) => {
            if (live) {
                setDeckBattery(battery);
            }
        });
        return () => {
            live = false;
            readRef.current = () => { };
            stop();
            stopDeck();
        };
    }, [active]);

    const shown = deckBattery === null
        ? pads
        : pads.map((pad) => (pad.builtIn ? { ...pad, battery: deckBattery.level, charging: deckBattery.charging } : pad));

    const move = (index: number, step: -1 | 1) => {
        const at = pads.findIndex((pad) => pad.index === index);
        const neighbor = at < 0 ? undefined : pads[at + step];
        if (!neighbor) {
            return;
        }
        try {
            swapSteamPads(pads[at].slot, neighbor.slot);
        }
        catch (e) {
            logError("swapping Steam's controller order", e);
        }
        readRef.current();
    };

    const ping = (index: number) => {
        try {
            pingSteamPad(index);
        }
        catch (e) {
            logError("identifying a controller", e);
        }
    };

    return { pads: shown, settled, inGame, move, ping };
}
