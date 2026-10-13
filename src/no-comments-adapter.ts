import { isMarkerBody } from "./gate-marker";
import { lineCounter, lineEnd, type Stopped } from "./no-comments-spans";

export type Comment = { readonly line: number; readonly text: string };

export type Reading =
  | { readonly kind: "read"; readonly comments: readonly Comment[] }
  | { readonly kind: "unparsed"; readonly line: number; readonly reason: string };

export type Tracked = (path: string) => boolean;

export type CommentsOf = (path: string, text: string, tracked: Tracked) => Reading;

export type Adapter = { readonly comments: CommentsOf; readonly kept: readonly string[] };

export type Style = "line" | "block" | "attribute" | "docstring";

export type Span = {
  readonly start: number;
  readonly end: number;
  readonly bodyStart: number;
  readonly bodyEnd: number;
  readonly style: Style;
};

export type Lexed<S extends Span, F> =
  | { readonly kind: "lexed"; readonly spans: readonly S[]; readonly facts: F }
  | Stopped;

export type CommentRead<S extends Span = Span, C = unknown, F = unknown> = {
  readonly span: S;
  readonly text: string;
  readonly opener: string;
  readonly body: string;
  readonly directive: string;
  readonly column: number;
  readonly ownLine: boolean;
  readonly multiline: boolean;
  readonly file: { readonly context: C; readonly facts: F };
};

export type KeptForm<R> = { readonly shown: string; readonly keeps: (read: R) => boolean };

type AdapterSpec<S extends Span, C, F> = {
  readonly contextOf: (path: string, text: string, tracked: Tracked) => C;
  readonly lex: (text: string, context: C) => Lexed<S, F>;
  readonly directiveLead: RegExp;
  readonly kept: readonly KeptForm<CommentRead<S, C, F>>[];
};

type Directive<R> = {
  readonly pattern: RegExp;
  readonly reason: "allowed" | "alone";
  readonly where?: (read: R) => boolean;
};

const BLANK = /^[ \t]*$/;

const WORD_BOUNDARY = "(?:(?<![\\w-])|(?![\\w-]))";

const LICENSE_ID = "[\\w.+\\-:()]+";

const SPDX_LINE = new RegExp(
  `^(?://+!?|#+|--+|/\\*+!?)[ \\t]*SPDX-License-Identifier:[ \\t]*${LICENSE_ID}(?:[ \\t]+(?:AND|OR|WITH)[ \\t]+${LICENSE_ID})*[ \\t]*(?:\\*+/)?$`,
);

const MARKER_OPENERS = ["#", "//", "--"];

export function directive<R extends CommentRead>(
  shown: string,
  { pattern, reason, where }: Directive<R>,
): KeptForm<R> {
  const anchored = new RegExp(
    reason === "alone" ? `^(?:${pattern.source})$` : `^(?:${pattern.source})${WORD_BOUNDARY}`,
    pattern.flags,
  );
  return {
    shown,
    keeps: (read) => !read.multiline && (where?.(read) ?? true) && anchored.test(read.directive),
  };
}

const SHARED_FORMS: readonly KeptForm<CommentRead>[] = [
  {
    shown: "one `SPDX-License-Identifier:` line",
    keeps: ({ text, multiline }) => !multiline && SPDX_LINE.test(text.trim()),
  },
  {
    shown: "a gate marker on a line of its own",
    keeps: ({ span, opener, body, column, ownLine }) =>
      span.style === "line" &&
      column === 0 &&
      ownLine &&
      MARKER_OPENERS.includes(opener) &&
      isMarkerBody(body),
  },
];

export const SHARED_SHOWN: readonly string[] = SHARED_FORMS.map(({ shown }) => shown);

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

function readOf<S extends Span, C, F>(
  text: string,
  span: S,
  directiveLead: RegExp,
  file: { readonly context: C; readonly facts: F },
): CommentRead<S, C, F> {
  const from = lineStart(text, span.start);
  const body = text.slice(span.bodyStart, span.bodyEnd);
  const raw = text.slice(span.start, span.end);
  return {
    span,
    text: raw,
    opener: text.slice(span.start, span.bodyStart),
    body,
    directive: body.replace(directiveLead, "").trimEnd(),
    column: span.start - from,
    ownLine:
      BLANK.test(text.slice(from, span.start)) && BLANK.test(text.slice(span.end, lineEnd(text, span.end))),
    multiline: raw.includes("\n"),
    file,
  };
}

export function adapter<S extends Span, C, F>(spec: AdapterSpec<S, C, F>): Adapter {
  const forms: readonly KeptForm<CommentRead<S, C, F>>[] = [...spec.kept, ...SHARED_FORMS];
  const comments: CommentsOf = (path, text, tracked) => {
    const context = spec.contextOf(path, text, tracked);
    const lexed = spec.lex(text, context);
    const lineAt = lineCounter(text);
    if (lexed.kind === "stopped") return { kind: "unparsed", line: lineAt(lexed.at), reason: lexed.reason };
    const file = { context, facts: lexed.facts };
    const refused: Comment[] = [];
    for (const span of lexed.spans) {
      const read = readOf(text, span, spec.directiveLead, file);
      if (!forms.some(({ keeps }) => keeps(read)))
        refused.push({ line: lineAt(span.start), text: read.text });
    }
    return { kind: "read", comments: refused };
  };
  return { comments, kept: forms.map(({ shown }) => shown) };
}
