import type { MilestoneCategoryIcon } from "../../types";

function glyph(icon: MilestoneCategoryIcon) {
    switch (icon) {
        case "flag":
            return (
                <>
                    <rect x="4" y="2.5" width="2.2" height="19" rx="1.1" />
                    <path d="M7.2 4.2C10 2.8 12.6 5.6 15.6 4.4C17.1 3.8 18.4 3.6 19.8 4.1V13.1C18.4 12.6 17.1 12.8 15.6 13.4C12.6 14.6 10 11.8 7.2 13.2Z" />
                </>
            );
        case "dpad":
            return (
                <path
                    fillRule="evenodd"
                    d="M9 2.5H15V9H21.5V15H15V21.5H9V15H2.5V9H9ZM12 10A2 2 0 1 0 12 14A2 2 0 1 0 12 10Z"
                />
            );
        case "padlock":
            return (
                <>
                    <path d="M7 10V7A5 5 0 0 1 16.6 5.1" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                    <path
                        fillRule="evenodd"
                        d="M6.2 10H17.8A2.2 2.2 0 0 1 20 12.2V19.3A2.2 2.2 0 0 1 17.8 21.5H6.2A2.2 2.2 0 0 1 4 19.3V12.2A2.2 2.2 0 0 1 6.2 10ZM11.2 16.5A1.7 1.7 0 1 1 12.8 16.5V18.7H11.2Z"
                    />
                </>
            );
        case "pushpin":
            return (
                <>
                    <path d="M8 2.5H16V4.5L15 5.2V10.5L18.5 14V15.5H5.5V14L9 10.5V5.2L8 4.5Z" />
                    <rect x="11.1" y="15" width="1.8" height="7" rx="0.9" />
                </>
            );
        case "people":
            return (
                <>
                    <circle cx="8.5" cy="7.5" r="3.3" />
                    <path d="M2 19.5C2 14.8 4.8 12.5 8.5 12.5C12.2 12.5 15 14.8 15 19.5Z" />
                    <circle cx="16.5" cy="8.5" r="2.8" opacity="0.85" />
                    <path d="M15.8 13.2C19.2 13.1 22 15.2 22 19.5H16.6C16.6 16.8 16.4 14.8 15.8 13.2Z" opacity="0.85" />
                </>
            );
        case "megaphone":
            return (
                <>
                    <path d="M3 9.5H7.5L17 4V20L7.5 14.5H3Z" />
                    <path d="M6 15L8 21H10.8L9.4 15Z" />
                    <path d="M19.5 9A4 4 0 0 1 19.5 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </>
            );
        case "camera":
            return (
                <path
                    fillRule="evenodd"
                    d="M3 7.5H7.5L9.2 5H14.8L16.5 7.5H21V19H3ZM12 8.8A4.2 4.2 0 1 0 12 17.2A4.2 4.2 0 1 0 12 8.8ZM12 10.4A2.6 2.6 0 1 1 12 15.6A2.6 2.6 0 1 1 12 10.4ZM18.3 8.9A0.9 0.9 0 1 0 18.3 10.7A0.9 0.9 0 1 0 18.3 8.9Z"
                />
            );
        case "compass":
            return (
                <>
                    <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="2" />
                    <path fillRule="evenodd" d="M15.8 8.2L13.4 13.4L8.2 15.8L10.6 10.6ZM12 10.9A1.1 1.1 0 1 0 12 13.1A1.1 1.1 0 1 0 12 10.9Z" />
                </>
            );
        case "globe":
            return (
                <g fill="none" stroke="currentColor">
                    <circle cx="12" cy="12" r="9.5" strokeWidth="2" />
                    <ellipse cx="12" cy="12" rx="4.2" ry="9.5" strokeWidth="1.6" />
                    <path d="M2.8 9H21.2M2.8 15H21.2" strokeWidth="1.6" />
                </g>
            );
        case "flame":
            return (
                <path
                    fillRule="evenodd"
                    d="M12 2.5C13 6.5 18.5 8.5 18.5 14.5A6.5 6.5 0 0 1 5.5 14.5C5.5 11 7.6 9.4 8.6 7.6C9 10 10 11 11 11.4C10.2 8 11 5 12 2.5ZM12 20.6A2.6 2.6 0 0 0 14.6 18C14.6 16.4 12.6 15.8 11.3 14.2C10.7 15.4 9.4 16.4 9.4 18A2.6 2.6 0 0 0 12 20.6Z"
                />
            );
        case "egg":
            return (
                <path
                    fillRule="evenodd"
                    d="M12 2.5C8.2 2.5 5 8.6 5 14A7 7 0 0 0 19 14C19 8.6 15.8 2.5 12 2.5ZM6.1 11.2L8.5 13L10.5 11.2L12.5 13L14.5 11.2L16.5 13L17.9 11.8L18.3 13.7L16.5 15.4L14.5 13.6L12.5 15.4L10.5 13.6L8.5 15.4L5.8 13.3Z"
                />
            );
    }
}

export function CategoryIcon(props: { icon: MilestoneCategoryIcon; size: number }) {
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
            {glyph(props.icon)}
        </svg>
    );
}
