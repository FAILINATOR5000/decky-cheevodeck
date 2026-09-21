import { useEffect, useState } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { addCalculatorHistoryEntry, clearCalculatorHistory, getCalculatorHistory } from "../../api";
import { BottomFocusAnchor } from "../ui/BottomFocusAnchor";
import { ConfirmRow } from "../ui/ConfirmRow";
import { SaveOnStart } from "../ui/SaveOnStart";
import { SnapshotHotkey } from "../ui/SnapshotHotkey";
import { t, type LanguageCode } from "../../locales";
import { showManagedModal } from "../../utils/modalRegistry";
import { modalSize } from "../../utils/scale";
import { errorRed } from "../../utils/style";
import { logError } from "../../utils/errors";
import {
    applyCalcKey,
    calcExpressionText,
    calcTokensAreBareNumber,
    evaluateCalcTokens,
    formatCalcNumber,
    type CalcKey,
    type CalcToken
} from "../../utils/calculator";
import type { CalculatorHistoryEntry, ShortcutButton } from "../../types";

const KEY_HEIGHT_PX = 46;

const PAD_GAP_PX = 6;

const HISTORY_ROW_HEIGHT_PX = 34;

const EXPRESSION_LINE_PX = 30;

const ANSWER_LINE_PX = 22;

const CALCULATOR_STYLES = `
.da-calc-accent > *:not(.gpfocus) {
    background: rgba(255, 255, 255, 0.18);
}
`;

const DISPLAY_BACKGROUND = "rgba(0, 0, 0, 0.28)";

const DIVIDER_COLOR = "rgba(255, 255, 255, 0.15)";

const SNAPSHOT_RESERVED: ShortcutButton[] = ["menu"];

const NAV_ENTER_BY_DIRECTION = 3;

type PadKey = {
    id: string;
    label: string;
    press?: CalcKey;
    action?: "equals" | "ans";
    accent?: boolean;
};

const PAD_ROWS: PadKey[][] = [
    [
        { id: "lparen", label: "(", press: { press: "lparen" } },
        { id: "rparen", label: ")", press: { press: "rparen" } },
        { id: "back", label: "⌫", press: { press: "back" } },
        { id: "clear", label: "C", press: { press: "clear" } },
        { id: "divide", label: "÷", press: { press: "op", op: "/" }, accent: true }
    ],
    [
        { id: "7", label: "7", press: { press: "digit", digit: "7" } },
        { id: "8", label: "8", press: { press: "digit", digit: "8" } },
        { id: "9", label: "9", press: { press: "digit", digit: "9" } },
        { id: "percent", label: "%", press: { press: "percent" } },
        { id: "times", label: "×", press: { press: "op", op: "*" }, accent: true }
    ],
    [
        { id: "4", label: "4", press: { press: "digit", digit: "4" } },
        { id: "5", label: "5", press: { press: "digit", digit: "5" } },
        { id: "6", label: "6", press: { press: "digit", digit: "6" } },
        { id: "power", label: "x^y", press: { press: "op", op: "^" } },
        { id: "minus", label: "−", press: { press: "op", op: "-" }, accent: true }
    ],
    [
        { id: "1", label: "1", press: { press: "digit", digit: "1" } },
        { id: "2", label: "2", press: { press: "digit", digit: "2" } },
        { id: "3", label: "3", press: { press: "digit", digit: "3" } },
        { id: "root", label: "√", press: { press: "sqrt" } },
        { id: "plus", label: "+", press: { press: "op", op: "+" }, accent: true }
    ],
    [
        { id: "0", label: "0", press: { press: "digit", digit: "0" } },
        { id: "dot", label: ".", press: { press: "dot" } },
        { id: "sign", label: "±", press: { press: "sign" } },
        { id: "ans", label: "ANS", action: "ans" },
        { id: "equals", label: "=", action: "equals", accent: true }
    ]
];

type CalculatorModalProps = {
    language: LanguageCode;
    close: () => void;
};

