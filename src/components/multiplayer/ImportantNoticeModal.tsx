import { DialogButton, Focusable, ModalRoot } from "@decky/ui";

import { t, type LanguageCode } from "../../locales";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { FocusTarget } from "../ui/FocusTarget";
import { HeadingStop } from "../ui/HeadingStop";
import { RetroArchQuitHotkey } from "./RetroArchQuitHotkey";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";

type Notice = { key: string; heading: string; body: string };

function ImportantNoticeModal(props: { language: LanguageCode; notices: Notice[]; close: () => void }) {
    const { language, notices, close } = props;
    const gap = modalSize(15) * 1.4;
    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SnapshotHotkey language={language} />
            <HeadingStop focusKey="notice:title" autoFocus outerStyle={{ marginBottom: "12px" }}
                style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700 }}>
                {t(language, "Important Notices")}
            </HeadingStop>
            <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", gap: `${gap}px` }}>
                {notices.map((notice) => {
                    const body = (
                        <div>
                            <div style={{ fontWeight: 700, marginBottom: "6px" }}>{t(language, notice.heading)}</div>
                            <div style={{ whiteSpace: "pre-line" }}>{t(language, notice.body)}</div>
                        </div>
                    );
                    if (notice.key === "exit") {
                        return (
                            <RetroArchQuitHotkey
                                key={notice.key}
                                language={language}
                                focusKey="notice:raquit"
                                modal
                                divider
                                size={15}
                                intro={body}
                                outerStyle={{ marginBottom: 0 }}
                            />
                        );
                    }
                    return (
                        <HeadingStop
                            key={notice.key}
                            focusKey={`notice:${notice.key}`}
                            outerStyle={{ width: "100%", minWidth: 0 }}
                            style={{ width: "100%", textAlign: "left", fontSize: `${modalSize(15)}px`, lineHeight: 1.4 }}
                        >
                            {body}
                        </HeadingStop>
                    );
                })}
            </Focusable>
            <Focusable style={{ display: "flex", marginTop: `${gap}px` }} flow-children="row">
                <FocusTarget focusKey="notice:close" style={{ display: "flex", flex: 1 }}>
                    <DialogButton onClick={close} style={{ width: "100%" }}>{t(language, "Close")}</DialogButton>
                </FocusTarget>
            </Focusable>
        </ModalRoot>
    );
}

export function openImportantNotice(language: LanguageCode, show: { refresh: boolean; exit: boolean }) {
    const notices: Notice[] = [];
    if (show.refresh) {
        notices.push({ key: "refresh", heading: "60 Hz for Best Experience", body: "refresh_note_body" });
    }
    if (show.exit) {
        notices.push({ key: "exit", heading: "WARNING for Couch/Link Play only", body: "exit_note_body" });
    }
    if (notices.length > 0) {
        showManagedModal((close) => <ImportantNoticeModal language={language} notices={notices} close={close} />);
    }
}
