import { ButtonItem as DeckyButtonItem } from "@decky/ui";
import { steamUiKind } from "./build";
import { steamModule } from "./lookup";

export function buttonItem(): typeof DeckyButtonItem {
    if (steamUiKind() === "webpack") {
        return DeckyButtonItem;
    }
    const steams = steamModule<typeof DeckyButtonItem>("button item", (e) => {
        if (typeof e?.render !== "function") {
            return false;
        }
        const source = Function.prototype.toString.call(e.render);
        return source.includes("childrenLayout") && source.includes("fieldChildren") && source.includes("onMouseDown");
    });
    return steams ?? DeckyButtonItem;
}
