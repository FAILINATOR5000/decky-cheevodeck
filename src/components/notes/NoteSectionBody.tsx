import { useMemo, useRef } from "react";
import { PanelSection } from "../ui/PanelSection";
import { CollapsibleTitle } from "../ui/CollapsibleTitle";
import { FocusClaim } from "../ui/FocusClaim";
import { NoteCard, type NoteCardListProps } from "./NoteCard";
import type { GameNote, HeaderStyle } from "../../types";

export type NoteSectionBodyProps = {
    title: string;
    collapseKey: string;
    collapsed: boolean;
    collapseDisabled?: boolean;
    headerStyle: HeaderStyle;
    onToggleCollapsed: (key: string) => void;
    notes: GameNote[];
    cardList: Omit<NoteCardListProps, "onFocusIndex">;
    reorderTargetId: string | null;
    onRowFocus: (index: number) => void;
    claimedRow?: {
        slotIndex: number;
        token: number;
        armed: boolean;
        onSpent: () => void;
    };
};

const NO_NOTES: GameNote[] = [];

export function NoteSectionBody(props: NoteSectionBodyProps) {
    const { notes, cardList, collapsed } = props;

    const itemFocusRef = useRef(props.onRowFocus);
    itemFocusRef.current = props.onRowFocus;

    const sectionCardList = useMemo<NoteCardListProps>(() => ({
        ...cardList,
        onFocusIndex: (index) => {
            itemFocusRef.current(index);
        }
    }), [cardList]);

    const bodyNotes = collapsed ? NO_NOTES : notes;

    return (
        <PanelSection
            title={
                <CollapsibleTitle
                    label={props.title}
                    collapsed={collapsed}
                    focusKey={`gn:section:${props.collapseKey}`}
                    disabled={props.collapseDisabled}
                    preserveCase={props.headerStyle === "typed"}
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
        </PanelSection>
    );
}
