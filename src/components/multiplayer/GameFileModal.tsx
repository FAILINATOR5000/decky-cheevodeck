import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { useEffect } from "react";

import { t, type LanguageCode } from "../../locales";
import { gameFilePickFailure, setGameFileWindowOpen, useGameFilePick } from "../../utils/gameFilePick";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { achievementGreen, errorRed, smallTextStyle } from "../../utils/style";
import { FocusTarget } from "../ui/FocusTarget";
import { ProgressBar } from "../ui/ProgressBar";

function GameFileModal(props: { language: LanguageCode; pickAgain: () => void; close: () => void }) {
    const { language, pickAgain, close } = props;
    const { pick } = useGameFilePick();
    const phase = pick?.state ?? "done";

    useEffect(() => {
        setGameFileWindowOpen(true);
        return () => setGameFileWindowOpen(false);
    }, []);

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <div style={{ fontSize: `${modalSize(20)}px`, fontWeight: 700, marginBottom: "12px" }}>
                {pick?.title ?? t(language, "Pick the Game's File")}
            </div>
            {pick?.state === "running" && (
                <div>
                    <div style={{ fontSize: `${modalSize(16)}px`, lineHeight: 1.4, marginBottom: "10px" }}>
                        {t(language, "Checking {{file}} with RetroAchievements...", { file: pick.fileName })}
                    </div>
                    <ProgressBar fraction={null} />
                    <div style={{ ...smallTextStyle(), marginTop: "8px" }}>
                        {t(language, "Big games, like GameCube and Wii discs, can take a few minutes. You can close this and keep going.")}
                    </div>
                </div>
            )}
            {pick?.state === "done" && (
                <div>
                    <div style={{ fontSize: `${modalSize(16)}px`, color: achievementGreen }}>
                        {t(language, "Found {{game}}", { game: pick.title })}
                    </div>
                    {pick.label && <div style={{ ...smallTextStyle(), marginTop: "6px" }}>{pick.label}</div>}
                </div>
            )}
            {pick?.state === "failed" && (
                <div style={{ fontSize: `${modalSize(16)}px`, lineHeight: 1.4, color: errorRed }}>
                    {gameFilePickFailure(language, pick)}
                </div>
            )}
            <Focusable key={`gamefile:buttons:${phase}`} style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "16px" }}
                flow-children="column">
                {phase === "failed" && (
                    <FocusTarget focusKey="gamefile:again">
                        <DialogButton autoFocus onClick={() => {
                            close();
                            pickAgain();
                        }}>
                            {t(language, "Pick Another File")}
                        </DialogButton>
                    </FocusTarget>
                )}
                <FocusTarget focusKey="gamefile:close">
                    <DialogButton autoFocus={phase !== "failed"} onClick={close}>{t(language, "Close")}</DialogButton>
                </FocusTarget>
            </Focusable>
        </ModalRoot>
    );
}

export function showGameFile(language: LanguageCode, pickAgain: () => void) {
    showManagedModal((close) => <GameFileModal language={language} pickAgain={pickAgain} close={close} />);
}
