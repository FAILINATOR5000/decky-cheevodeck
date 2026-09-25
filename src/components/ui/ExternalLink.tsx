import { type ReactNode } from "react";
import { openExternalUrl } from "../../utils/navigation";
import { ActionLink } from "./ActionLink";

type ExternalLinkProps = {
    url: string;
    onBeforeNavigate?: () => void;
    useWebBrowser?: boolean;
    block?: boolean;
    children: ReactNode;
};

export function ExternalLink(props: ExternalLinkProps) {
    const { url, onBeforeNavigate, useWebBrowser = true, block, children } = props;

    function open() {
        onBeforeNavigate?.();
        void openExternalUrl(url, useWebBrowser);
    }

    return (
        <ActionLink onActivate={open} block={block}>
            {children}
        </ActionLink>
    );
}
