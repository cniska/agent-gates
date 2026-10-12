import type { CommentsOf } from "./no-comments-languages";
import { SHEBANG_PREFIX } from "./no-comments-route";
import {
  type Lexed,
  lineEnd,
  nestedBlockEnd,
  refusedComments,
  type Span,
  type Stopped,
  unterminated,
} from "./no-comments-spans";

const IDENTIFIER_START = /^[\p{XID_Start}_]$/u;

const IDENTIFIER_CONTINUE = /^\p{XID_Continue}$/u;

const NON_ASCII_EMOJI = /^(?![\0-\x7f])\p{Emoji}$/u;

const DIGIT = /^[0-9]$/;

const STRING_PREFIXES = ["br", "cr", "b", "c", "r"] as const;

const WHITESPACE = "[\\t\\n\\v\\f\\r \\u0085\\u200e\\u200f\\u2028\\u2029]";

const WHITESPACE_CHAR = new RegExp(`^${WHITESPACE}$`);

const DOC_TEXT_WORD = "doc";

const SHEBANG_TRIVIA = new RegExp(`${WHITESPACE}+|//(?![!/])[^\\n]*|////[^\\n]*`, "y");

const PLAIN_BLOCK_COMMENT = /\/\*(?!!)(?!\*(?![*/]))/y;

function shebangEnd(text: string): number {
  if (!text.startsWith(SHEBANG_PREFIX)) return 0;
  let at = SHEBANG_PREFIX.length;
  while (at < text.length) {
    SHEBANG_TRIVIA.lastIndex = at;
    if (SHEBANG_TRIVIA.test(text)) {
      at = SHEBANG_TRIVIA.lastIndex;
      continue;
    }
    PLAIN_BLOCK_COMMENT.lastIndex = at;
    const end = PLAIN_BLOCK_COMMENT.test(text) ? nestedBlockEnd(text, at, text.length) : null;
    if (end === null) break;
    at = end;
  }
  return text[at] === "[" ? 0 : lineEnd(text, 0);
}

