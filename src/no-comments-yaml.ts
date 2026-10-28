import { Composer, type CST, Parser } from "yaml";
import { unreachable } from "./assert";
import { adapter, type Lexed, type Span } from "./no-comments-adapter";
import type { Stopped } from "./no-comments-spans";

function* commentsOfItem(item: CST.CollectionItem): Iterable<Span> {
  yield* commentsOfEach(item.start);
  yield* commentsOf(item.key);
  yield* commentsOfEach(item.sep ?? []);
  yield* commentsOf(item.value);
}

function* commentsOfEach(tokens: readonly CST.Token[]): Iterable<Span> {
  for (const token of tokens) yield* commentsOf(token);
}

function* commentsOf(token: CST.Token | null | undefined): Iterable<Span> {
  if (token === null || token === undefined) return;
  switch (token.type) {
    case "comment":
      yield { start: token.offset, end: token.offset + token.source.length, style: "line" };
      return;
    case "byte-order-mark":
    case "doc-mode":
    case "doc-start":
    case "space":
    case "newline":
    case "directive-line":
    case "anchor":
    case "tag":
    case "seq-item-ind":
    case "explicit-key-ind":
    case "map-value-ind":
    case "flow-map-start":
    case "flow-map-end":
    case "flow-seq-start":
    case "flow-seq-end":
    case "flow-error-end":
    case "comma":
    case "block-scalar-header":
    case "error":
    case "directive":
      return;
    case "document":
      yield* commentsOfEach(token.start);
      yield* commentsOf(token.value);
      yield* commentsOfEach(token.end ?? []);
      return;
    case "doc-end":
      yield* commentsOfEach(token.end ?? []);
      return;
    case "alias":
    case "scalar":
    case "single-quoted-scalar":
    case "double-quoted-scalar":
      yield* commentsOfEach(token.end ?? []);
      return;
    case "block-scalar":
      yield* commentsOfEach(token.props);
      return;
    case "block-map":
    case "block-seq":
      for (const item of token.items) yield* commentsOfItem(item);
      return;
    case "flow-collection":
      yield* commentsOf(token.start);
      for (const item of token.items) yield* commentsOfItem(item);
      yield* commentsOfEach(token.end);
      return;
    default:
      unreachable(token);
  }
}

function firstError(tokens: readonly CST.Token[]): Stopped | null {
  const composer = new Composer();
  for (const document of composer.compose(tokens)) {
    const [error] = document.errors;
    if (error !== undefined) return { kind: "stopped", at: error.pos[0], reason: error.message };
  }
  const [error] = composer.streamInfo().errors;
  return error === undefined ? null : { kind: "stopped", at: error.pos[0], reason: error.message };
}

function commentSpans(text: string): Lexed {
  const tokens = [...new Parser().parse(text)];
  return firstError(tokens) ?? { kind: "lexed", spans: [...commentsOfEach(tokens)] };
}

export const { comments } = adapter(commentSpans);
