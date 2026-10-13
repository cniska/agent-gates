import { type KeptForm, keptBy } from "./no-comments-kept";
import type { Comment, CommentsOf, Tracked } from "./no-comments-languages";

export type Span = { readonly start: number; readonly end: number };

export type Spanned<S extends Span = Span> = {
  readonly text: string;
  readonly span: S;
  readonly path: string;
  readonly tracked: Tracked;
};

export type Stopped = { readonly kind: "stopped"; readonly at: number; readonly reason: string };

export type Lexed<S extends Span = Span> = { readonly kind: "lexed"; readonly spans: readonly S[] } | Stopped;

const NEWLINE = 10;

export function lineEnd(text: string, from: number): number {
  const newline = text.indexOf("\n", from);
  return newline < 0 ? text.length : newline;
}

export function firstLine(text: string): string {
  return text.slice(0, lineEnd(text, 0));
}

export function unterminated(at: number, construct: string): Stopped {
  return { kind: "stopped", at, reason: `Unterminated ${construct}` };
}

export function unexpected(at: number, token: string): Stopped {
  return { kind: "stopped", at, reason: `Unexpected "${token}"` };
}

export function nestedBlockEnd(text: string, start: number, to: number): number | null {
  let depth = 0;
  let at = start;
  while (at < to) {
    if (text.startsWith("/*", at)) {
      depth++;
      at += 2;
    } else if (text.startsWith("*/", at)) {
      depth--;
      at += 2;
      if (depth === 0) return at;
    } else at++;
  }
  return null;
}

function lineCounter(text: string): (offset: number) => number {
  let line = 1;
  let counted = 0;
  return (offset) => {
    for (; counted < offset; counted++) if (text.charCodeAt(counted) === NEWLINE) line++;
    return line;
  };
}

export function refusedComments<S extends Span>(
  commentSpans: (text: string) => Lexed<S>,
  forms: readonly KeptForm<Spanned<S>>[],
): CommentsOf {
  const isKept = keptBy(forms);
  return (path, text, tracked) => {
    const lexed = commentSpans(text);
    const lineAt = lineCounter(text);
    if (lexed.kind === "stopped") return { kind: "unparsed", line: lineAt(lexed.at), reason: lexed.reason };
    const comments: Comment[] = lexed.spans
      .filter((span) => !isKept({ text, span, path, tracked }))
      .map(({ start, end }) => ({ line: lineAt(start), text: text.slice(start, end) }));
    return { kind: "read", comments };
  };
}
