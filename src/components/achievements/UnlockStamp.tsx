// Font Awesome Free icons, CC BY 4.0. See ATTRIBUTIONS.md.
import { FaUnlock } from "react-icons/fa";

export function UnlockStamp(props: { date: string }) {
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35em" }}>
            <FaUnlock style={{ flexShrink: 0 }} />
            <span>{props.date}</span>
        </span>
    );
}
