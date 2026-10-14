import { parse, TomlError, type TomlTable } from "smol-toml";
import {
  adapter,
  type CommentRead,
  directive,
  type KeptForm,
  type Lexed,
  SHEBANG,
  type Span,
} from "./no-comments-adapter";
import { firstLine, lineCounter, lineEnd, type Stopped, textStart, unterminated } from "./no-comments-spans";

const OPENER = 1;

const IDENTIFIER_START = /^[\p{L}\p{Nl}_]$/u;

const IDENTIFIER_CONTINUE = /^[\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}]$/u;

const DIGIT = /^[0-9]$/;

const NUMBER_CHAR = /^[0-9A-Za-z_.]$/;

const DECIMAL_EXPONENT = /^[eE]$/;

const NON_DECIMAL_PREFIX = /^0[xXoObB]/;

const STRING_PREFIXES = new Set(["r", "u", "b", "f", "t", "br", "rb", "fr", "rf", "tr", "rt"]);

const LINE_ENDINGS = ["\r\n", "\n"] as const;

const BACKSLASH = "\\";

const BLANKS = new Set([" ", "\t", "\f", "\r"]);

const BRACKET_NAMES: ReadonlyMap<string, string> = new Map([
  ["(", "parenthesis"],
  ["[", "bracket"],
  ["{", "brace"],
]);

const CLOSERS = new Set([")", "]", "}"]);

const COMPOUND_KEYWORDS = new Set([
  "async",
  "case",
  "class",
  "def",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "if",
  "try",
  "while",
  "with",
]);

const LAMBDA = "lambda";

const SOFT_COMPOUND = "case";

const NAME_USES = new Set([":", ".", "="]);

