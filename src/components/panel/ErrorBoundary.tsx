import { Component, type ErrorInfo, type ReactNode } from "react";
import { ModalRoot } from "@decky/ui";
import { logRenderCrash } from "../../api";
import { getCurrentLanguage, t } from "../../locales";
import { logError } from "../../utils/errors";

type ErrorBoundaryProps = {
    where: string;
    closeModal?: () => void;
    children?: ReactNode;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, { error: string | null }> {
    state: { error: string | null } = { error: null };

    static getDerivedStateFromError(error: unknown) {
        const text = String((error as Error)?.message || error || "").trim();
        return { error: text || "unknown error" };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        logError(`${this.props.where}: render failed`, error);
        const detail = `${error?.stack || error}\n${info.componentStack ?? ""}`;
        void logRenderCrash(this.props.where, detail).catch(() => { });
    }

    render() {
        if (this.state.error === null) {
            return this.props.children;
        }
        const language = getCurrentLanguage();
        const inModal = !!this.props.closeModal;
        const message = (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "12px 0" }}>
                <div style={{ fontWeight: "bold" }}>
                    {inModal
                        ? t(language, "CheevoDeck couldn't draw this window.")
                        : t(language, "CheevoDeck couldn't draw this page.")}
                </div>
                <div style={{ fontSize: "12px", opacity: 0.7, wordBreak: "break-word" }}>
                    {this.state.error}
                </div>
                <div>
                    {inModal
                        ? t(language, "Press B to close it and try again. The full error is in the CheevoDeck log.")
                        : t(language, "Close the menu and open it again. The full error is in the CheevoDeck log.")}
                </div>
            </div>
        );
        if (inModal) {
            return <ModalRoot closeModal={this.props.closeModal}>{message}</ModalRoot>;
        }
        return message;
    }
}
