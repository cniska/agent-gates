import type { CommentsOf } from "./no-comments-languages";
import { lineEnd } from "./no-comments-route";
import { commentsAt, nestedBlockEnd, type Span } from "./no-comments-spans";

const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/;

const DOLLAR_TAG = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;

const ESCAPE_STRING_PREFIX = /^[Ee]$/;

function refusedSpans(text: string): Span[] | null {
  const spans: Span[] = [];
  const followsIdentifier = (index: number) => IDENTIFIER_CHAR.test(text[index - 1] ?? "");

  function quoted(start: number, to: number, backslashEscapes: boolean): number | null {
    const quote = text[start];
    let at = start + 1;
    while (at < to) {
      const char = text[at];
      if (backslashEscapes && char === "\\") at += 2;
      else if (char === quote && text[at + 1] === quote) at += 2;
      else if (char === quote) return at + 1;
      else at++;
    }
    return null;
  }

  function dollarQuoted(start: number, to: number): number | null {
    DOLLAR_TAG.lastIndex = start;
    const tag = DOLLAR_TAG.exec(text)?.[0];
    if (tag === undefined) return start + 1;
    const close = text.indexOf(tag, start + tag.length);
    if (close < 0 || close + tag.length > to) return null;
    const before = spans.length;
    if (!code(start + tag.length, close)) spans.splice(before);
    return close + tag.length;
  }

  function lineComment(start: number, to: number): number {
    const end = Math.min(lineEnd(text, start), to);
    spans.push({ start, end });
    return end;
  }

  function blockComment(start: number, to: number): number | null {
    const end = nestedBlockEnd(text, start, to);
    if (end !== null) spans.push({ start, end });
    return end;
  }

  function token(at: number, to: number): number | null {
    const char = text[at];
    if (text.startsWith("--", at)) return lineComment(at, to);
    if (text.startsWith("/*", at)) return blockComment(at, to);
    if (char === "'") {
      const escapes = ESCAPE_STRING_PREFIX.test(text[at - 1] ?? "") && !followsIdentifier(at - 1);
      return quoted(at, to, escapes);
    }
    if (char === '"') return quoted(at, to, false);
    if (char === "$" && !followsIdentifier(at)) return dollarQuoted(at, to);
    return at + 1;
  }

  function code(from: number, to: number): boolean {
    let at: number | null = from;
    while (at !== null && at < to) at = token(at, to);
    return at !== null;
  }

  return code(0, text.length) ? spans : null;
}

export const comments: CommentsOf = async (_path, text) => {
  const spans = refusedSpans(text);
  return spans === null ? null : commentsAt(text, spans);
};
