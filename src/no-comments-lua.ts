import { adapter, type Lexed, type Span } from "./no-comments-adapter";
import { lineEnd, type Stopped, unexpected, unterminated } from "./no-comments-spans";

const SKIPPED_FIRST_LINE = "#";

const COMMENT = "--";

const LEVEL = "=";

const ESCAPE = "\\";

const CRLF = "\r\n";

const STRING_ENDS = new Set(["\n", "\r"]);

type Bracket = { readonly kind: "long"; readonly level: number; readonly end: number };

type Opening = Bracket | { readonly kind: "invalid"; readonly end: number } | null;

function longBracketAt(text: string, at: number): Opening {
  if (text[at] !== "[") return null;
  let end = at + 1;
  while (text[end] === LEVEL) end++;
  if (text[end] === "[") return { kind: "long", level: end - at - 1, end: end + 1 };
  return end === at + 1 ? null : { kind: "invalid", end };
}

function longBracketEnd(text: string, { level, end }: Bracket): number | null {
  const close = `]${LEVEL.repeat(level)}]`;
  const found = text.indexOf(close, end);
  return found < 0 ? null : found + close.length;
}

function commentSpans(text: string): Lexed {
  const spans: Span[] = [];
  let at = 0;

  if (text.startsWith(SKIPPED_FIRST_LINE)) {
    at = lineEnd(text, 0);
    spans.push({ start: 0, end: at, style: "line" });
  }

  function comment(): Stopped | null {
    const start = at;
    const bracket = longBracketAt(text, at + COMMENT.length);
    if (bracket?.kind !== "long") {
      at = lineEnd(text, at);
      spans.push({ start, end: at, style: "line" });
      return null;
    }
    const end = longBracketEnd(text, bracket);
    if (end === null) return unterminated(start, "comment");
    at = end;
    spans.push({ start, end, style: "block" });
    return null;
  }

  function longString(): Stopped | null {
    const bracket = longBracketAt(text, at);
    if (bracket === null) {
      at++;
      return null;
    }
    if (bracket.kind === "invalid") return unexpected(at, text.slice(at, bracket.end));
    const end = longBracketEnd(text, bracket);
    if (end === null) return unterminated(at, "long string");
    at = end;
    return null;
  }

  function quoted(): Stopped | null {
    const start = at;
    const quote = text[at];
    at++;
    while (at < text.length) {
      const char = text[at] ?? "";
      if (char === quote) {
        at++;
        return null;
      }
      if (STRING_ENDS.has(char)) break;
      if (char === ESCAPE) at += text.startsWith(CRLF, at + 1) ? 1 + CRLF.length : 2;
      else at++;
    }
    return unterminated(start, "string");
  }

  while (at < text.length) {
    const char = text[at];
    let stopped: Stopped | null = null;
    if (text.startsWith(COMMENT, at)) stopped = comment();
    else if (char === "[") stopped = longString();
    else if (char === '"' || char === "'") stopped = quoted();
    else at++;
    if (stopped !== null) return stopped;
  }
  return { kind: "lexed", spans };
}

export const { comments } = adapter(commentSpans);
