import { invariant } from "./assert";

export type Stopped = { readonly kind: "stopped"; readonly at: number; readonly reason: string };

const NEWLINE = 10;

const BYTE_ORDER_MARK = "\uFEFF";

export function textStart(text: string): number {
  return text.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK.length : 0;
}

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

export function lineCounter(text: string): (offset: number) => number {
  let line = 1;
  let counted = 0;
  return (offset) => {
    invariant(offset >= counted, "lines are counted in source order");
    for (; counted < offset; counted++) if (text.charCodeAt(counted) === NEWLINE) line++;
    return line;
  };
}
