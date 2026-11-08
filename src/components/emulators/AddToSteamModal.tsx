import { DialogButton, Focusable, ModalRoot, ScrollPanelGroup, TextField } from "@decky/ui";
import { useState } from "react";

import { useSlidingWindow } from "../../hooks/useSlidingWindow";
import { t, type LanguageCode } from "../../locales";
import type { SteamCollection } from "../../utils/emulatorShortcuts";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { achievementGreen, smallTextStyle } from "../../utils/style";
import { SlidingWindowRows } from "../ui/SlidingWindowRows";
import { FocusTarget } from "../ui/FocusTarget";

const ROWS_INITIAL = 30;
const ROWS_STEP = 30;

type AddToSteamOffer = {
    defaultName: string;
    lines: string[];
    collections: SteamCollection[];
};

export type AddToSteamChoice = { name: string; collection: string };

function collectionKey(collection: SteamCollection): string {
    return `emulators:steam:collection:${collection.id || "none"}`;
}

function AddToSteamModal(props: { language: LanguageCode; offer: AddToSteamOffer; onAdd: (choice: AddToSteamChoice) => void; close: () => void }) {
    const { language, offer, onAdd, close } = props;
    const [name, setName] = useState(offer.defaultName);
    const [chosen, setChosen] = useState("");
    const items = [{ id: "", name: t(language, "None") }, ...offer.collections];
    const list = useSlidingWindow({
        items,
        itemKey: (collection) => collection.id || "none",
        focusKeyFor: collectionKey,
        windowId: "emulators:steam:collections",
        heightScope: ["emulators:steam:collections", language].join("|"),
        dynamicLoading: true,
        initialRows: ROWS_INITIAL,
        rowStep: ROWS_STEP,
        fullSteps: true,
        prefetchDistance: 4,
        sentinelRootMarginPx: 600,
        resetKey: "collections"
    });

    function add() {
        onAdd({ name: name.trim() || offer.defaultName, collection: chosen });
        close();
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700 }}>{t(language, "Add to Steam")}</div>
                <div style={smallTextStyle()}>{t(language, "Name")}</div>
                <TextField value={name} onChange={(e: { target: { value: string } }) => setName(e.target.value.slice(0, 128))} />
                {offer.lines.map((line) => (
                    <div key={line} style={{ fontSize: `${modalSize(15)}px`, lineHeight: 1.4 }}>{line}</div>
                ))}
                <div style={smallTextStyle()}>{t(language, "Collection")}</div>
                <div style={{ maxHeight: "30vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                    <ScrollPanelGroup focusable={false} style={{ flex: 1, minHeight: 0 }}>
                        <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", padding: "5px" }}>
                            <SlidingWindowRows list={list}>
                                {list.mountedItems.map((collection, index) => {
                                    const at = list.start + index;
                                    const picked = collection.id === chosen;
                                    return (
                                        <FocusTarget key={collection.id || "none"} focusKey={collectionKey(collection)}>
                                            <DialogButton
                                                onClick={() => setChosen(collection.id)}
                                                onGamepadFocus={() => list.onItemFocus(at)}
                                                onGamepadDirection={list.guardTopRow(at)}
                                                style={{
                                                    marginBottom: "4px",
                                                    textAlign: "left",
                                                    outline: picked ? `2px solid ${achievementGreen}` : undefined,
                                                    borderRadius: "4px"
                                                }}
                                            >
                                                {picked ? `✔ ${collection.name}` : collection.name}
                                            </DialogButton>
                                        </FocusTarget>
                                    );
                                })}
                            </SlidingWindowRows>
                        </Focusable>
                    </ScrollPanelGroup>
                </div>
                <Focusable flow-children="row" style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                    <FocusTarget focusKey="emulators:steam:add">
                        <DialogButton autoFocus onClick={add}>{t(language, "Add")}</DialogButton>
                    </FocusTarget>
                    <FocusTarget focusKey="emulators:steam:cancel">
                        <DialogButton onClick={close}>{t(language, "Cancel")}</DialogButton>
                    </FocusTarget>
                </Focusable>
            </div>
        </ModalRoot>
    );
}

export function askAddToSteam(language: LanguageCode, offer: AddToSteamOffer): Promise<AddToSteamChoice | null> {
    return new Promise((resolve) => {
        let chosen: AddToSteamChoice | null = null;
        showManagedModal(
            (close) => <AddToSteamModal language={language} offer={offer} onAdd={(choice) => { chosen = choice; }} close={close} />,
            { onClose: () => resolve(chosen) }
        );
    });
}
