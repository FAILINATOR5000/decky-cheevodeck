import { FaRegCalendar } from "react-icons/fa";

export function AwardStamp(props: { date: string }) {
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35em" }}>
            <FaRegCalendar style={{ flexShrink: 0 }} />
            <span>{props.date}</span>
        </span>
    );
}
