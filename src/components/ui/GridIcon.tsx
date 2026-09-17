// Font Awesome Free icon path, CC BY 4.0. See ATTRIBUTIONS.md.
type GridIconProps = { size?: number };

export function GridIcon({ size = 18 }: GridIconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            width={size}
            height={size}
            fill="currentColor"
        >
            <path d="M0 96C0 78.3 14.3 64 32 64H224c17.7 0 32 14.3 32 32V288c0 17.7-14.3 32-32 32H32c-17.7 0-32-14.3-32-32V96zM0 416c0-17.7 14.3-32 32-32H224c17.7 0 32 14.3 32 32v64c0 17.7-14.3 32-32 32H32c-17.7 0-32-14.3-32-32V416zM320 96c0-17.7 14.3-32 32-32H480c17.7 0 32 14.3 32 32v64c0 17.7-14.3 32-32 32H352c-17.7 0-32-14.3-32-32V96zM320 288c0-17.7 14.3-32 32-32H480c17.7 0 32 14.3 32 32V480c0 17.7-14.3 32-32 32H352c-17.7 0-32-14.3-32-32V288z" />
        </svg>
    );
}
