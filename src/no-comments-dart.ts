import { bracketsOf } from "./no-comments-brackets";
import { type KeptForm, shownOf } from "./no-comments-kept";
import type { CommentsOf } from "./no-comments-languages";
import { SHEBANG_PREFIX } from "./no-comments-route";
import {
  type Lexed,
  lineEnd,
  nestedBlockEnd,
  refusedComments,
  type Span,
  type Spanned,
  type Stopped,
  unterminated,
} from "./no-comments-spans";

const LINE_COMMENT = "//";

const DOC_SLASH_AND_SPACE = /^\/?\s*/;

const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/;

function commentSpans(text: string): Lexed {
  const spans: Span[] = [];
  let at = text.startsWith(SHEBANG_PREFIX) ? lineEnd(text, 0) : 0;

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

  function string(raw: boolean): Stopped | null {
    const start = at;
    const quote = text[at] ?? "";
    const close = text.startsWith(quote.repeat(3), at) ? quote.repeat(3) : quote;
    at += close.length;
    while (at < text.length) {
      if (text.startsWith(close, at)) {
        at += close.length;
        return null;
      }
      const char = text[at];
      if (close.length === 1 && char === "\n") return unterminated(start, "string");
      if (!raw && char === "\\") at += 2;
      else if (!raw && char === "$" && text[at + 1] === "{") {
        at += 2;
        const stopped = code(true);
        if (stopped !== null) return stopped;
      } else at++;
    }
    return unterminated(start, "string");
  }

  function code(closesInterpolation: boolean): Stopped | null {
    const start = at;
    const brackets = bracketsOf(["(", "[", "{"]);
    while (at < text.length) {
      const char = text[at] ?? "";
      const next = text[at + 1];
      let stopped: Stopped | null = null;
      if (char === "/" && next === "/") lineComment();
      else if (char === "/" && next === "*") stopped = blockComment();
      else if (char === "'" || char === '"') stopped = string(false);
      else if (char === "r" && (next === "'" || next === '"') && !IDENTIFIER_CHAR.test(text[at - 1] ?? "")) {
        at++;
        stopped = string(true);
      } else if (closesInterpolation && char === "}" && brackets.isEmpty()) {
        at++;
        return null;
      } else if (brackets.has(char)) {
        stopped = brackets.take(at, char);
        at++;
      } else at++;
      if (stopped !== null) return stopped;
    }
    return brackets.unclosed() ?? (closesInterpolation ? unterminated(start, "interpolation") : null);
  }

  return code(false) ?? { kind: "lexed", spans };
}

function directiveOf({ text, span: { start, end } }: Spanned): string | null {
  if (!text.startsWith(LINE_COMMENT, start)) return null;
  return text.slice(start + LINE_COMMENT.length, end).replace(DOC_SLASH_AND_SPACE, "");
}

function analyzerDirective(shown: string, directive: RegExp): KeptForm<Spanned> {
  return {
    shown,
    keeps: (comment) => {
      const body = directiveOf(comment);
      return body !== null && directive.test(body);
    },
  };
}

const KEPT: readonly KeptForm<Spanned>[] = [
  analyzerDirective("`ignore:`", /^ignore:/),
  analyzerDirective("`ignore_for_file:`", /^ignore_for_file:/),
  analyzerDirective("`coverage:`", /^coverage:/),
  analyzerDirective("`@dart=`", /^@dart\s*=/),
];

export const comments: CommentsOf = refusedComments(commentSpans, KEPT);

export const kept = shownOf(KEPT);
