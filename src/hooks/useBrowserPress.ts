import { logFocusDebug } from "../api";

type PressEvent = { detail?: number };

type PressProps = {
    onMouseDown: (event?: { preventDefault?: () => void }) => void;
    onClick: (event?: PressEvent) => void;
    onOKButton: (event?: PressEvent) => boolean;
};

export type PressAct = (key: string, run: () => void) => PressProps;

export function useBrowserPress(): PressAct {
    return (key: string, run: () => void) => {
        const fire = (event?: PressEvent) => {
            logFocusDebug("browser-press", key, `detail=${event?.detail}`);
            run();
        };

        return {
            onMouseDown: (event?: { preventDefault?: () => void }) => event?.preventDefault?.(),
            onClick: fire,
            onOKButton: (event?: PressEvent) => {
                fire(event);
                return true;
            }
        };
    };
}
