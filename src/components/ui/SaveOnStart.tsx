import { Focusable } from "@decky/ui";
import type { ReactNode } from "react";
import { playOkSound } from "../../utils/navSound";

type SaveOnStartProps = {
    canSave: boolean;
    label: string;
    onSave: () => void;
    children: ReactNode;
};

export function SaveOnStart(props: SaveOnStartProps) {
    const { canSave, label, onSave, children } = props;

    function handleMenu() {
        playOkSound();
        onSave();
    }

    return (
        <Focusable
            onMenuButton={canSave ? handleMenu : undefined}
            onMenuActionDescription={canSave ? label : undefined}
        >
            {children}
        </Focusable>
    );
}
