import { t, type LanguageCode } from "../locales";

const SHOW_AFTER_SECONDS = 2;

export function startReadingLine(language: LanguageCode, show: (text: string) => void): () => void {
    const started = Date.now();
    const timer = window.setInterval(() => {
        const seconds = Math.floor((Date.now() - started) / 1000);
        if (seconds >= SHOW_AFTER_SECONDS) {
            show(t(language, "Reading the game file... {{seconds}} s", { seconds }));
        }
    }, 1000);
    return () => window.clearInterval(timer);
}
