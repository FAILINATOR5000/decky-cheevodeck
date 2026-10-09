import type { ReactNode } from "react";
import type { SlidingWindow } from "../../hooks/useSlidingWindow";

type SlidingWindowRowsProps<T> = {
    list: SlidingWindow<T>;
    children: ReactNode;
};

export function SlidingWindowRows<T>(props: SlidingWindowRowsProps<T>) {
    const { list } = props;

    return (
        <div ref={list.holderRef} style={{ display: "flow-root", overflowAnchor: "none" }}>
            <div style={{ height: `${list.topSpacerPx}px` }} />
            <div ref={list.upMarkerRef} />
            {props.children}
            <div ref={list.downMarkerRef} />
            <div style={{ height: `${list.bottomSpacerPx}px` }} />
        </div>
    );
}
