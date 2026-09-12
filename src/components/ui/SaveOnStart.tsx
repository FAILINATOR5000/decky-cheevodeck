import { Focusable } from "@decky/ui";
import type { ReactNode } from "react";
import { playOkSound } from "../../utils/navSound";

type SaveOnStartProps = {
    canSave: boolean;
    label: string;
    onSave: () => void;
    onSecondaryButton?: () => void;
    onSecondaryActionDescription?: string;
    onOptionsButton?: () => void;
    onOptionsActionDescription?: string;
    children: ReactNode;
};

export function SaveOnStart(props: SaveOnStartProps) {
    const {
        canSave,
        label,
        onSave,
        onSecondaryButton,
        onSecondaryActionDescription,
        onOptionsButton,
        onOptionsActionDescription,
        children
    } = props;

    function handleMenu() {
        playOkSound();
        onSave();
    }

    return (
        <Focusable
            onMenuButton={canSave ? handleMenu : undefined}
            onMenuActionDescription={canSave ? label : undefined}
            onSecondaryButton={onSecondaryButton}
            onSecondaryActionDescription={onSecondaryActionDescription}
            onOptionsButton={onOptionsButton}
            onOptionsActionDescription={onOptionsActionDescription}
        >
            {children}
        </Focusable>
    );
}
