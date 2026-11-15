import { useRef } from "react";

import { MODAL_ECHO_WINDOW_MS, modalEchoPending } from "../utils/modalRegistry";
import { playBackSound } from "../utils/navSound";

export function useModalBack(stepBack: () => boolean, close: () => void): () => void {
    const lastAtRef = useRef(0);
    return () => {
        const now = Date.now();
        if (now - lastAtRef.current < MODAL_ECHO_WINDOW_MS || modalEchoPending()) {
            return;
        }
        lastAtRef.current = now;
        if (stepBack()) {
            playBackSound();
            return;
        }
        close();
    };
}
