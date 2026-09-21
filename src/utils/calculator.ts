type CalcOperator = "+" | "-" | "*" | "/" | "^";

export type CalcToken =
    | { kind: "num"; text: string }
    | { kind: "op"; op: CalcOperator }
    | { kind: "lparen" }
    | { kind: "rparen" }
    | { kind: "percent" }
    | { kind: "sqrt" };

export type CalcKey =
    | { press: "digit"; digit: string }
    | { press: "dot" }
    | { press: "op"; op: CalcOperator }
    | { press: "lparen" }
    | { press: "rparen" }
    | { press: "percent" }
    | { press: "sqrt" }
    | { press: "sign" }
    | { press: "back" }
    | { press: "clear" }
    | { press: "value"; text: string };

const MAX_DIGITS = 15;

const MINUS_SIGN = "−";

const OPERATOR_TEXT: Record<CalcOperator, string> = {
    "+": " + ",
    "-": ` ${MINUS_SIGN} `,
    "*": " × ",
    "/": " ÷ ",
    "^": "^"
};

function lastToken(tokens: CalcToken[]): CalcToken | null {
    if (tokens.length === 0) {
        return null;
    }
    return tokens[tokens.length - 1];
}

function closesValue(token: CalcToken | null): boolean {
    if (!token) {
        return false;
    }
    return token.kind === "num" || token.kind === "rparen" || token.kind === "percent";
}

function opensValue(token: CalcToken | null): boolean {
    if (!token) {
        return false;
    }
    return token.kind === "num" || token.kind === "lparen" || token.kind === "sqrt";
}

function openParenCount(tokens: CalcToken[]): number {
    let depth = 0;
    for (const token of tokens) {
        if (token.kind === "lparen") {
            depth += 1;
        }
        if (token.kind === "rparen" && depth > 0) {
            depth -= 1;
        }
    }
    return depth;
}

function digitCount(text: string): number {
    return text.replace("-", "").replace(".", "").length;
}

function pressDigit(tokens: CalcToken[], digit: string): CalcToken[] {
    const last = lastToken(tokens);
    if (!last || last.kind !== "num") {
        return [...tokens, { kind: "num", text: digit }];
    }
    if (digitCount(last.text) >= MAX_DIGITS) {
        return tokens;
    }

    const head = tokens.slice(0, -1);
    if (last.text === "0") {
        return [...head, { kind: "num", text: digit }];
    }
    if (last.text === "-0") {
        return [...head, { kind: "num", text: `-${digit}` }];
    }
    return [...head, { kind: "num", text: last.text + digit }];
}

function pressDot(tokens: CalcToken[]): CalcToken[] {
    const last = lastToken(tokens);
    if (!last || last.kind !== "num") {
        return [...tokens, { kind: "num", text: "0." }];
    }
    if (last.text.includes(".")) {
        return tokens;
    }
    if (last.text === "-") {
        return [...tokens.slice(0, -1), { kind: "num", text: "-0." }];
    }
    return [...tokens.slice(0, -1), { kind: "num", text: `${last.text}.` }];
}

function pressOperator(tokens: CalcToken[], op: CalcOperator): CalcToken[] {
    const last = lastToken(tokens);

    const settled = last && last.kind === "num" && last.text === "-"
        ? tokens.slice(0, -1)
        : tokens;
    const tail = lastToken(settled);

    if (!tail || tail.kind === "lparen") {
        if (op === "-") {
            return [...settled, { kind: "num", text: "-" }];
        }
        return settled;
    }
    if (tail.kind === "op") {
        return [...settled.slice(0, -1), { kind: "op", op }];
    }
    if (tail.kind === "sqrt") {
        return settled;
    }
    return [...settled, { kind: "op", op }];
}

function pressSign(tokens: CalcToken[]): CalcToken[] {
    const last = lastToken(tokens);
    if (last && last.kind === "num") {
        const flipped = last.text.startsWith("-") ? last.text.slice(1) : `-${last.text}`;
        return [...tokens.slice(0, -1), { kind: "num", text: flipped }];
    }
    if (!last || last.kind === "op" || last.kind === "lparen") {
        return [...tokens, { kind: "num", text: "-" }];
    }
    return tokens;
}

function pressBack(tokens: CalcToken[]): CalcToken[] {
    const last = lastToken(tokens);
    if (!last) {
        return tokens;
    }
    if (last.kind === "num" && last.text.length > 1) {
        return [...tokens.slice(0, -1), { kind: "num", text: last.text.slice(0, -1) }];
    }
    return tokens.slice(0, -1);
}

