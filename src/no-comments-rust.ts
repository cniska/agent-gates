import type { CommentsOf } from "./no-comments-languages";
import { lineEnd, SHEBANG_PREFIX } from "./no-comments-route";
import { nestedBlockEnd, refusedComments, type Span } from "./no-comments-spans";

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

function commentSpans(text: string): Span[] | null {
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

  function suffixed(closed: boolean): boolean {
    if (closed && isIdentifierStart(at)) word();
    return closed;
  }

  function lineComment(): void {
    const start = at;
    at = lineEnd(text, at);
    spans.push({ start, end: at });
  }

  function blockComment(): boolean {
    const end = nestedBlockEnd(text, at, text.length);
    if (end === null) return false;
    spans.push({ start: at, end });
    at = end;
    return true;
  }

  function quoted(): boolean {
    at++;
    while (at < text.length) {
      const char = text[at];
      at++;
      if (char === '"') return true;
      if (char === "\\" && (text[at] === "\\" || text[at] === '"')) at++;
    }
    return false;
  }

  function rawQuoted(): boolean {
    const hashesFrom = at;
    while (text[at] === "#") at++;
    const close = `"${text.slice(hashesFrom, at)}`;
    if (text[at] !== '"') return false;
    const end = text.indexOf(close, at + 1);
    if (end < 0) return false;
    at = end + close.length;
    return true;
  }

  function singleQuoted(): boolean {
    at++;
    const first = charAt(at);
    if (first !== "\\" && charAt(at + first.length) === "'") {
      at += first.length + 1;
      return true;
    }
    while (at < text.length) {
      const char = text[at];
      if (char === "'") {
        at++;
        return true;
      }
      if (char === "/" || (char === "\n" && text[at + 1] !== "'")) return false;
      if (char === "\\") bump();
      bump();
    }
    return false;
  }

  function lifetimeOrChar(): boolean {
    const first = charAt(at + 1);
    const second = charAt(at + 1 + first.length);
    const canBeLifetime = second !== "'" && (IDENTIFIER_START.test(first) || DIGIT.test(first));
    if (!canBeLifetime) return suffixed(singleQuoted());
    at++;
    if (first === "r" && second === "#" && isIdentifierStart(at + 2)) at += 2;
    bump();
    word();
    if (text[at] === "'") at++;
    return true;
  }

  function literal(prefix: string): boolean {
    at += prefix.length;
    if (prefix.endsWith("r")) return suffixed(rawQuoted());
    return suffixed(text[at] === "'" ? singleQuoted() : quoted());
  }

  function identifier(): boolean {
    if (text[at] === "r" && text[at + 1] === "#" && isIdentifierStart(at + 2)) {
      at += 2;
      word();
      return true;
    }
    const prefix = STRING_PREFIXES.find((candidate) => opensLiteral(candidate));
    if (prefix !== undefined) return literal(prefix);
    const start = at;
    word();
    if (text.slice(start, at) === DOC_TEXT_WORD && isSingleEquals(afterTrivia(at))) carriesDocText = true;
    return true;
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

  function attribute(): boolean {
    const start = at;
    const firstInside = spans.length;
    const outerCarriesDocText = carriesDocText;
    carriesDocText = false;
    at++;
    while (text[at] !== "[") if (!token()) return false;
    at++;
    if (!code(true)) return false;
    if (carriesDocText) spans.splice(firstInside, Infinity, { start, end: at });
    carriesDocText ||= outerCarriesDocText;
    return true;
  }

  function token(): boolean {
    const char = text[at];
    if (text.startsWith("//", at)) lineComment();
    else if (text.startsWith("/*", at)) return blockComment();
    else if (char === '"') return suffixed(quoted());
    else if (char === "'") return lifetimeOrChar();
    else if (isIdentifierStart(at) || isEmoji(at) || DIGIT.test(char ?? "")) return identifier();
    else bump();
    return true;
  }

  function code(closesBracket: boolean): boolean {
    let depth = 0;
    while (at < text.length) {
      const char = text[at];
      if (char === "#" && opensAttribute()) {
        if (!attribute()) return false;
      } else if (char === "[") {
        depth++;
        at++;
      } else if (char === "]") {
        at++;
        if (closesBracket && depth === 0) return true;
        depth--;
      } else if (!token()) return false;
    }
    return true;
  }

  return code(false) ? spans : null;
}

function isKept(): boolean {
  return false;
}

export const comments: CommentsOf = refusedComments(commentSpans, isKept);
