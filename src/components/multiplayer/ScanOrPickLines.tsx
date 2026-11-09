import { t, type LanguageCode } from "../../locales";
import { modalSize } from "../../utils/scale";

export function ScanOrPickLines(props: { language: LanguageCode }) {
    const { language } = props;
    const best = t(language, "Best:");
    const quicker = t(language, "Quicker:");
    return (
        <div style={{ fontSize: `${modalSize(16)}px`, lineHeight: 1.4, marginTop: "1.4em" }}>
            <div style={{ marginBottom: "1.4em" }}>
                <b>{best}</b>{best.endsWith("：") ? "" : " "}
                {t(language, "run a Cheevo Check scan, which finds all your games at once. On a big library, that can take a long time.")}
            </div>
            <div>
                <b>{quicker}</b>{quicker.endsWith("：") ? "" : " "}
                {t(language, "pick this game's file, and CheevoDeck checks just this one with RetroAchievements. It's always faster than a full scan.")}
            </div>
        </div>
    );
}
