import { useEffect, useState } from "react";
import { DialogButton, ModalRoot } from "@decky/ui";
import { markPlayTogetherIntroSeen } from "../../api";
import { useLatestRef } from "../../hooks/useLatestRef";
import { t, type LanguageCode } from "../../locales";
import { logError } from "../../utils/errors";
import { cardCollage, COLLAGE_ROWS, type CardCollage } from "../../utils/playTogetherCollage";
import { modalSize } from "../../utils/scale";
import { modalBodyStyle } from "../../utils/style";
import { BottomFocusAnchor } from "../ui/BottomFocusAnchor";
import { FocusTarget } from "../ui/FocusTarget";
import { HeadingStop } from "../ui/HeadingStop";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { ToggleRow } from "../ui/ToggleRow";
import { withInlineTags } from "../ui/inlineTags";

type WelcomePlayTogetherModalProps = {
    language: LanguageCode;
    onDone?: () => void;
    onCancel: () => void;
    close: () => void;
};

const MODAL_WIDTH_CSS = `
.cheevo-welcome-pt-dialog.DialogContent, .cheevo-welcome-pt-dialog {
    width: 86vw;
    max-width: 780px;
}`;

const COLLAGE_CELL = 40;
const BANNER_FADE = "14, 20, 27";

function Banner(props: { collage: CardCollage; title: string; subtitle: string }) {
    const cell = modalSize(COLLAGE_CELL);
    return (
        <div
            style={{
                position: "relative",
                overflow: "hidden",
                borderRadius: "4px",
                height: `${cell * COLLAGE_ROWS}px`,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                padding: `0 ${modalSize(18)}px`
            }}
        >
            <img
                src={props.collage.image}
                style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    height: "100%",
                    width: "auto",
                    maxWidth: "none",
                    opacity: 0.45
                }}
            />
            <div
                style={{
                    position: "absolute",
                    inset: 0,
                    background: `linear-gradient(90deg, rgba(${BANNER_FADE}, 0.92), rgba(${BANNER_FADE}, 0.6) 50%, rgba(${BANNER_FADE}, 0.1))`
                }}
            />
            <div style={{ position: "relative", color: "#fff", textShadow: "0 1px 3px rgba(0, 0, 0, 0.6)" }}>
                <div style={{ fontSize: `${modalSize(26)}px`, fontWeight: 700, lineHeight: 1.15 }}>
                    {props.title}
                </div>
                <div style={{ fontSize: `${modalSize(14)}px`, lineHeight: 1.4, marginTop: "2px", opacity: 0.9 }}>
                    {props.subtitle}
                </div>
            </div>
        </div>
    );
}

export function WelcomePlayTogetherModal(props: WelcomePlayTogetherModalProps) {
    const { language, onDone, onCancel, close } = props;

    const [collage] = useState(cardCollage);
    const [enabled, setEnabled] = useState(true);
    const enabledRef = useLatestRef(enabled);

    useEffect(() => {
        return () => {
            void markPlayTogetherIntroSeen(enabledRef.current)
                .catch((e) => logError("save the Play Together intro's Friends Service answer", e));
        };
    }, []);

    function finish() {
        close();
        onDone?.();
    }

    const title = t(language, "Play Together");
    const subtitle = t(language, "CheevoDeck 2.0+");
    const reticle = { flex: 1, minWidth: 0 };

    return (
        <ModalRoot onCancel={onCancel} onEscKeypress={onCancel} className="cheevo-welcome-pt-dialog">
            <SnapshotHotkey language={language} />
            <style>{MODAL_WIDTH_CSS}</style>

            <HeadingStop focusKey="welcome-pt:heading" autoFocus={true} tint={false} style={reticle}
                outerStyle={{ marginBottom: "10px" }}>
                {collage ? (
                    <Banner collage={collage} title={title} subtitle={subtitle} />
                ) : (
                    <div>
                        <div style={{ fontSize: `${modalSize(22)}px`, fontWeight: 700, marginBottom: "4px" }}>
                            {title}
                        </div>
                        <div style={{ fontSize: `${modalSize(14)}px`, lineHeight: 1.4, opacity: 0.8 }}>
                            {subtitle}
                        </div>
                    </div>
                )}
            </HeadingStop>

            <HeadingStop focusKey="welcome-pt:intro" tint={false}
                style={{ ...reticle, fontSize: `${modalSize(14)}px`, lineHeight: 1.4 }}
                outerStyle={{ marginBottom: "8px" }}>
                {t(language, "welcome_play_together_intro")}
            </HeadingStop>

            <ToggleRow
                focusKey="welcome-pt:toggle"
                label={t(language, "Enable Friends Service")}
                value={enabled}
                onChange={setEnabled}
                bottomSeparator="none"
                outerStyle={{ marginBottom: "6px" }}
            />

            <HeadingStop focusKey="welcome-pt:data" tint={false} style={reticle}>
                <div style={modalBodyStyle()}>{t(language, "welcome_play_together_data")}</div>
            </HeadingStop>

            <div style={{ ...modalBodyStyle(), marginTop: "8px", opacity: 0.7 }}>
                {withInlineTags(t(language, "welcome_play_together_options"))}
            </div>

            <FocusTarget focusKey="welcome-pt:continue" style={{ display: "flex", marginTop: "12px" }}>
                <DialogButton onClick={finish} style={{ width: "100%", fontSize: `${modalSize(14)}px` }}>
                    {t(language, "Continue")}
                </DialogButton>
            </FocusTarget>

            <BottomFocusAnchor focusKey="welcome-pt:bottom:anchor" headroomPx={8} />
        </ModalRoot>
    );
}
