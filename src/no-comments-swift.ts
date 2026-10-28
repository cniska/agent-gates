import { adapter, type Lexed, type Span } from "./no-comments-adapter";
import { type Brackets, bracketsOf } from "./no-comments-brackets";
import { SHEBANG_PREFIX } from "./no-comments-route";
import { lineEnd, nestedBlockEnd, type Stopped, unterminated } from "./no-comments-spans";
import {
  isIdentifierContinue,
  isIdentifierStart,
  isOperatorContinue,
  isOperatorStart,
} from "./no-comments-swift-chars";

type Before = "expression" | "argument" | "operand" | "period";

type StringKind = "line" | "multiline" | "quote";

type Interpolation = { readonly stringStart: number; readonly singleLine: boolean };

type RegexBody = { readonly body: number; readonly multiline: boolean };

type Regex = { readonly kind: "regex"; readonly end: number } | Stopped | null;

const LEXER_KEYWORDS = new Set(
  [
    "Any as associatedtype break case catch class continue default defer deinit do else enum extension",
    "fallthrough false fileprivate for func guard if import in init inout internal is let nil operator",
    "precedencegroup private protocol public repeat rethrows return self Self static struct subscript",
    "super switch throw throws true try typealias var where while",
  ]
    .join(" ")
    .split(" "),
);

const OPERAND_KEYWORDS = new Set(["true", "false", "Any", "nil", "self", "Self", "super"]);

const OPERATOR_KEYWORDS = new Set(["func", "operator"]);

const EXPRESSION_DIRECTIVES = new Set(["elseif", "endif"]);

const UNBOUND_BEFORE = " \r\n\t([{,;:\0\u00a0";

const UNBOUND_AFTER = " \r\n\t)]},;:\0\u00a0";

const NEWLINES = "\r\n";

const TRIVIA = " \t\v\f";

const DIGIT = /^[0-9]$/;

const HEX_DIGIT = /^[0-9A-Fa-f]$/;

const ASCII_LETTERS = /[A-Za-z]/y;

