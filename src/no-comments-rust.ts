import { adapter, type Lexed, SHEBANG, type Span, type Style } from "./no-comments-adapter";
import { SHEBANG_PREFIX } from "./no-comments-route";
import { lineEnd, nestedBlockEnd, type Stopped, unterminated } from "./no-comments-spans";

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

const OPENER = 2;

const BLOCK_CLOSER = 2;

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

type CodeKind = "word" | "number" | "lifetime" | "literal" | "punct";

type Lexeme = { readonly kind: CodeKind; readonly stopped: Stopped | null };

type Token =
  | {
      readonly kind: "comment";
      readonly start: number;
      readonly end: number;
      readonly style: "line" | "block";
    }
  | { readonly kind: CodeKind; readonly start: number; readonly end: number };

type Tokenized = { readonly kind: "tokenized"; readonly tokens: readonly Token[] } | Stopped;

function tokensOf(text: string): Tokenized {
  const tokens: Token[] = [];
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

  function lifetimeOrChar(): Lexeme {
    const first = charAt(at + 1);
    const second = charAt(at + 1 + first.length);
    const canBeLifetime = second !== "'" && (IDENTIFIER_START.test(first) || DIGIT.test(first));
    if (!canBeLifetime) return { kind: "literal", stopped: suffixed(singleQuoted()) };
    at++;
    if (first === "r" && second === "#" && isIdentifierStart(at + 2)) at += 2;
    bump();
    word();
    if (text[at] === "'") at++;
    return { kind: "lifetime", stopped: null };
  }

  function opensLiteral(prefix: string): boolean {
    if (!text.startsWith(prefix, at)) return false;
    const next = text[at + prefix.length];
    if (prefix.endsWith("r")) return next === '"' || next === "#";
    return next === '"' || (prefix === "b" && next === "'");
  }

  function literal(prefix: string): Stopped | null {
    at += prefix.length;
    if (prefix.endsWith("r")) return suffixed(rawQuoted());
    return suffixed(text[at] === "'" ? singleQuoted() : quoted());
  }

  function identifier(): Lexeme {
    if (text[at] === "r" && text[at + 1] === "#" && isIdentifierStart(at + 2)) {
      at += 2;
      word();
      return { kind: "word", stopped: null };
    }
    const prefix = STRING_PREFIXES.find((candidate) => opensLiteral(candidate));
    if (prefix !== undefined) return { kind: "literal", stopped: literal(prefix) };
    const kind = DIGIT.test(text[at] ?? "") ? "number" : "word";
    word();
    return { kind, stopped: null };
  }

  function codeToken(char: string): Lexeme {
    if (char === '"') return { kind: "literal", stopped: suffixed(quoted()) };
    if (char === "'") return lifetimeOrChar();
    if (isIdentifierStart(at) || isEmoji(at) || DIGIT.test(char)) return identifier();
    bump();
    return { kind: "punct", stopped: null };
  }

  while (at < text.length) {
    const start = at;
    const char = text[at] ?? "";
    if (WHITESPACE_CHAR.test(char)) {
      at++;
      continue;
    }
    if (text.startsWith("//", at)) {
      at = lineEnd(text, at);
      tokens.push({ kind: "comment", start, end: at, style: "line" });
      continue;
    }
    if (text.startsWith("/*", at)) {
      const end = nestedBlockEnd(text, at, text.length);
      if (end === null) return unterminated(at, "comment");
      at = end;
      tokens.push({ kind: "comment", start, end, style: "block" });
      continue;
    }
    const { kind, stopped } = codeToken(char);
    if (stopped !== null) return stopped;
    tokens.push({ kind, start, end: at });
  }
  return { kind: "tokenized", tokens };
}

function spansOf(text: string, tokens: readonly Token[]): Span[] {
  const spans: Span[] = [];
  let carriesDocText = false;
  let index = 0;

  const textOf = (at: number): string => {
    const token = tokens[at];
    return token === undefined ? "" : text.slice(token.start, token.end);
  };
  const isPunct = (at: number, char: string) => tokens[at]?.kind === "punct" && textOf(at) === char;

  function nextCode(from: number): number {
    let at = from;
    while (tokens[at]?.kind === "comment") at++;
    return at;
  }

  function found(start: number, end: number, style: Style): void {
    const bodyStart = style === "attribute" ? start : start + OPENER;
    const bodyEnd = style === "block" ? end - BLOCK_CLOSER : end;
    spans.push({ start, end, bodyStart, bodyEnd, style });
  }

  function isSingleEquals(at: number): boolean {
    const token = tokens[at];
    if (token === undefined || !isPunct(at, "=")) return false;
    const joined = tokens[at + 1]?.start === token.end;
    return !(joined && (isPunct(at + 1, "=") || isPunct(at + 1, ">")));
  }

  function visit(at: number): void {
    const token = tokens[at];
    if (token === undefined) return;
    if (token.kind === "comment") found(token.start, token.end, token.style);
    if (token.kind === "word" && textOf(at) === DOC_TEXT_WORD && isSingleEquals(nextCode(at + 1)))
      carriesDocText = true;
  }

  function bracketAfterHash(hash: number): number | null {
    let next = nextCode(hash + 1);
    if (isPunct(next, "!")) next = nextCode(next + 1);
    return isPunct(next, "[") ? next : null;
  }

  function attribute(hash: number, bracket: number): void {
    const start = tokens[hash]?.start ?? text.length;
    const firstInside = spans.length;
    const outerCarriesDocText = carriesDocText;
    carriesDocText = false;
    for (let at = hash + 1; at < bracket; at++) visit(at);
    index = bracket + 1;
    const closed = code(true);
    if (carriesDocText) {
      spans.splice(firstInside, Infinity);
      found(start, closed ? (tokens[index - 1]?.end ?? text.length) : text.length, "attribute");
    }
    carriesDocText ||= outerCarriesDocText;
  }

  function code(closesBracket: boolean): boolean {
    let depth = 0;
    while (index < tokens.length) {
      const bracket = isPunct(index, "#") ? bracketAfterHash(index) : null;
      if (bracket !== null) {
        attribute(index, bracket);
        continue;
      }
      if (isPunct(index, "[")) depth++;
      else if (isPunct(index, "]")) {
        if (closesBracket && depth === 0) {
          index++;
          return true;
        }
        depth--;
      } else visit(index);
      index++;
    }
    return false;
  }

  code(false);
  return spans;
}

function commentSpans(text: string): Lexed<Span, null> {
  const tokenized = tokensOf(text);
  if (tokenized.kind === "stopped") return tokenized;
  const end = shebangEnd(text);
  const shebang: Span[] =
    end === 0 ? [] : [{ start: 0, end, bodyStart: SHEBANG_PREFIX.length, bodyEnd: end, style: "line" }];
  return { kind: "lexed", spans: [...shebang, ...spansOf(text, tokenized.tokens)], facts: null };
}

export const { comments, kept } = adapter({
  lex: commentSpans,
  kept: [SHEBANG],
});
