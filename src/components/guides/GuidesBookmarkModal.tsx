import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";
import { useState } from "react";

import { FADE_IN_KEYFRAMES } from "../../utils/style";
import { t, type LanguageCode } from "../../locales";
import { modalSize } from "../../utils/scale";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

type GuidesBookmarkModalProps = {
    language: LanguageCode;
    initialName?: string;
    onSubmit: (name: string) => void;
    close: () => void;
};

const BOOKMARK_NAME_MAX = 20;

export function GuidesBookmarkModal(props: GuidesBookmarkModalProps) {
    const { language, initialName, onSubmit, close } = props;
    const [name, setName] = useState(initialName ?? "");

    function submit() {
        const trimmed = name.trim().slice(0, BOOKMARK_NAME_MAX);
        if (trimmed) {
            onSubmit(trimmed);
        }
        close();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <SaveOnStart
                canSave={name.trim().length > 0}
                label={t(language, "Save")}
                onSave={submit}
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <style>{FADE_IN_KEYFRAMES}</style>
                    <div style={{ fontSize: `${modalSize(18)}px`, fontWeight: 700 }}>
                        {initialName ? t(language, "Rename Bookmark") : t(language, "Enter Bookmark Name")}
                    </div>
                    <TextField
                        value={name}
                        onChange={(e: { target: { value: string } }) => setName(e.target.value.slice(0, BOOKMARK_NAME_MAX))}
                    />
                    <Focusable flow-children="row" style={{ display: "flex", gap: "8px" }}>
                        <DialogButton onClick={submit} disabled={name.trim().length === 0}>
                            {t(language, "Save")}
                        </DialogButton>
                        <DialogButton onClick={close}>
                            {t(language, "Cancel")}
                        </DialogButton>
                    </Focusable>
                </div>
            </SaveOnStart>
        </ModalRoot>
    );
}
