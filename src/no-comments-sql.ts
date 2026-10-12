import type { CommentsOf } from "./no-comments-languages";
import {
  type Lexed,
  lineEnd,
  nestedBlockEnd,
  refusedComments,
  type Span,
  type Stopped,
  unterminated,
} from "./no-comments-spans";

const POSTGRES_LETTER = "A-Za-z\\u0080-\\uffff_";

const IDENTIFIER_CHAR = new RegExp(`[${POSTGRES_LETTER}0-9$]`);

const DOLLAR_TAG = new RegExp(`\\$(?:[${POSTGRES_LETTER}][${POSTGRES_LETTER}0-9]*)?\\$`, "y");

const ESCAPE_STRING_PREFIX = /^[Ee]$/;

const DRIZZLE_STATEMENT_BREAKPOINT = "--> statement-breakpoint";

function commentSpans(text: string): Lexed {
  const spans: Span[] = [];
  const followsIdentifier = (index: number) => IDENTIFIER_CHAR.test(text[index - 1] ?? "");

  function quoted(start: number, to: number, backslashEscapes: boolean): number | Stopped {
    const quote = text[start];
    let at = start + 1;
    while (at < to) {
      const char = text[at];
      if (backslashEscapes && char === "\\") at += 2;
      else if (char === quote && text[at + 1] === quote) at += 2;
      else if (char === quote) return at + 1;
      else at++;
    }
    return unterminated(start, "quote");
  }

  function dollarQuoted(start: number, to: number): number | Stopped {
    DOLLAR_TAG.lastIndex = start;
    const tag = DOLLAR_TAG.exec(text)?.[0];
    if (tag === undefined) return start + 1;
    const close = text.indexOf(tag, start + tag.length);
    if (close < 0 || close + tag.length > to) return unterminated(start, "dollar quote");
    const before = spans.length;
    if (code(start + tag.length, close) !== null) spans.splice(before);
    return close + tag.length;
  }

  function lineComment(start: number, to: number): number {
    const end = Math.min(lineEnd(text, start), to);
    spans.push({ start, end });
    return end;
  }

  function blockComment(start: number, to: number): number | Stopped {
    const end = nestedBlockEnd(text, start, to);
    if (end === null) return unterminated(start, "comment");
    spans.push({ start, end });
    return end;
  }

  function token(at: number, to: number): number | Stopped {
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

  function code(from: number, to: number): Stopped | null {
    let at = from;
    while (at < to) {
      const next = token(at, to);
      if (typeof next !== "number") return next;
      at = next;
    }
    return null;
  }

  return code(0, text.length) ?? { kind: "lexed", spans };
}

function isKept(text: string, { start, end }: Span): boolean {
  return text.slice(start, end).trim() === DRIZZLE_STATEMENT_BREAKPOINT;
}

export const comments: CommentsOf = refusedComments(commentSpans, isKept);
