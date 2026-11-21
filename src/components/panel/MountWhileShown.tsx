import { useEffect, useRef, useState, type ReactNode } from "react";

export function MountWhileShown(props: { children: ReactNode }) {
    const probeRef = useRef<HTMLSpanElement | null>(null);
    const [shown, setShown] = useState(true);

    useEffect(() => {
        const doc = probeRef.current?.ownerDocument;
        if (!doc) {
            return undefined;
        }
        const update = () => setShown(doc.visibilityState === "visible");
        doc.addEventListener("visibilitychange", update);
        return () => doc.removeEventListener("visibilitychange", update);
    }, []);

    return (
        <>
            <span ref={probeRef} style={{ display: "none" }} />
            {shown ? props.children : null}
        </>
    );
}