export function applyCalcKey(tokens: CalcToken[], key: CalcKey): CalcToken[] {
    if (key.press === "clear") {
        return [];
    }
    if (key.press === "back") {
        return pressBack(tokens);
    }
    if (key.press === "digit") {
        return pressDigit(tokens, key.digit);
    }
    if (key.press === "dot") {
        return pressDot(tokens);
    }
    if (key.press === "op") {
        return pressOperator(tokens, key.op);
    }
    if (key.press === "sign") {
        return pressSign(tokens);
    }
    if (key.press === "sqrt") {
        return [...tokens, { kind: "sqrt" }];
    }
    if (key.press === "lparen") {
        return [...tokens, { kind: "lparen" }];
    }
    if (key.press === "rparen") {
        if (openParenCount(tokens) === 0 || !closesValue(lastToken(tokens))) {
            return tokens;
        }
        return [...tokens, { kind: "rparen" }];
    }
    if (key.press === "percent") {
        if (!closesValue(lastToken(tokens))) {
            return tokens;
        }
        return [...tokens, { kind: "percent" }];
    }

    const last = lastToken(tokens);
    if (last && last.kind === "num") {
        return [...tokens.slice(0, -1), { kind: "num", text: key.text }];
    }
    return [...tokens, { kind: "num", text: key.text }];
}

export function calcExpressionText(tokens: CalcToken[]): string {
    let text = "";
    for (const token of tokens) {
        if (token.kind === "num") {
            text += token.text.startsWith("-")
                ? MINUS_SIGN + token.text.slice(1)
                : token.text;
        }
        else if (token.kind === "op") {
            text += OPERATOR_TEXT[token.op];
        }
        else if (token.kind === "lparen") {
            text += "(";
        }
        else if (token.kind === "rparen") {
            text += ")";
        }
        else if (token.kind === "percent") {
            text += "%";
        }
        else {
            text += "√";
        }
    }
    return text;
}

export function calcTokensAreBareNumber(tokens: CalcToken[]): boolean {
    return tokens.length === 1 && tokens[0].kind === "num";
}

class CalcFailure extends Error { }

type Cursor = { tokens: CalcToken[]; index: number };

type Reading = { value: number; percentOnly: boolean };

function peek(cursor: Cursor): CalcToken | null {
    if (cursor.index >= cursor.tokens.length) {
        return null;
    }
    return cursor.tokens[cursor.index];
}

function parsePrimary(cursor: Cursor): number {
    const token = peek(cursor);
    if (!token) {
        throw new CalcFailure();
    }
    if (token.kind === "num") {
        cursor.index += 1;
        const value = Number(token.text);
        if (!Number.isFinite(value)) {
            throw new CalcFailure();
        }
        return value;
    }
    if (token.kind === "lparen") {
        cursor.index += 1;
        const inner = parseSum(cursor);
        const next = peek(cursor);
        if (next && next.kind === "rparen") {
            cursor.index += 1;
        }
        return inner.value;
    }
    throw new CalcFailure();
}

function parseUnit(cursor: Cursor): Reading {
    const token = peek(cursor);
    if (token && token.kind === "sqrt") {
        cursor.index += 1;
        const inner = parseUnit(cursor);
        if (inner.value < 0) {
            throw new CalcFailure();
        }
        return { value: Math.sqrt(inner.value), percentOnly: false };
    }

    let value = parsePrimary(cursor);
    let percentOnly = false;
    for (;;) {
        const next = peek(cursor);
        if (!next || next.kind !== "percent") {
            return { value, percentOnly };
        }
        cursor.index += 1;
        value = value / 100;
        percentOnly = true;
    }
}

function parsePower(cursor: Cursor): Reading {
    const base = parseUnit(cursor);
    const token = peek(cursor);
    if (token && token.kind === "op" && token.op === "^") {
        cursor.index += 1;
        const exponent = parsePower(cursor);
        return { value: Math.pow(base.value, exponent.value), percentOnly: false };
    }
    return base;
}

function parseProduct(cursor: Cursor): Reading {
    let reading = parsePower(cursor);
    for (;;) {
        const token = peek(cursor);
        if (token && token.kind === "op" && (token.op === "*" || token.op === "/")) {
            cursor.index += 1;
            const right = parsePower(cursor);
            if (token.op === "/" && right.value === 0) {
                throw new CalcFailure();
            }
            const value = token.op === "*"
                ? reading.value * right.value
                : reading.value / right.value;
            reading = { value, percentOnly: false };
            continue;
        }
        if (opensValue(token)) {
            const right = parsePower(cursor);
            reading = { value: reading.value * right.value, percentOnly: false };
            continue;
        }
        return reading;
    }
}

function parseSum(cursor: Cursor): Reading {
    let reading = parseProduct(cursor);
    for (;;) {
        const token = peek(cursor);
        if (!token || token.kind !== "op" || (token.op !== "+" && token.op !== "-")) {
            return reading;
        }
        cursor.index += 1;
        const right = parseProduct(cursor);
        const amount = right.percentOnly ? reading.value * right.value : right.value;
        const value = token.op === "+" ? reading.value + amount : reading.value - amount;
        reading = { value, percentOnly: false };
    }
}

export function evaluateCalcTokens(tokens: CalcToken[]): number | null {
    if (tokens.length === 0) {
        return null;
    }

    const cursor: Cursor = { tokens, index: 0 };
    try {
        const reading = parseSum(cursor);
        if (cursor.index !== cursor.tokens.length) {
            return null;
        }
        if (!Number.isFinite(reading.value)) {
            return null;
        }
        return reading.value;
    }
    catch {
        return null;
    }
}

export function formatCalcNumber(value: number): string {
    const settled = Number(value.toPrecision(12));
    if (Object.is(settled, -0)) {
        return "0";
    }
    return String(settled);
}
