import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useEffect, useState } from "react";

import { dolphinGameMappings, setDolphinGameMapping } from "../../api";
import { t, type LanguageCode } from "../../locales";
import type { DolphinGameMappings, DolphinGameMappingSlot } from "../../types";
import { logError } from "../../utils/errors";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { modalBodyStyle, warnAmber } from "../../utils/style";
import { MappingCardBody } from "../mapping/MappingCardBody";
import { showMappingPicker } from "../mapping/MappingPickerModal";
import { FocusableItem } from "../ui/FocusableItem";
import { FocusTarget } from "../ui/FocusTarget";
import { HeadingStop } from "../ui/HeadingStop";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

const SLOTS: { slot: DolphinGameMappingSlot; label: string; help: string }[] = [
    { slot: "play", label: "Play Mapping", help: "Used for Play, Couch Play and Link Play." },
    { slot: "stream", label: "Stream Play Mapping", help: "Used when you host Stream Play." }
];

type DolphinMappingsProps = {
    language: LanguageCode;
    gameId: number;
    title: string;
    close: () => void;
};

function DolphinMappingsModal(props: DolphinMappingsProps) {
    const { language, gameId, title, close } = props;
    const [info, setInfo] = useState<DolphinGameMappings | null>(null);

    useEffect(() => {
        dolphinGameMappings(gameId)
            .then((next) => {
                if (next.ok) {
                    setInfo(next);
                }
            })
            .catch((e) => logError("dolphin mappings: couldn't read this game's mappings", e));
    }, [gameId]);

    const mappings = info?.mappings ?? [];

    function choose(slot: DolphinGameMappingSlot, mappingId: string) {
        setDolphinGameMapping(gameId, slot, mappingId)
            .then((saved) => {
                if (saved.ok) {
                    setInfo((was) => was && { ...was, play: saved.play ?? "", stream: saved.stream ?? "" });
                }
            })
            .catch((e) => logError("dolphin mappings: couldn't save the game's mapping", e));
    }

    function openPicker(slot: DolphinGameMappingSlot, label: string) {
        showMappingPicker({
            language,
            title: t(language, label),
            mappings,
            chosen: info?.[slot] ?? "",
            onPick: (mappingId) => choose(slot, mappingId)
        });
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 }}>
                <HeadingStop focusKey="dolphinmappings:title" autoFocus style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700 }}>
                    {t(language, "Dolphin Mappings")}
                </HeadingStop>
                <div style={{ ...modalBodyStyle(), overflowWrap: "anywhere" }}>{title}</div>
                {info?.automap && (
                    <div style={{ ...modalBodyStyle(), color: warnAmber, opacity: 1 }}>
                        {t(language, "EmuDeck's AutoMap sets this game's controls when it launches, so these mappings aren't used. Turn off AutoMap for Dolphin in EmuDeck to use them.")}
                    </div>
                )}
                {SLOTS.map(({ slot, label, help }) => {
                    const chosen = mappings.find((mapping) => mapping.id === info?.[slot]);
                    return (
                        <div key={slot} style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "6px" }}>
                            <div style={{ fontSize: `${modalSize(16)}px`, fontWeight: 700 }}>{t(language, label)}</div>
                            <div style={modalBodyStyle()}>{t(language, help)}</div>
                            <FocusableItem
                                focusKey={`dolphinmappings:slot:${slot}`}
                                outerStyle={{ width: "100%", minWidth: 0 }}
                                disabled={!info}
                                onClick={() => openPicker(slot, label)}
                                bottomSeparator="none"
                            >
                                {chosen
                                    ? <MappingCardBody mapping={chosen} language={language} modal />
                                    : <span style={{ width: "100%", textAlign: "left", fontWeight: 700 }}>{t(language, "None")}</span>}
                            </FocusableItem>
                        </div>
                    );
                })}
                {info && mappings.length === 0 && (
                    <div style={modalBodyStyle()}>
                        {t(language, "No mappings for this console yet. Make one in the Dolphin Mapper.")}
                    </div>
                )}
                <Focusable flow-children="row" style={{ display: "flex", marginTop: "6px" }}>
                    <FocusTarget focusKey="dolphinmappings:close" style={{ display: "flex", flex: 1, minWidth: 0 }}>
                        <DialogButton onClick={close} style={{ width: "100%" }}>{t(language, "Close")}</DialogButton>
                    </FocusTarget>
                </Focusable>
            </div>
        </ModalRoot>
    );
}

export function showDolphinMappings(options: Omit<DolphinMappingsProps, "close">) {
    showManagedModal((close) => <DolphinMappingsModal {...options} close={close} />);
}
