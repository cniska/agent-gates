import type { CommentsOf } from "./no-comments-languages";
import { lineEnd } from "./no-comments-route";
import { commentsAt, nestedBlockEnd, type Span } from "./no-comments-spans";

const ANALYZER_DIRECTIVE = /^(?:ignore:|ignore_for_file:|coverage:|@dart\s*=)/;

const DOC_SLASH_AND_SPACE = /^\/?\s*/;

const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/;

const SCRIPT_TAG = "#!";

function refusedSpans(text: string): Span[] | null {
  const spans: Span[] = [];
  let at = text.startsWith(SCRIPT_TAG) ? lineEnd(text, 0) : 0;

  function lineComment(): void {
    const start = at;
    at = lineEnd(text, at);
    const body = text.slice(start + 2, at).replace(DOC_SLASH_AND_SPACE, "");
    if (!ANALYZER_DIRECTIVE.test(body)) spans.push({ start, end: at });
  }

  function blockComment(): boolean {
    const end = nestedBlockEnd(text, at, text.length);
    if (end === null) return false;
    spans.push({ start: at, end });
    at = end;
    return true;
  }

  function string(raw: boolean): boolean {
    const quote = text[at] ?? "";
    const close = text.startsWith(quote.repeat(3), at) ? quote.repeat(3) : quote;
    at += close.length;
    while (at < text.length) {
      if (text.startsWith(close, at)) {
        at += close.length;
        return true;
      }
      const char = text[at];
      if (close.length === 1 && char === "\n") return false;
      if (!raw && char === "\\") at += 2;
      else if (!raw && char === "$" && text[at + 1] === "{") {
        at += 2;
        if (!code(true)) return false;
      } else at++;
    }
    return false;
  }

  function code(closesInterpolation: boolean): boolean {
    let depth = 0;
    while (at < text.length) {
      const char = text[at];
      const next = text[at + 1];
      if (char === "/" && next === "/") lineComment();
      else if (char === "/" && next === "*") {
        if (!blockComment()) return false;
      } else if (char === "'" || char === '"') {
        if (!string(false)) return false;
      } else if (
        char === "r" &&
        (next === "'" || next === '"') &&
        !IDENTIFIER_CHAR.test(text[at - 1] ?? "")
      ) {
        at++;
        if (!string(true)) return false;
      } else if (char === "{") {
        depth++;
        at++;
      } else if (char === "}") {
        at++;
        if (closesInterpolation && depth === 0) return true;
        depth--;
      } else at++;
    }
    return !closesInterpolation;
  }

  return code(false) ? spans : null;
}

export const comments: CommentsOf = async (_path, text) => {
  const spans = refusedSpans(text);
  return spans === null ? null : commentsAt(text, spans);
};
