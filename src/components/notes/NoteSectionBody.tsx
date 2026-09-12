import { useMemo, useRef } from "react";
import { PanelSection } from "@decky/ui";
import { CollapsibleTitle } from "../ui/CollapsibleTitle";
import { FocusClaim } from "../ui/FocusClaim";
import { NoteCard, type NoteCardListProps } from "./NoteCard";
import { useWindowedList } from "../../hooks/useWindowedList";
import type { GameNote } from "../../types";

export type NoteSectionBodyProps = {
    title: string;
    collapseKey: string;
    collapsed: boolean;
    collapseDisabled?: boolean;
    onToggleCollapsed: (key: string) => void;
    notes: GameNote[];
    cardList: Omit<NoteCardListProps, "onFocusIndex">;
    reorderTargetId: string | null;
    dynamicLoading: boolean;
    dynamicInitialRows: number;
    dynamicRowStep: number;
    dynamicPrefetchDistance: number;
    sentinelRootMargin: string;
    resetKey: string;
    restoreSeedNoteId: string | null;
    claimedRow?: {
        slotIndex: number;
        token: number;
        armed: boolean;
        onSpent: () => void;
    };
};

const NO_NOTES: GameNote[] = [];

function seedRowsFor(notes: GameNote[], restoreSeedNoteId: string | null): number {
    if (restoreSeedNoteId === null) {
        return 0;
    }
    const index = notes.findIndex((note) => note.id === restoreSeedNoteId);
    return index < 0 ? 0 : index + 1;
}

export function NoteSectionBody(props: NoteSectionBodyProps) {
    const { notes, cardList, collapsed } = props;

    const {
        mountedItems: mountedNotes,
        markerRef: loadMoreMarkerRef,
        onItemFocus
    } = useWindowedList({
        items: notes,
        dynamicLoading: props.dynamicLoading,
        initialRows: props.dynamicInitialRows,
        rowStep: props.dynamicRowStep,
        prefetchDistance: props.dynamicPrefetchDistance,
        sentinelRootMargin: props.sentinelRootMargin,
        resetKey: props.resetKey,
        seedRows: seedRowsFor(notes, props.restoreSeedNoteId),
        debugLabel: `notes:${props.collapseKey}`
    });

    const itemFocusRef = useRef(onItemFocus);
    itemFocusRef.current = onItemFocus;

    const sectionCardList = useMemo<NoteCardListProps>(() => ({
        ...cardList,
        onFocusIndex: (index) => {
            itemFocusRef.current(index);
        }
    }), [cardList]);

    const bodyNotes = collapsed ? NO_NOTES : mountedNotes;

    return (
        <PanelSection
            title={
                <CollapsibleTitle
                    label={props.title}
                    collapsed={collapsed}
                    focusKey={`gn:section:${props.collapseKey}`}
                    disabled={props.collapseDisabled}
                    onToggle={() => props.onToggleCollapsed(props.collapseKey)}
                />
            }
        >
            {bodyNotes.map((note, index) => {
                const card = (
                    <NoteCard
                        key={index}
                        note={note}
                        rowIndex={index}
                        focusKey={`gn:card:${note.id}`}
                        isReorderTarget={props.reorderTargetId === note.id}
                        firing={note.showFiredDot}
                        list={sectionCardList}
                    />
                );

                const claimedRow = props.claimedRow;
                if (claimedRow && claimedRow.slotIndex === index) {
                    return (
                        <FocusClaim
                            key={index}
                            token={claimedRow.token}
                            armed={claimedRow.armed}
                            onSpent={claimedRow.onSpent}
                        >
                            {card}
                        </FocusClaim>
                    );
                }

                return card;
            })}
            {props.dynamicLoading && !collapsed && mountedNotes.length < notes.length && (
                <div ref={loadMoreMarkerRef} style={{ height: "1px" }} />
            )}
        </PanelSection>
    );
}
