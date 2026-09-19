import { Focusable } from "@decky/ui";
import type { ReactNode } from "react";
import { playOkSound } from "../../utils/navSound";
import { snapshotOwnsButton } from "../../utils/snapshotHotkey";

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

    const yieldedToSnapshot = snapshotOwnsButton("menu");

    function handleMenu() {
        playOkSound();
        onSave();
    }

    return (
        <Focusable
            onMenuButton={canSave && !yieldedToSnapshot ? handleMenu : undefined}
            onMenuActionDescription={canSave && !yieldedToSnapshot ? label : undefined}
            onSecondaryButton={onSecondaryButton}
            onSecondaryActionDescription={onSecondaryActionDescription}
            onOptionsButton={onOptionsButton}
            onOptionsActionDescription={onOptionsActionDescription}
        >
            {children}
        </Focusable>
    );
}
