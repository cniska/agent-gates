import { adapter, type Lexed, SHEBANG, type Span } from "./no-comments-adapter";
import { bracketsOf } from "./no-comments-brackets";
import { SHEBANG_PREFIX } from "./no-comments-route";
import { lineEnd, nestedBlockEnd, type Stopped, unterminated } from "./no-comments-spans";

const OPENER = 2;

const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/;

function commentSpans(text: string): Lexed<Span, null> {
  const spans: Span[] = [];
  let at = text.startsWith(SHEBANG_PREFIX) ? lineEnd(text, 0) : 0;
  if (at > 0) spans.push({ start: 0, end: at, bodyStart: SHEBANG_PREFIX.length, bodyEnd: at, style: "line" });

  function lineComment(): void {
    const start = at;
    at = lineEnd(text, at);
    spans.push({ start, end: at, bodyStart: start + OPENER, bodyEnd: at, style: "line" });
  }

  function blockComment(): Stopped | null {
    const end = nestedBlockEnd(text, at, text.length);
    if (end === null) return unterminated(at, "comment");
    spans.push({ start: at, end, bodyStart: at + OPENER, bodyEnd: end - OPENER, style: "block" });
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

  const stopped = code(false);
  if (stopped !== null) return stopped;
  return { kind: "lexed", spans, facts: null };
}

export const { comments, kept } = adapter({
  lex: commentSpans,
  kept: [SHEBANG],
});
