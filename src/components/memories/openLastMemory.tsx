import { getSettings, loadLatestMemory } from "../../api";
import type { LanguageCode } from "../../locales";
import { logError } from "../../utils/errors";
import { showManagedModal } from "../../utils/modalRegistry";
import { orderedTagsByRecency } from "../../utils/tags";
import { MemoryViewerModal } from "./MemoryViewerModal";

let opening = false;

export async function openLastMemory(language: LanguageCode, stillAllowed?: () => boolean): Promise<boolean> {
    if (opening) {
        return false;
    }
    opening = true;
    try {
        const latest = await loadLatestMemory();
        const memory = latest?.memory ?? null;
        if (memory === null) {
            return false;
        }
        const settings = await getSettings();
        if (stillAllowed && !stillAllowed()) {
            return false;
        }
        const allTags = orderedTagsByRecency(latest.tags ?? [], true);
        showManagedModal((close) => (
            <MemoryViewerModal
                memory={memory}
                gameId={memory.gameId}
                thumbDataUri={null}
                language={language}
                mouseKeyboardMode={settings?.mouseKeyboardMode ?? false}
                showRetroPoints={settings?.showRetroPoints ?? true}
                allTags={allTags}
                close={close}
            />
        ));
        return true;
    } catch (e) {
        logError("memories: couldn't open the last memory", e);
        return false;
    } finally {
        opening = false;
    }
}