function CalculatorModal(props: CalculatorModalProps) {
    const { language, close } = props;

    const [tokens, setTokens] = useState<CalcToken[]>([]);

    const [settled, setSettled] = useState(false);

    const [failed, setFailed] = useState(false);

    const [entries, setEntries] = useState<CalculatorHistoryEntry[]>([]);

    useEffect(function loadHistory() {
        let alive = true;
        getCalculatorHistory()
            .then((response) => {
                if (alive) {
                    setEntries(response?.entries ?? []);
                }
            })
            .catch((err) => {
                logError("calculator history load", err);
            });
        return () => {
            alive = false;
        };
    }, []);

    const answer = entries.length > 0 ? entries[0].result : "";

    const expressionText = calcExpressionText(tokens);
    const previewValue = evaluateCalcTokens(tokens);
    const previewText = previewValue === null || settled || calcTokensAreBareNumber(tokens)
        ? ""
        : `= ${formatCalcNumber(previewValue)}`;

    function applyPress(key: CalcKey) {
        const fresh = settled
            && (key.press === "digit" || key.press === "dot" || key.press === "value");
        setTokens(applyCalcKey(fresh ? [] : tokens, key));
        setSettled(false);
        setFailed(false);
    }

    function evaluate() {
        const value = evaluateCalcTokens(tokens);
        if (value === null) {
            setFailed(tokens.length > 0);
            return;
        }

        const result = formatCalcNumber(value);
        const recorded = !calcTokensAreBareNumber(tokens);
        setTokens([{ kind: "num", text: result }]);
        setSettled(true);
        setFailed(false);
        if (!recorded) {
            return;
        }

        addCalculatorHistoryEntry(expressionText, result)
            .then((response) => {
                setEntries(response?.entries ?? []);
            })
            .catch((err) => {
                logError("calculator history write", err);
            });
    }

    function pressKey(entry: PadKey) {
        if (entry.action === "equals") {
            evaluate();
            return;
        }
        if (entry.action === "ans") {
            if (answer) {
                applyPress({ press: "value", text: answer });
            }
            return;
        }
        if (entry.press) {
            applyPress(entry.press);
        }
    }

    function wipeHistory() {
        clearCalculatorHistory()
            .then((response) => {
                setEntries(response?.entries ?? []);
            })
            .catch((err) => {
                logError("calculator history clear", err);
            });
    }

    function renderKey(entry: PadKey) {
        return (
            <div
                key={entry.id}
                data-focus-key={`calc:key:${entry.id}`}
                className={entry.accent ? "da-calc-accent" : undefined}
                style={{ minWidth: 0 }}
            >
                <DialogButton
                    onClick={() => pressKey(entry)}
                    autoFocus={entry.id === "7" || undefined}
                    style={{
                        minWidth: 0,
                        width: "100%",
                        height: `${modalSize(KEY_HEIGHT_PX)}px`,
                        padding: "0",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: `${modalSize(19)}px`,
                        fontWeight: 700
                    }}
                >
                    {entry.label}
                </DialogButton>
            </div>
        );
    }

    function renderHistoryRow(entry: CalculatorHistoryEntry) {
        return (
            <div key={entry.id} data-focus-key={`calc:history:${entry.id}`}>
                <DialogButton
                    onClick={() => applyPress({ press: "value", text: entry.result })}
                    style={{
                        minWidth: 0,
                        width: "100%",
                        height: `${modalSize(HISTORY_ROW_HEIGHT_PX)}px`,
                        padding: "0 10px",
                        display: "flex",
                        alignItems: "center",
                        gap: "10px"
                    }}
                >
                    <span
                        style={{
                            flex: 1,
                            minWidth: 0,
                            textAlign: "left",
                            opacity: 0.7,
                            fontSize: `${modalSize(13)}px`,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis"
                        }}
                    >
                        {entry.expression}
                    </span>
                    <span style={{ fontSize: `${modalSize(14)}px`, fontWeight: 800 }}>
                        {`= ${entry.result}`}
                    </span>
                </DialogButton>
            </div>
        );
    }

    return (
        <ModalRoot onCancel={close} onEscKeypress={close}>
            <SaveOnStart
                canSave
                claimMenuButton
                label={t(language, "Calculate")}
                onSave={evaluate}
                onSecondaryButton={() => applyPress({ press: "back" })}
                onSecondaryActionDescription={t(language, "Backspace")}
                onOptionsButton={() => applyPress({ press: "clear" })}
                onOptionsActionDescription={t(language, "Clear All")}
            >
                <SnapshotHotkey language={language} reservedButtons={SNAPSHOT_RESERVED} />
                <style>{CALCULATOR_STYLES}</style>
                <div style={{ fontSize: `${modalSize(18)}px`, fontWeight: 800, marginBottom: "8px" }}>
                    {t(language, "Calculator")}
                </div>

                <BottomFocusAnchor focusKey="calc:top:anchor" headroomPx={0} />

                <div
                    style={{
                        background: DISPLAY_BACKGROUND,
                        borderRadius: "6px",
                        padding: "10px 12px",
                        marginBottom: "10px"
                    }}
                >
                    <div
                        style={{
                            fontSize: `${modalSize(24)}px`,
                            lineHeight: `${modalSize(EXPRESSION_LINE_PX)}px`,
                            fontWeight: 700,
                            textAlign: "right",
                            wordBreak: "break-word",
                            minHeight: `${modalSize(EXPRESSION_LINE_PX)}px`
                        }}
                    >
                        {expressionText || "0"}
                    </div>
                    <div
                        style={{
                            fontSize: `${modalSize(14)}px`,
                            lineHeight: `${modalSize(ANSWER_LINE_PX)}px`,
                            height: `${modalSize(ANSWER_LINE_PX)}px`,
                            textAlign: "right",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            opacity: failed ? 1 : 0.6,
                            color: failed ? errorRed : undefined
                        }}
                    >
                        {failed ? t(language, "Can't work that out") : previewText}
                    </div>
                </div>

                <Focusable
                    flow-children="grid"
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(5, 1fr)",
                        gap: `${PAD_GAP_PX}px`,
                        width: "100%"
                    }}
                >
                    {PAD_ROWS.flat().map(renderKey)}
                </Focusable>

                <div style={{ height: "1px", background: DIVIDER_COLOR, margin: "16px 0 10px" }} />

                <div style={{ fontSize: `${modalSize(15)}px`, fontWeight: 700, marginBottom: "6px" }}>
                    {t(language, "History")}
                </div>

                {entries.length === 0 ? (
                    <div style={{ fontSize: `${modalSize(13)}px`, opacity: 0.7, marginBottom: "8px" }}>
                        {t(language, "No history yet.")}
                    </div>
                ) : (
                    <Focusable
                        flow-children="column"
                        navEntryPreferPosition={NAV_ENTER_BY_DIRECTION}
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                            width: "100%"
                        }}
                    >
                        {entries.map(renderHistoryRow)}
                    </Focusable>
                )}

                <div style={{ marginTop: "10px" }}>
                    <ConfirmRow
                        focusKey="calc:history:clear"
                        idleLabel={t(language, "Clear History")}
                        armedLabel={t(language, "Press Again to Clear History")}
                        disabled={entries.length === 0}
                        bottomSeparator="none"
                        onConfirm={wipeHistory}
                    />
                </div>

                <Focusable style={{ display: "flex", marginTop: "12px" }}>
                    <DialogButton onClick={close} style={{ width: "100%" }}>
                        {t(language, "Close")}
                    </DialogButton>
                </Focusable>
            </SaveOnStart>
        </ModalRoot>
    );
}

export function openCalculatorModal(language: LanguageCode) {
    showManagedModal((close) => (
        <CalculatorModal language={language} close={close} />
    ));
}
