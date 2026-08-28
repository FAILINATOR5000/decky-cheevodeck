// execCommand on purpose. navigator.clipboard.writeText refuses on an unfocused
// document, and a QAM panel over a running game is one.
export function copyTextToClipboard(text: string, from: Element | null): boolean {
    const view = from?.ownerDocument?.defaultView as any;
    if (!view) {
        return false;
    }

    const win = view.top ?? view;
    const doc = win.document;
    const box = doc.createElement("textarea");
    box.textContent = text;
    box.style.position = "fixed";
    doc.body.appendChild(box);
    box.select();

    try {
        win.SteamClient?.Browser?.NotifyUserActivation?.();
        return Boolean(doc.execCommand("copy"));
    }
    catch {
        return false;
    }
    finally {
        doc.body.removeChild(box);
    }
}