function commentSpans(text: string): Lexed {
  const spans: Span[] = [];
  let carriesDocText = false;
  let at = shebangEnd(text);

  const charAt = (index: number): string => {
    const code = text.codePointAt(index);
    return code === undefined ? "" : String.fromCodePoint(code);
  };
  const isIdentifierStart = (index: number) => IDENTIFIER_START.test(charAt(index));
  const isIdentifierContinue = (index: number) => IDENTIFIER_CONTINUE.test(charAt(index));
  const isEmoji = (index: number) => NON_ASCII_EMOJI.test(charAt(index));

  function bump(): void {
    at += charAt(at).length;
  }

  function word(): void {
    while (isIdentifierContinue(at) || isEmoji(at)) bump();
  }

  function suffixed(stopped: Stopped | null): Stopped | null {
    if (stopped === null && isIdentifierStart(at)) word();
    return stopped;
  }

  function lineComment(): void {
    const start = at;
    at = lineEnd(text, at);
    spans.push({ start, end: at });
  }

  function blockComment(): Stopped | null {
    const end = nestedBlockEnd(text, at, text.length);
    if (end === null) return unterminated(at, "comment");
    spans.push({ start: at, end });
    at = end;
    return null;
  }

  function quoted(): Stopped | null {
    const start = at;
    at++;
    while (at < text.length) {
      const char = text[at];
      at++;
      if (char === '"') return null;
      if (char === "\\" && (text[at] === "\\" || text[at] === '"')) at++;
    }
    return unterminated(start, "string");
  }

  function rawQuoted(): Stopped | null {
    const hashesFrom = at;
    while (text[at] === "#") at++;
    const close = `"${text.slice(hashesFrom, at)}`;
    if (text[at] !== '"') return unterminated(hashesFrom, "raw string");
    const end = text.indexOf(close, at + 1);
    if (end < 0) return unterminated(hashesFrom, "raw string");
    at = end + close.length;
    return null;
  }

  function singleQuoted(): Stopped | null {
    const start = at;
    at++;
    const first = charAt(at);
    if (first !== "\\" && charAt(at + first.length) === "'") {
      at += first.length + 1;
      return null;
    }
    while (at < text.length) {
      const char = text[at];
      if (char === "'") {
        at++;
        return null;
      }
      if (char === "/" || (char === "\n" && text[at + 1] !== "'")) return unterminated(start, "character");
      if (char === "\\") bump();
      bump();
    }
    return unterminated(start, "character");
  }

  function lifetimeOrChar(): Stopped | null {
    const first = charAt(at + 1);
    const second = charAt(at + 1 + first.length);
    const canBeLifetime = second !== "'" && (IDENTIFIER_START.test(first) || DIGIT.test(first));
    if (!canBeLifetime) return suffixed(singleQuoted());
    at++;
    if (first === "r" && second === "#" && isIdentifierStart(at + 2)) at += 2;
    bump();
    word();
    if (text[at] === "'") at++;
    return null;
  }

  function literal(prefix: string): Stopped | null {
    at += prefix.length;
    if (prefix.endsWith("r")) return suffixed(rawQuoted());
    return suffixed(text[at] === "'" ? singleQuoted() : quoted());
  }

  function identifier(): Stopped | null {
    if (text[at] === "r" && text[at + 1] === "#" && isIdentifierStart(at + 2)) {
      at += 2;
      word();
      return null;
    }
    const prefix = STRING_PREFIXES.find((candidate) => opensLiteral(candidate));
    if (prefix !== undefined) return literal(prefix);
    const start = at;
    word();
    if (text.slice(start, at) === DOC_TEXT_WORD && isSingleEquals(afterTrivia(at))) carriesDocText = true;
    return null;
  }

  function isSingleEquals(index: number): boolean {
    return text[index] === "=" && text[index + 1] !== "=" && text[index + 1] !== ">";
  }

  function afterTrivia(from: number): number {
    let index = from;
    while (index < text.length) {
      if (WHITESPACE_CHAR.test(text[index] ?? "")) index++;
      else if (text.startsWith("//", index)) index = lineEnd(text, index);
      else if (!text.startsWith("/*", index)) return index;
      else {
        const end = nestedBlockEnd(text, index, text.length);
        if (end === null) return index;
        index = end;
      }
    }
    return index;
  }

  function opensLiteral(prefix: string): boolean {
    if (!text.startsWith(prefix, at)) return false;
    const next = text[at + prefix.length];
    if (prefix.endsWith("r")) return next === '"' || next === "#";
    return next === '"' || (prefix === "b" && next === "'");
  }

  function opensAttribute(): boolean {
    let index = afterTrivia(at + 1);
    if (text[index] === "!") index = afterTrivia(index + 1);
    return text[index] === "[";
  }

  function attribute(): Stopped | null {
    const start = at;
    const firstInside = spans.length;
    const outerCarriesDocText = carriesDocText;
    carriesDocText = false;
    at++;
    while (text[at] !== "[") {
      const stopped = token();
      if (stopped !== null) return stopped;
    }
    at++;
    const stopped = code(true);
    if (stopped !== null) return stopped;
    if (carriesDocText) spans.splice(firstInside, Infinity, { start, end: at });
    carriesDocText ||= outerCarriesDocText;
    return null;
  }

  function token(): Stopped | null {
    const char = text[at];
    if (text.startsWith("//", at)) lineComment();
    else if (text.startsWith("/*", at)) return blockComment();
    else if (char === '"') return suffixed(quoted());
    else if (char === "'") return lifetimeOrChar();
    else if (isIdentifierStart(at) || isEmoji(at) || DIGIT.test(char ?? "")) return identifier();
    else bump();
    return null;
  }

  function code(closesBracket: boolean): Stopped | null {
    let depth = 0;
    while (at < text.length) {
      const char = text[at];
      let stopped: Stopped | null = null;
      if (char === "#" && opensAttribute()) stopped = attribute();
      else if (char === "[") {
        depth++;
        at++;
      } else if (char === "]") {
        at++;
        if (closesBracket && depth === 0) return null;
        depth--;
      } else stopped = token();
      if (stopped !== null) return stopped;
    }
    return null;
  }

  return code(false) ?? { kind: "lexed", spans };
}

function isKept(): boolean {
  return false;
}

export const comments: CommentsOf = refusedComments(commentSpans, isKept);
