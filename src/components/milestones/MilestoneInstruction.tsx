import { Fragment, type ReactNode } from "react";
import { ButtonPrompt, GlyphGroup } from "../ui/ButtonPrompt";
import { withInlineTags } from "../ui/inlineTags";
import { t, type LanguageCode } from "../../locales";
import type { MilestoneDef, ShortcutAction, ShortcutButton } from "../../types";
import {
    DEFAULT_SHORTCUT_BINDINGS,
    SHORTCUT_BUTTONS,
    shortcutActionLabel,
    shortcutButtonGlyphs,
    worksOutsidePanel
} from "../../utils/options";

const PADDLES: ReadonlySet<string> = new Set(["l4", "l5", "r4", "r5"]);

export type InstructionContext = {
    language: LanguageCode;
    fontSize: number;
    bindings: Record<ShortcutButton, ShortcutAction>;
    globalButtonsOn: boolean;
    paddles: string[];
};

function usableButtons(action: ShortcutAction, map: Record<ShortcutButton, ShortcutAction>, ctx: InstructionContext, global: boolean) {
    return SHORTCUT_BUTTONS
        .map((row) => row.id)
        .filter((button) => map[button] === action)
        .filter((button) => !global || worksOutsidePanel(button, action))
        .filter((button) => !PADDLES.has(button) || ctx.paddles.includes(button));
}

function bindingGroup(buttons: ShortcutButton[], ctx: InstructionContext): ReactNode {
    return (
        <span style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: "0.3em" }}>
            {buttons.map((button, index) => (
                <Fragment key={button}>
                    {index > 0 && <span>{t(ctx.language, "or")}</span>}
                    <GlyphGroup buttons={shortcutButtonGlyphs(button)} fontSize={ctx.fontSize} />
                </Fragment>
            ))}
        </span>
    );
}

export function MilestoneInstruction(props: { milestone: MilestoneDef; ctx: InstructionContext }) {
    const { milestone, ctx } = props;
    const { language, fontSize } = ctx;
    const howKey = `ms_${milestone.id}_how`;
    const prompt = (textKey: string, groups?: ReactNode[], vars?: Record<string, string>) => (
        <ButtonPrompt
            language={language}
            textKey={textKey}
            fontSize={fontSize}
            groups={groups}
            vars={vars}
            renderText={withInlineTags}
            inline
        />
    );

    if (milestone.binding === null) {
        const groups = (milestone.buttons ?? []).map((buttons, index) => (
            <GlyphGroup key={index} buttons={buttons} fontSize={fontSize} />
        ));
        return prompt(howKey, groups);
    }

    const action = milestone.binding;
    const global = milestone.needsGlobalButtons;
    const bound = usableButtons(action, ctx.bindings, ctx, global);
    let body: ReactNode;
    if (bound.length > 0) {
        body = prompt(howKey, [bindingGroup(bound, ctx)]);
    }
    else if (Object.values(ctx.bindings).includes(action)) {
        body = prompt("milestone_binding_missing_paddle", [], { action: shortcutActionLabel(action, language) });
    }
    else {
        const defaults = usableButtons(action, DEFAULT_SHORTCUT_BINDINGS, ctx, global);
        body = prompt("milestone_binding_unbound", [bindingGroup(defaults, ctx)], { action: shortcutActionLabel(action, language) });
    }
    if (!global || ctx.globalButtonsOn) {
        return body;
    }
    return (
        <span style={{ display: "flex", flexDirection: "column", gap: "0.3em" }}>
            {body}
            {prompt("milestone_binding_needs_global")}
        </span>
    );
}