const COMMENT_START = /\/[/*]/g;

const BRACKET_BEFORE = {
  "(": "argument",
  "[": "argument",
  "{": "expression",
  ")": "operand",
  "]": "operand",
  "}": "operand",
} as const satisfies Readonly<Record<string, Before>>;

type BracketChar = keyof typeof BRACKET_BEFORE;

function isBracket(char: string): char is BracketChar {
  return Object.hasOwn(BRACKET_BEFORE, char);
}

function commentSpans(text: string): Lexed {
  const spans: Span[] = [];
  let at = text.startsWith(SHEBANG_PREFIX) ? lineEnd(text, 0) : 0;
  if (at > 0) spans.push({ start: 0, end: at, style: "line" });
  let before: Before = at > 0 ? "operand" : "expression";
  let keyword: string | null = null;
  let prefersRegex = false;

  const charAt = (index: number): string => {
    const point = text.codePointAt(index);
    return point === undefined ? "" : String.fromCodePoint(point);
  };

  function bump(): void {
    at += charAt(at).length;
  }

  const inExpressionPosition = () => before !== "operand" && before !== "period";

  function token(kind: Before, word: string | null = null): void {
    before = kind;
    keyword = word;
    prefersRegex = false;
  }

  function poundsAt(from: number): number {
    let end = from;
    while (text[end] === "#") end++;
    return end - from;
  }

  function hasPounds(from: number, count: number): boolean {
    return poundsAt(from) >= count;
  }

  function isLeftBound(start: number): boolean {
    if (start === 0) return false;
    const previous = text[start - 1] ?? "";
    if (UNBOUND_BEFORE.includes(previous)) return false;
    return !(previous === "/" && text[start - 2] === "*");
  }

  function isRightBound(end: number, leftBound: boolean): boolean {
    const next = text[end];
    if (next === undefined || UNBOUND_AFTER.includes(next)) return false;
    if (next === ".") return !leftBound;
    return !(next === "/" && (text[end + 1] === "/" || text[end + 1] === "*"));
  }

  function regexBodyStart(start: number, pounds: number, mustBeRegex: boolean): RegexBody | null {
    const slash = start + pounds;
    if (text[slash] !== "/") return null;
    const body = slash + 1;
    if (pounds === 0) {
      const next = text[body];
      if ((next === " " || next === "\t") && !mustBeRegex) return null;
      if (next === "*" || next === "/" || text[slash - 1] === "*") return null;
      return { body, multiline: false };
    }
    let scan = body;
    while (text[scan] === " " || text[scan] === "\t") scan++;
    if (text[scan] === "\n" || text[scan] === "\r") return { body: scan, multiline: true };
    return { body, multiline: false };
  }

  function regexAt(start: number, mustBeRegex: boolean): Regex {
    const pounds = poundsAt(start);
    const opened = regexBodyStart(start, pounds, mustBeRegex);
    if (opened === null) return null;
    const { body, multiline } = opened;
    const notClosed = mustBeRegex ? unterminated(start, "regex") : null;
    let cursor = body;
    let groups = 0;
    let classes = 0;
    let lastSpace = -1;
    while (true) {
      if (text[cursor] === "/" && poundsAt(cursor + 1) >= pounds) {
        const end = cursor + 1 + pounds;
        if (pounds > 0) return { kind: "regex", end };
        if (text[end] === "*" || text[end] === "/") return notClosed;
        if (lastSpace === cursor - 1 && !mustBeRegex) return null;
        return { kind: "regex", end };
      }
      const escaped = text[cursor] === "\\";
      if (escaped) cursor++;
      const char = text[cursor];
      if (char === undefined) return notClosed;
      if (NEWLINES.includes(char) && !multiline) return notClosed;
      cursor++;
      if (escaped) continue;
      if (char === "(" && classes === 0) groups++;
      else if (char === ")" && classes === 0) {
        if (groups > 0) groups--;
        else if (!mustBeRegex) return null;
      } else if (char === "[") classes++;
      else if (char === "]" && classes > 0) classes--;
      else if (char === " " || char === "\t") lastSpace = cursor - 1;
    }
  }

  function operatorRegex(start: number, end: number): Regex {
    const slash = text.indexOf("/", start);
    if (slash < 0 || slash >= end) return null;
    const leftBound = isLeftBound(start);
    if (leftBound || (keyword !== null && OPERATOR_KEYWORDS.has(keyword))) return null;
    let mustBeRegex = false;
    if (!isRightBound(end, leftBound)) {
      if (!prefersRegex && !inExpressionPosition()) return null;
      mustBeRegex = prefersRegex || before === "expression";
    }
    return regexAt(slash, mustBeRegex);
  }

  function operatorKind(start: number, end: number): Before {
    const leftBound = isLeftBound(start);
    const rightBound = isRightBound(end, leftBound);
    const spelled = text.slice(start, end);
    if (spelled === ".") return "period";
    if (spelled === "->") return "operand";
    if (spelled === "=") return "expression";
    if (spelled === "?") return leftBound ? "operand" : "expression";
    return leftBound && !rightBound ? "operand" : "expression";
  }

  function operator(): Stopped | null {
    const start = at;
    bump();
    while (!(text[at] === "." && text[start] !== ".") && isOperatorContinue(charAt(at))) bump();
    const regex = operatorRegex(start, at);
    if (regex?.kind === "stopped") return regex;
    if (regex?.kind === "regex") {
      at = regex.end;
      token("operand");
      return null;
    }
    if (at - start > 2) {
      COMMENT_START.lastIndex = start + 1;
      const found = COMMENT_START.exec(text);
      if (found !== null && found.index < at) at = found.index;
    }
    token(operatorKind(start, at));
    return null;
  }

  function number(): void {
    const hex = text.startsWith("0x", at);
    const digit = hex ? HEX_DIGIT : DIGIT;
    const exponent = hex ? "pP" : "eE";
    at += hex ? 2 : 1;
    let fraction = false;
    while (at < text.length) {
      const char = charAt(at);
      if (char === "." && !fraction && before !== "period" && digit.test(text[at + 1] ?? "")) {
        fraction = true;
        at++;
      } else if ((char === "+" || char === "-") && exponent.includes(text[at - 1] ?? "")) at++;
      else if (isIdentifierContinue(char)) bump();
      else break;
    }
  }

  function identifier(): void {
    const start = at;
    bump();
    while (isIdentifierContinue(charAt(at))) bump();
    const word = text.slice(start, at);
    if (!LEXER_KEYWORDS.has(word)) token("operand");
    else token(OPERAND_KEYWORDS.has(word) ? "operand" : "expression", word);
  }

  function escapedIdentifier(): void {
    let end = at + 1;
    while (end < text.length && text[end] !== "`" && !NEWLINES.includes(text[end] ?? "")) end++;
    at = text[end] === "`" ? end + 1 : at + 1;
    token("operand");
  }

  function pound(): Stopped | null {
    const start = at;
    const pounds = poundsAt(at);
    if (text[at + pounds] === '"') {
      at += pounds;
      return string(start, pounds);
    }
    const regex = regexAt(at, true);
    if (regex?.kind === "stopped") return regex;
    if (regex?.kind === "regex") {
      at = regex.end;
      token("operand");
      return null;
    }
    at++;
    ASCII_LETTERS.lastIndex = at;
    let end = at;
    while (ASCII_LETTERS.test(text)) end = ASCII_LETTERS.lastIndex;
    if (EXPRESSION_DIRECTIVES.has(text.slice(at, end))) {
      at = end;
      token("expression");
      return null;
    }
    token("operand");
    return null;
  }

  function opensMultiline(pounds: number): boolean {
    if (!text.startsWith('""', at)) return false;
    if (pounds === 0) return true;
    let scan = at + 2;
    if (hasPounds(scan, pounds)) return false;
    while (scan < text.length && !NEWLINES.includes(text[scan] ?? "")) {
      if (text[scan] === '"' && hasPounds(scan + 1, pounds)) return false;
      scan++;
    }
    return true;
  }

  function string(start: number, pounds: number): Stopped | null {
    const construct = pounds > 0 ? "raw string" : "string";
    const opening = text[at];
    at++;
    let kind: StringKind = opening === "'" ? "quote" : "line";
    if (kind === "line" && opensMultiline(pounds)) {
      kind = "multiline";
      at += 2;
    }
    while (at < text.length) {
      const char = text[at] ?? "";
      if (char === "\\" && hasPounds(at + 1, pounds)) {
        at += 1 + pounds;
        if (text[at] === "(") {
          at++;
          const stopped = code({ stringStart: start, singleLine: kind !== "multiline" });
          if (stopped !== null) return stopped;
        } else if (at < text.length && !NEWLINES.includes(text[at] ?? "")) bump();
        continue;
      }
      if (NEWLINES.includes(char) && kind !== "multiline") return unterminated(start, construct);
      at++;
      if (kind === "quote" ? char === "'" : char === '"' && closes(kind, pounds)) {
        at += (kind === "multiline" ? 2 : 0) + pounds;
        token("operand");
        return null;
      }
    }
    return unterminated(start, construct);
  }

  function closes(kind: StringKind, pounds: number): boolean {
    if (kind === "line") return hasPounds(at, pounds);
    return text.startsWith('""', at) && hasPounds(at + 2, pounds);
  }

  function lexToken(char: string, brackets: Brackets): Stopped | null {
    if (isBracket(char)) {
      const stopped = brackets.take(at, char);
      at++;
      token(BRACKET_BEFORE[char]);
      return stopped;
    }
    if (text.startsWith("::", at)) {
      at += 2;
      token("operand");
      return null;
    }
    if (char === "," || char === ":") {
      at++;
      token("argument");
      return null;
    }
    if (char === ";") {
      at++;
      token("expression");
      return null;
    }
    if (char === "@" || char === "\\") {
      at++;
      token("operand");
      return null;
    }
    if (char === "#") return pound();
    if (char === '"' || char === "'") return string(at, 0);
    if (char === "`") {
      escapedIdentifier();
      return null;
    }
    if (char === "$") {
      at++;
      while (isIdentifierContinue(charAt(at))) bump();
      token("operand");
      return null;
    }
    if (DIGIT.test(char)) {
      number();
      token("operand");
      return null;
    }
    if ((char === "!" || char === "?") && isLeftBound(at)) {
      const afterTry = keyword === "try";
      at++;
      token("operand");
      prefersRegex = afterTry;
      return null;
    }
    if (isIdentifierStart(char)) {
      identifier();
      return null;
    }
    if (isOperatorStart(char)) return operator();
    if (isIdentifierContinue(char)) {
      while (isIdentifierContinue(charAt(at))) bump();
      token("operand");
      return null;
    }
    bump();
    return null;
  }

  function code(interpolation: Interpolation | null): Stopped | null {
    const start = at;
    const brackets = bracketsOf(["(", "[", "{"]);
    while (at < text.length) {
      const char = charAt(at);
      if (NEWLINES.includes(char)) {
        if (interpolation?.singleLine) return unterminated(interpolation.stringStart, "string");
        at++;
      } else if (TRIVIA.includes(char)) at++;
      else if (text.startsWith("//", at)) {
        const end = lineEnd(text, at);
        spans.push({ start: at, end, style: "line" });
        at = end;
      } else if (text.startsWith("/*", at)) {
        const end = nestedBlockEnd(text, at, text.length);
        if (end === null) return unterminated(at, "comment");
        spans.push({ start: at, end, style: "block" });
        at = end;
      } else if (interpolation !== null && char === ")" && brackets.isEmpty()) {
        at++;
        token("operand");
        return null;
      } else {
        const stopped = lexToken(char, brackets);
        if (stopped !== null) return stopped;
      }
    }
    return brackets.unclosed() ?? (interpolation === null ? null : unterminated(start, "interpolation"));
  }

  const stopped = code(null);
  if (stopped !== null) return stopped;
  return { kind: "lexed", spans };
}

export const { comments } = adapter(commentSpans);
