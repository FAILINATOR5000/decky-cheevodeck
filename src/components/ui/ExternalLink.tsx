import { type ReactNode } from "react";
import { openExternalUrl } from "../../utils/navigation";
import { ActionLink } from "./ActionLink";

type ExternalLinkProps = {
    url: string;
    onBeforeNavigate?: () => void;
    block?: boolean;
    children: ReactNode;
};

export function ExternalLink(props: ExternalLinkProps) {
    const { url, onBeforeNavigate, block, children } = props;

    function open() {
        onBeforeNavigate?.();
        void openExternalUrl(url);
    }

    return (
        <ActionLink onActivate={open} block={block}>
            {children}
        </ActionLink>
    );
}
