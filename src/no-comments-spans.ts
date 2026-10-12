import type { Comment } from "./no-comments-languages";
import { firstLine } from "./no-comments-route";

export type Span = { readonly start: number; readonly end: number };

const NEWLINE = 10;

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

export function commentsAt(text: string, spans: readonly Span[]): Comment[] {
  let line = 1;
  let counted = 0;
  return spans.map(({ start, end }) => {
    for (; counted < start; counted++) if (text.charCodeAt(counted) === NEWLINE) line++;
    return { line, body: firstLine(text.slice(start, end)).trim() };
  });
}
