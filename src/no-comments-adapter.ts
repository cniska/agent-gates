import { SHEBANG_PREFIX } from "./no-comments-route";
import { lineCounter, type Stopped } from "./no-comments-spans";

export type Comment = { readonly line: number; readonly text: string };

export type Reading =
  | { readonly kind: "read"; readonly comments: readonly Comment[] }
  | { readonly kind: "unparsed"; readonly line: number; readonly reason: string };

type CommentsOf = (path: string, text: string) => Reading;

export type Adapter = { readonly comments: CommentsOf };

export type Style = "line" | "block" | "attribute" | "docstring";

export type Span = { readonly start: number; readonly end: number; readonly style: Style };

export type Lexed = { readonly kind: "lexed"; readonly spans: readonly Span[] } | Stopped;

const SHEBANG_TRAILER = /(?:^#!|\s)#|\\c/;

function isInterpreterLine(span: Span, comment: string): boolean {
  return (
    span.style === "line" &&
    span.start === 0 &&
    comment.startsWith(SHEBANG_PREFIX) &&
    !SHEBANG_TRAILER.test(comment)
  );
}

export function adapter(lex: (text: string, path: string) => Lexed): Adapter {
  return {
    comments: (path, text) => {
      const lexed = lex(text, path);
      const lineAt = lineCounter(text);
      if (lexed.kind === "stopped") return { kind: "unparsed", line: lineAt(lexed.at), reason: lexed.reason };
      const judged: Comment[] = [];
      for (const span of lexed.spans) {
        const comment = text.slice(span.start, span.end);
        if (!isInterpreterLine(span, comment)) judged.push({ line: lineAt(span.start), text: comment });
      }
      return { kind: "read", comments: judged };
    },
  };
}