const BLANK_LINE = /^[ \t\f]*(?:[#\r\n]|$)/;

const COOKIE = /^[ \t\f]*#.*?coding[:=][ \t]*[-\w.]+/;

const CODING =
  /[ \t\f]*(?:-\*-[ \t]*coding[:=][ \t]*[-\w.]+[ \t]*-\*-|coding[:=][ \t]*[-\w.]+|vim:[ \t]*set[ \t]+fileencoding=[-\w.]+[ \t]*:)/;

const ENCODING_NAME = /(?:coding[:=]|fileencoding=)[ \t]*([-\w.]+)/;

const UTF_8 = /^utf[-_]?8(?:[-_]|$)/i;

const SCRIPT_OPEN = "# /// script";

const SCRIPT_CLOSE = "# ///";

const SCRIPT_CONTENT = /^#(?: .*)?$/;

const SCRIPT_PREFIX = /^# ?/;

const TOML_COMMENT_START = "#";

const TOML_INVALID_WHERE_A_COMMENT_STARTS = "=";

const SCRIPT_KEYS = new Set(["requires-python", "dependencies", "tool"]);

type Code = {
  readonly kind: "string" | "newline" | "semicolon" | "header" | "open" | "close" | "other";
  readonly start: number;
  readonly end: number;
};

const STATEMENT_BOUNDARIES: ReadonlySet<Code["kind"]> = new Set(["newline", "semicolon", "header"]);

type Range = { readonly start: number; readonly end: number };

type Tokenized =
  | { readonly kind: "tokenized"; readonly code: readonly Code[]; readonly comments: readonly Range[] }
  | Stopped;

type PythonSpan = Span & { readonly cookieLine: boolean };

function lineEndingAt(text: string, at: number): string | null {
  return LINE_ENDINGS.find((ending) => text.startsWith(ending, at)) ?? null;
}

function tokensOf(text: string): Tokenized {
  const code: Code[] = [];
  const comments: Range[] = [];
  const brackets: { readonly at: number; readonly open: string }[] = [];
  let at = textStart(text);
  let statementStart = true;
  let compound = false;
  let lambdas = 0;
  let softKeyword = false;

  function push(kind: Code["kind"], start: number, end: number): void {
    code.push({ kind, start, end });
    softKeyword = false;
    const boundary = STATEMENT_BOUNDARIES.has(kind);
    if (boundary) {
      compound = false;
      lambdas = 0;
    }
    statementStart = boundary;
  }

  const charAt = (index: number): string => {
    const point = text.codePointAt(index);
    return point === undefined ? "" : String.fromCodePoint(point);
  };

  function comment(): void {
    const start = at;
    at = lineEnd(text, at);
    comments.push({ start, end: at });
  }

  function word(): string {
    const start = at;
    at += charAt(at).length;
    while (IDENTIFIER_CONTINUE.test(charAt(at))) at += charAt(at).length;
    return text.slice(start, at);
  }

  function number(): void {
    const start = at;
    const decimal = !NON_DECIMAL_PREFIX.test(text.slice(at, at + 2));
    while (at < text.length) {
      const char = text[at] ?? "";
      const sign = decimal && (char === "+" || char === "-") && DECIMAL_EXPONENT.test(text[at - 1] ?? "");
      if (at > start && !NUMBER_CHAR.test(char) && !sign) return;
      at++;
    }
  }

  function field(start: number, triple: boolean): Stopped | null {
    at++;
    let depth = 0;
    while (at < text.length) {
      const char = charAt(at);
      if (char === "#") comment();
      else if (char === "'" || char === '"') {
        const stopped = string(at, "");
        if (stopped !== null) return stopped;
      } else if (IDENTIFIER_START.test(char)) {
        const prefix = word().toLowerCase();
        if (STRING_PREFIXES.has(prefix) && (text[at] === "'" || text[at] === '"')) {
          const stopped = string(at - prefix.length, prefix);
          if (stopped !== null) return stopped;
        }
      } else if (BRACKET_NAMES.has(char)) {
        depth++;
        at++;
      } else if (char === "}" && depth === 0) {
        at++;
        return null;
      } else if (CLOSERS.has(char)) {
        depth = Math.max(0, depth - 1);
        at++;
      } else if (char === ":" && depth === 0) return spec(start, triple);
      else at += char.length;
    }
    return unterminated(start, "string");
  }

  function spec(start: number, triple: boolean): Stopped | null {
    at++;
    while (at < text.length) {
      const char = text[at];
      if (!triple && char === "\n") break;
      if (char === "}") {
        at++;
        return null;
      }
      if (char === "{") {
        const stopped = field(start, triple);
        if (stopped !== null) return stopped;
      } else at++;
    }
    return unterminated(start, "string");
  }

  function string(start: number, prefix: string): Stopped | null {
    const quote = text[at] ?? "";
    const triple = text.startsWith(quote.repeat(3), at);
    const close = triple ? quote.repeat(3) : quote;
    const formatted = prefix.includes("f") || prefix.includes("t");
    at += close.length;
    while (at < text.length) {
      if (text.startsWith(close, at)) {
        at += close.length;
        push("string", start, at);
        return null;
      }
      const char = text[at];
      if (!triple && char === "\n") break;
      if (char === BACKSLASH) {
        const escaped = at + BACKSLASH.length;
        at = escaped + (lineEndingAt(text, escaped) ?? text.charAt(escaped)).length;
      } else if (formatted && char === "{" && text[at + 1] === "{") at += 2;
      else if (formatted && char === "{") {
        const stopped = field(start, triple);
        if (stopped !== null) return stopped;
      } else at++;
    }
    return unterminated(start, "string");
  }

  while (at < text.length) {
    const start = at;
    const char = charAt(at);
    if (BLANKS.has(char)) {
      at++;
      continue;
    }
    if (char === "\n") {
      if (brackets.length === 0) push("newline", start, at + 1);
      at++;
      continue;
    }
    if (char === "#") {
      comment();
      continue;
    }
    if (char === BACKSLASH) {
      const ending = lineEndingAt(text, at + BACKSLASH.length);
      const end = at + BACKSLASH.length + (ending?.length ?? 0);
      if (end >= text.length) return unterminated(at, "line continuation");
      if (ending !== null) {
        at = end;
        continue;
      }
    }
    if (char === "'" || char === '"') {
      const stopped = string(start, "");
      if (stopped !== null) return stopped;
      continue;
    }
    if (IDENTIFIER_START.test(char)) {
      const name = word();
      const prefix = name.toLowerCase();
      if (STRING_PREFIXES.has(prefix) && (text[at] === "'" || text[at] === '"')) {
        const stopped = string(start, prefix);
        if (stopped !== null) return stopped;
      } else {
        const topLevel = brackets.length === 0;
        const opens = topLevel && statementStart && COMPOUND_KEYWORDS.has(name);
        if (topLevel && compound && name === LAMBDA) lambdas++;
        push("other", start, at);
        if (opens) compound = true;
        softKeyword = opens && name === SOFT_COMPOUND;
      }
      continue;
    }
    if (DIGIT.test(char) || (char === "." && DIGIT.test(text[at + 1] ?? ""))) {
      number();
      push("other", start, at);
      continue;
    }
    at += char.length;
    const topLevel = brackets.length === 0;
    if (softKeyword && NAME_USES.has(char)) compound = false;
    if (BRACKET_NAMES.has(char)) {
      brackets.push({ at: start, open: char });
      push("open", start, at);
    } else if (CLOSERS.has(char)) {
      brackets.pop();
      push("close", start, at);
    } else if (topLevel && char === ";") push("semicolon", start, at);
    else if (topLevel && compound && char === ":" && text[at] !== "=") {
      if (lambdas > 0) {
        lambdas--;
        push("other", start, at);
      } else push("header", start, at);
    } else push("other", start, at);
  }
  const unclosed = brackets.at(-1);
  if (unclosed !== undefined) return unterminated(unclosed.at, BRACKET_NAMES.get(unclosed.open) ?? "bracket");
  return { kind: "tokenized", code, comments };
}

function loneStrings(code: readonly Code[]): Range[] {
  const found: Range[] = [];
  let index = 0;
  while (index < code.length) {
    const previous = code[index - 1]?.kind;
    const lineStart = index === 0 || (previous !== undefined && STATEMENT_BOUNDARIES.has(previous));
    const first = code[index];
    if (!lineStart || first === undefined) {
      index++;
      continue;
    }
    const wrapped = first.kind === "open" && code[index + 1]?.kind === "string";
    let at = wrapped ? index + 1 : index;
    while (code[at]?.kind === "string") at++;
    if (wrapped && code[at]?.kind === "close") at++;
    const last = code[at - 1];
    const ends = code[at] === undefined || code[at]?.kind === "newline" || code[at]?.kind === "semicolon";
    const strings = at > index && (wrapped ? last?.kind === "close" : first.kind === "string");
    if (strings && ends && last !== undefined) found.push({ start: first.start, end: last.end });
    index = Math.max(at, index + 1);
  }
  return found;
}

function scriptBlocks(text: string, comments: readonly Range[]): Range[] {
  const textOf = (comment: Range) => text.slice(comment.start, comment.end).replace(/\r$/, "");
  const ownLine = (comment: Range) => comment.start === 0 || text[comment.start - 1] === "\n";
  const follows = (previous: Range, line: Range) =>
    ownLine(line) && text.slice(previous.end, line.start).replace(/\r/g, "") === "\n";

  function blockEnd(open: number): number | null {
    for (let at = open + 1; ; at++) {
      const line = comments[at];
      const previous = comments[at - 1];
      if (line === undefined || previous === undefined || !follows(previous, line)) return null;
      if (textOf(line) === SCRIPT_CLOSE) return at;
      if (!SCRIPT_CONTENT.test(textOf(line))) return null;
    }
  }

  const merged: Range[] = [];
  let index = 0;
  while (index < comments.length) {
    const open = comments[index];
    if (open === undefined) break;
    const end = ownLine(open) && textOf(open) === SCRIPT_OPEN ? blockEnd(index) : null;
    const close = end === null ? undefined : comments[end];
    if (end !== null && close !== undefined) {
      merged.push({ start: open.start, end: close.end });
      index = end + 1;
    } else {
      merged.push(open);
      index++;
    }
  }
  return merged;
}

function commentSpans(text: string): Lexed<PythonSpan, null> {
  const tokenized = tokensOf(text);
  if (tokenized.kind === "stopped") return tokenized;
  const head = firstLine(text);
  const secondLineCounts = BLANK_LINE.test(head) && !COOKIE.test(head);
  const lineAt = lineCounter(text);
  const comments = scriptBlocks(text, tokenized.comments).map((comment) => ({
    ...comment,
    style: text.slice(comment.start, comment.end).includes("\n") ? ("block" as const) : ("line" as const),
  }));
  const strings = loneStrings(tokenized.code).map((comment) => ({ ...comment, style: "docstring" as const }));
  const spans = [...comments, ...strings]
    .sort((a, b) => a.start - b.start)
    .map(({ start, end, style }): PythonSpan => {
      const line = lineAt(start);
      return {
        start,
        end,
        bodyStart: style === "docstring" ? start : start + OPENER,
        bodyEnd: end,
        style,
        cookieLine: style === "line" && (line === 1 || (line === 2 && secondLineCounts)),
      };
    });
  return { kind: "lexed", spans, facts: null };
}

type Read = CommentRead<PythonSpan, null>;

function scriptToml(body: string): string {
  return body
    .split("\n")
    .slice(1, -1)
    .map((line) => line.replace(SCRIPT_PREFIX, ""))
    .join("\n");
}

function tomlOf(toml: string): TomlTable | null {
  try {
    return parse(toml);
  } catch (error) {
    if (error instanceof TomlError) return null;
    throw error;
  }
}

function holdsNoComment(toml: string): boolean {
  return tomlOf(toml.replaceAll(TOML_COMMENT_START, TOML_INVALID_WHERE_A_COMMENT_STARTS)) !== null;
}

function isScriptMetadata(body: string): boolean {
  const toml = scriptToml(body);
  const table = tomlOf(toml);
  if (table === null || !holdsNoComment(toml)) return false;
  return Object.keys(table).every((key) => SCRIPT_KEYS.has(key));
}

function namesUtf8(cookie: string): boolean {
  const name = ENCODING_NAME.exec(cookie)?.[1];
  return name !== undefined && UTF_8.test(name);
}

const KEPT: readonly KeptForm<Read>[] = [
  SHEBANG,
  directive(
    "the PEP 263 coding declaration of a non-UTF-8 encoding on line 1, or on line 2 under a blank or comment line",
    {
      pattern: CODING,
      where: ({ span, body }) => span.cookieLine && !namesUtf8(body),
    },
  ),
  {
    shown:
      "a PEP 723 `# /// script` block of TOML holding only `requires-python`, `dependencies` and `[tool.*]`, and no comment",
    keeps: ({ span, body }) => span.style === "block" && isScriptMetadata(body),
  },
];

export const { comments, kept } = adapter({ lex: commentSpans, kept: KEPT });
