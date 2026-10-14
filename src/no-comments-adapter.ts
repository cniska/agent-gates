import { isMarkerBody } from "./gate-marker";
import { SHEBANG_PREFIX } from "./no-comments-route";
import { lineCounter, lineEnd, type Stopped, textStart } from "./no-comments-spans";

export type Comment = { readonly line: number; readonly text: string };

export type Reading =
  | { readonly kind: "read"; readonly comments: readonly Comment[] }
  | { readonly kind: "unparsed"; readonly line: number; readonly reason: string };

export type CommentsOf = (path: string, text: string) => Reading;

export type Adapter = { readonly comments: CommentsOf; readonly kept: readonly string[] };

export type Style = "line" | "block" | "attribute" | "docstring";

export type Span = {
  readonly start: number;
  readonly end: number;
  readonly bodyStart: number;
  readonly bodyEnd: number;
  readonly style: Style;
};

export type LeadingSpan = Span & { readonly leading: boolean };

export type Lexed<S extends Span, F> =
  | { readonly kind: "lexed"; readonly spans: readonly S[]; readonly facts: F }
  | Stopped;

export type CommentRead<S extends Span = Span, F = unknown> = {
  readonly span: S;
  readonly text: string;
  readonly opener: string;
  readonly body: string;
  readonly column: number;
  readonly ownLine: boolean;
  readonly multiline: boolean;
  readonly file: { readonly facts: F };
};

export type KeptForm<R> = { readonly shown: string; readonly keeps: (read: R) => boolean };

type AdapterSpec<S extends Span, F> = {
  readonly lex: (text: string, path: string) => Lexed<S, F>;
  readonly kept: readonly KeptForm<CommentRead<S, F>>[];
};

type Directive<R> = { readonly pattern: RegExp; readonly where?: (read: R) => boolean };

const BLANK = /^[ \t]*$/;

const MARKER_OPENERS = ["#", "//", "--"];

const SHEBANG_TRAILER = /(?:^#!|\s)#|\\c/;

export function directive<R extends CommentRead>(
  shown: string,
  { pattern, where }: Directive<R>,
): KeptForm<R> {
  const anchored = new RegExp(`^(?:${pattern.source})$`, pattern.flags);
  return {
    shown,
    keeps: (read) => !read.multiline && (where?.(read) ?? true) && anchored.test(read.body.trimEnd()),
  };
}

const SHARED_FORMS: readonly KeptForm<CommentRead>[] = [
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

export const SHEBANG: KeptForm<CommentRead> = {
  shown: "the first-line shebang, with no `#` word or `\\c` after `#!`",
  keeps: ({ span, text }) =>
    span.start === 0 && text.startsWith(SHEBANG_PREFIX) && !SHEBANG_TRAILER.test(text),
};

export const SHARED_SHOWN: readonly string[] = SHARED_FORMS.map(({ shown }) => shown);

function lineStart(text: string, offset: number): number {
  return Math.max(text.lastIndexOf("\n", offset - 1) + 1, textStart(text));
}

function readOf<S extends Span, F>(text: string, span: S, file: { readonly facts: F }): CommentRead<S, F> {
  const from = lineStart(text, span.start);
  const body = text.slice(span.bodyStart, span.bodyEnd);
  const raw = text.slice(span.start, span.end);
  return {
    span,
    text: raw,
    opener: text.slice(span.start, span.bodyStart),
    body,
    column: span.start - from,
    ownLine:
      BLANK.test(text.slice(from, span.start)) && BLANK.test(text.slice(span.end, lineEnd(text, span.end))),
    multiline: raw.includes("\n"),
    file,
  };
}

export function adapter<S extends Span, F>(spec: AdapterSpec<S, F>): Adapter {
  const forms: readonly KeptForm<CommentRead<S, F>>[] = [...spec.kept, ...SHARED_FORMS];
  const comments: CommentsOf = (path, text) => {
    const lexed = spec.lex(text, path);
    const lineAt = lineCounter(text);
    if (lexed.kind === "stopped") return { kind: "unparsed", line: lineAt(lexed.at), reason: lexed.reason };
    const file = { facts: lexed.facts };
    const refused: Comment[] = [];
    for (const span of lexed.spans) {
      const read = readOf(text, span, file);
      if (!forms.some(({ keeps }) => keeps(read)))
        refused.push({ line: lineAt(span.start), text: read.text });
    }
    return { kind: "read", comments: refused };
  };
  return { comments, kept: forms.map(({ shown }) => shown) };
}
