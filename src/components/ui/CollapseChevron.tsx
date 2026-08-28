export function CollapseChevron(props: { collapsed: boolean; size?: number }) {
    const size = props.size ?? 16;
    return (
        <svg
            viewBox="0 0 24 24"
            width={size}
            height={size}
            xmlns="http://www.w3.org/2000/svg"
            focusable="false"
        >
            <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                d={props.collapsed ? "M5 9l7 7 7-7" : "M5 15l7-7 7 7"}
            />
        </svg>
    );
}
