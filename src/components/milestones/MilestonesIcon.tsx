export function MilestonesIcon(props: { size: number }) {
    return (
        <svg
            viewBox="0 0 24 24"
            width={props.size}
            height={props.size}
            xmlns="http://www.w3.org/2000/svg"
            focusable="false"
            fill="currentColor"
            style={{ display: "block", flexShrink: 0 }}
        >
            <path
                fillRule="evenodd"
                d="M2 21V16.5H8V12.5H14V8.5H22V21ZM4 18.55H6V19.45H4ZM10 14.55H12V15.45H10ZM16 10.55H20V11.45H16Z"
            />
            <rect x="17.2" y="1.5" width="1.3" height="7.2" rx="0.6" />
            <path d="M18.5 1.9L23 3.5L18.5 5.1Z" />
        </svg>
    );
}
