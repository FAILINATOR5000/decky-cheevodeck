type CalcOperator = "+" | "-" | "*" | "/" | "^";

type CalcNumber = { kind: "num"; text: string; value?: number; whole?: boolean; fixed?: boolean };

export type CalcToken =
    | CalcNumber
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

function opensValue(token: ParseToken | null): boolean {
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

function replaceFixed(tokens: CalcToken[], text: string): CalcToken[] {
    const head = tokens.slice(0, -1);
    const before = lastToken(head);
    if (before && before.kind === "num" && before.text === "-" && !before.whole) {
        return [...head.slice(0, -1), { kind: "num", text: `-${text}` }];
    }
    return [...head, { kind: "num", text }];
}

function pressDigit(tokens: CalcToken[], digit: string): CalcToken[] {
    const last = lastToken(tokens);
    if (!last || last.kind !== "num") {
        return [...tokens, { kind: "num", text: digit }];
    }
    if (last.fixed) {
        return replaceFixed(tokens, digit);
    }
    if (digitCount(last.text) >= MAX_DIGITS) {
        return tokens;
    }

    const head = tokens.slice(0, -1);
    if (last.text === "0") {
        return [...head, { ...last, text: digit }];
    }
    if (last.text === "-0") {
        return [...head, { ...last, text: `-${digit}` }];
    }
    return [...head, { ...last, text: last.text + digit }];
}

function pressDot(tokens: CalcToken[]): CalcToken[] {
    const last = lastToken(tokens);
    if (!last || last.kind !== "num") {
        return [...tokens, { kind: "num", text: "0." }];
    }
    if (last.fixed) {
        return replaceFixed(tokens, "0.");
    }
    if (last.text.includes(".")) {
        return tokens;
    }
    if (last.text === "-") {
        return [...tokens.slice(0, -1), { ...last, text: "-0." }];
    }
    return [...tokens.slice(0, -1), { ...last, text: `${last.text}.` }];
}

function pressOperator(tokens: CalcToken[], op: CalcOperator): CalcToken[] {
    const last = lastToken(tokens);

    const loneMinus = last !== null && last.kind === "num" && last.text === "-";
    const settled = loneMinus ? tokens.slice(0, -1) : tokens;
    const tail = lastToken(settled);

    if (!tail || tail.kind === "lparen") {
        if (op === "-") {
            return [...settled, { kind: "num", text: "-" }];
        }
        return settled;
    }
    if (tail.kind === "op") {
        if (op === "-" && !loneMinus) {
            return [...settled, { kind: "num", text: "-" }];
        }
        return [...settled.slice(0, -1), { kind: "op", op }];
    }
    if (tail.kind === "sqrt") {
        return settled;
    }
    return [...settled, { kind: "op", op }];
}

function flipSign(token: CalcNumber): CalcNumber {
    const text = token.text.startsWith("-") ? token.text.slice(1) : `-${token.text}`;
    if (token.value === undefined) {
        return { ...token, text, whole: true };
    }
    return { ...token, text, value: -token.value, whole: true };
}

function pressSign(tokens: CalcToken[]): CalcToken[] {
    const last = lastToken(tokens);
    if (last && last.kind === "num") {
        if (last.text === "-") {
            return tokens.slice(0, -1);
        }
        return [...tokens.slice(0, -1), flipSign(last)];
    }
    if (!last || last.kind === "op" || last.kind === "lparen") {
        return [...tokens, { kind: "num", text: "-", whole: true }];
    }
    return tokens;
}

function pressBack(tokens: CalcToken[]): CalcToken[] {
    const last = lastToken(tokens);
    if (!last) {
        return tokens;
    }
    if (last.kind === "num" && !last.fixed && last.text.length > 1) {
        return [...tokens.slice(0, -1), { ...last, text: last.text.slice(0, -1) }];
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

    const recalled: CalcNumber = { kind: "num", text: key.text, whole: true, fixed: true };
    const last = lastToken(tokens);
    if (last && last.kind === "num") {
        const head = tokens.slice(0, -1);
        if (last.text === "-" && last.whole) {
            return [...head, flipSign(recalled)];
        }
        if (last.text.startsWith("-") && !last.whole) {
            return [...head, { kind: "num", text: "-" }, recalled];
        }
        return [...head, recalled];
    }
    return [...tokens, recalled];
}

export function calcResultToken(value: number): CalcToken {
    return { kind: "num", text: formatCalcNumber(value), value, whole: true, fixed: true };
}

export function calcNumberText(text: string): string {
    return text.startsWith("-") ? MINUS_SIGN + text.slice(1) : text;
}

export function calcExpressionText(tokens: CalcToken[]): string {
    let text = "";
    for (const token of tokens) {
        if (token.kind === "num") {
            text += calcNumberText(token.text);
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

type ParseToken = CalcToken | { kind: "neg" };

type Cursor = { tokens: ParseToken[]; index: number };

type Reading = { value: number; percentOnly: boolean };

function peek(cursor: Cursor): ParseToken | null {
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
        const value = token.value ?? Number(token.text);
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
        const exponent = parseNegation(cursor);
        return { value: Math.pow(base.value, exponent.value), percentOnly: false };
    }
    return base;
}

function parseNegation(cursor: Cursor): Reading {
    const token = peek(cursor);
    if (token && token.kind === "neg") {
        cursor.index += 1;
        const inner = parseNegation(cursor);
        return { value: -inner.value, percentOnly: inner.percentOnly };
    }
    return parsePower(cursor);
}

function parseProduct(cursor: Cursor): Reading {
    let reading = parseNegation(cursor);
    for (;;) {
        const token = peek(cursor);
        if (token && token.kind === "op" && (token.op === "*" || token.op === "/")) {
            cursor.index += 1;
            const right = parseNegation(cursor);
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

function splitTypedMinus(tokens: CalcToken[]): ParseToken[] {
    const split: ParseToken[] = [];
    for (const token of tokens) {
        if (token.kind === "num" && token.text.startsWith("-") && (!token.whole || token.text === "-")) {
            split.push({ kind: "neg" });
            if (token.text !== "-") {
                split.push({ kind: "num", text: token.text.slice(1) });
            }
        }
        else {
            split.push(token);
        }
    }
    return split;
}

export function evaluateCalcTokens(tokens: CalcToken[]): number | null {
    if (tokens.length === 0) {
        return null;
    }

    const cursor: Cursor = { tokens: splitTypedMinus(tokens), index: 0 };
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
    if (Number.isSafeInteger(value)) {
        return String(value);
    }
    const settled = Number(value.toPrecision(12));
    if (Object.is(settled, -0)) {
        return "0";
    }
    return String(settled);
}
