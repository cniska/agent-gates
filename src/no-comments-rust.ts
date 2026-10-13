import { dirname, join, relative } from "node:path/posix";
import { type KeptForm, shownOf } from "./no-comments-kept";
import type { CommentsOf, Tracked } from "./no-comments-languages";
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

const IDENTIFIER_START = /^[\p{XID_Start}_]$/u;

const IDENTIFIER_CONTINUE = /^\p{XID_Continue}$/u;

const NON_ASCII_EMOJI = /^(?![\0-\x7f])\p{Emoji}$/u;

const DIGIT = /^[0-9]$/;

const STRING_PREFIXES = ["br", "cr", "b", "c", "r"] as const;

const WHITESPACE = "[\\t\\n\\v\\f\\r \\u0085\\u200e\\u200f\\u2028\\u2029]";

const WHITESPACE_CHAR = new RegExp(`^${WHITESPACE}$`);

const DOC_TEXT_WORD = "doc";

const SHEBANG_TRIVIA = new RegExp(`${WHITESPACE}+|//(?![!/])[^\\n]*|////[^\\n]*`, "y");

const PLAIN_BLOCK_COMMENT = /\/\*(?!!)(?!\*(?![*/]))/y;

const INNER_DOC = /\/\/!|\/\*!/y;

const OUTER_DOC = /\/\/\/(?!\/)|\/\*\*(?![*/])/y;

const PUBLIC = "pub";

const MACRO_EXPORT = "macro_export";

const ITEMS_WITH_PUBLIC_BODIES = new Set(["enum", "trait"]);

const BLOCK_AFTER = new Set(["<", ",", "=", ";"]);

const NO_HEADER = { item: "none", opensPublicBody: false } as const;

const MANIFEST = "Cargo.toml";

const LIBRARY_ROOT = "src/lib.rs";

const SOURCE_DIR = "src/";

const BINARY_ROOT = "src/main.rs";

const BINARIES_DIR = "src/bin/";

type Doc = "none" | "inner" | "public" | "other";

type DocForm = "none" | "inner" | "outer";

type DocSpan = Span & { readonly doc: Doc };

type FormSpan = Span & { readonly form: DocForm };

type Item = "none" | "public" | "other";

type Header = { readonly item: Item; readonly opensPublicBody: boolean };

type Brace =
  | { readonly kind: "public-body" }
  | { readonly kind: "body" }
  | { readonly kind: "block"; readonly interrupts: Header };

type Placement = "crate-root" | "library" | "elsewhere";

function shebangEnd(text: string): number {
  if (!text.startsWith(SHEBANG_PREFIX)) return 0;
  let at = SHEBANG_PREFIX.length;
  while (at < text.length) {
    SHEBANG_TRIVIA.lastIndex = at;
    if (SHEBANG_TRIVIA.test(text)) {
      at = SHEBANG_TRIVIA.lastIndex;
      continue;
    }
    PLAIN_BLOCK_COMMENT.lastIndex = at;
    const end = PLAIN_BLOCK_COMMENT.test(text) ? nestedBlockEnd(text, at, text.length) : null;
    if (end === null) break;
    at = end;
  }
  return text[at] === "[" ? 0 : lineEnd(text, 0);
}

function formAt(text: string, start: number): DocForm {
  INNER_DOC.lastIndex = start;
  if (INNER_DOC.test(text)) return "inner";
  OUTER_DOC.lastIndex = start;
  return OUTER_DOC.test(text) ? "outer" : "none";
}

function commentSpans(text: string): Lexed<DocSpan> {
  const spans: FormSpan[] = [];
  const awaitingItem: number[] = [];
  const documentsPublicItem = new Set<number>();
  const braces: Brace[] = [];
  let previous = "";
  let carriesDocText = false;
  let exported = false;
  let insideAttribute = 0;
  let header: Header = NO_HEADER;
  let at = shebangEnd(text);

  const charAt = (index: number): string => {
    const code = text.codePointAt(index);
    return code === undefined ? "" : String.fromCodePoint(code);
  };
  const isIdentifierStart = (index: number) => IDENTIFIER_START.test(charAt(index));
  const isIdentifierContinue = (index: number) => IDENTIFIER_CONTINUE.test(charAt(index));
  const isEmoji = (index: number) => NON_ASCII_EMOJI.test(charAt(index));

  function bump(): void {
    at += charAt(at).length;
  }

  function word(): void {
    while (isIdentifierContinue(at) || isEmoji(at)) bump();
  }

  function suffixed(stopped: Stopped | null): Stopped | null {
    if (stopped === null && isIdentifierStart(at)) word();
    return stopped;
  }

  function found(start: number, end: number, form: DocForm): void {
    spans.push({ start, end, form });
    if (form === "outer" && insideAttribute === 0) awaitingItem.push(start);
  }

  function lineComment(): void {
    const start = at;
    at = lineEnd(text, at);
    found(start, at, formAt(text, start));
  }

  function blockComment(): Stopped | null {
    const end = nestedBlockEnd(text, at, text.length);
    if (end === null) return unterminated(at, "comment");
    found(at, end, formAt(text, at));
    at = end;
    return null;
  }

  function isWordAt(index: number, expected: string): boolean {
    return text.startsWith(expected, index) && !isIdentifierContinue(index + expected.length);
  }

  function startsBarePublic(index: number): boolean {
    return isWordAt(index, PUBLIC) && text[afterTrivia(index + PUBLIC.length)] !== "(";
  }

  function sawWord(start: number): void {
    if (insideAttribute > 0) return;
    if (header.item === "none")
      header = { item: startsBarePublic(start) ? "public" : "other", opensPublicBody: false };
    if (header.item === "public" && ITEMS_WITH_PUBLIC_BODIES.has(text.slice(start, at)))
      header = { item: "public", opensPublicBody: true };
  }

  function itemEnded(): void {
    header = NO_HEADER;
  }

  function braceOpened(): Brace {
    const brace: Brace = BLOCK_AFTER.has(previous)
      ? { kind: "block", interrupts: header }
      : { kind: header.opensPublicBody ? "public-body" : "body" };
    itemEnded();
    return brace;
  }

  function itemStarts(): void {
    if (exported || braces.at(-1)?.kind === "public-body" || startsBarePublic(at))
      for (const start of awaitingItem) documentsPublicItem.add(start);
    awaitingItem.length = 0;
    exported = false;
  }

  function isTrivia(): boolean {
    return WHITESPACE_CHAR.test(text[at] ?? "") || text.startsWith("//", at) || text.startsWith("/*", at);
  }

  function quoted(): Stopped | null {
    const start = at;
    at++;
    while (at < text.length) {
      const char = text[at];
      at++;
      if (char === '"') return null;
      if (char === "\\" && (text[at] === "\\" || text[at] === '"')) at++;
    }
    return unterminated(start, "string");
  }

  function rawQuoted(): Stopped | null {
    const hashesFrom = at;
    while (text[at] === "#") at++;
    const close = `"${text.slice(hashesFrom, at)}`;
    if (text[at] !== '"') return unterminated(hashesFrom, "raw string");
    const end = text.indexOf(close, at + 1);
    if (end < 0) return unterminated(hashesFrom, "raw string");
    at = end + close.length;
    return null;
  }

  function singleQuoted(): Stopped | null {
    const start = at;
    at++;
    const first = charAt(at);
    if (first !== "\\" && charAt(at + first.length) === "'") {
      at += first.length + 1;
      return null;
    }
    while (at < text.length) {
      const char = text[at];
      if (char === "'") {
        at++;
        return null;
      }
      if (char === "/" || (char === "\n" && text[at + 1] !== "'")) return unterminated(start, "character");
      if (char === "\\") bump();
      bump();
    }
    return unterminated(start, "character");
  }

  function lifetimeOrChar(): Stopped | null {
    const first = charAt(at + 1);
    const second = charAt(at + 1 + first.length);
    const canBeLifetime = second !== "'" && (IDENTIFIER_START.test(first) || DIGIT.test(first));
    if (!canBeLifetime) return suffixed(singleQuoted());
    at++;
    if (first === "r" && second === "#" && isIdentifierStart(at + 2)) at += 2;
    bump();
    word();
    if (text[at] === "'") at++;
    return null;
  }

  function literal(prefix: string): Stopped | null {
    at += prefix.length;
    if (prefix.endsWith("r")) return suffixed(rawQuoted());
    return suffixed(text[at] === "'" ? singleQuoted() : quoted());
  }

  function identifier(): Stopped | null {
    if (text[at] === "r" && text[at + 1] === "#" && isIdentifierStart(at + 2)) {
      const start = at;
      at += 2;
      word();
      sawWord(start);
      return null;
    }
    const prefix = STRING_PREFIXES.find((candidate) => opensLiteral(candidate));
    if (prefix !== undefined) return literal(prefix);
    const start = at;
    word();
    sawWord(start);
    if (text.slice(start, at) === DOC_TEXT_WORD && isSingleEquals(afterTrivia(at))) carriesDocText = true;
    return null;
  }

  function isSingleEquals(index: number): boolean {
    return text[index] === "=" && text[index + 1] !== "=" && text[index + 1] !== ">";
  }

  function afterTrivia(from: number): number {
    let index = from;
    while (index < text.length) {
      if (WHITESPACE_CHAR.test(text[index] ?? "")) index++;
      else if (text.startsWith("//", index)) index = lineEnd(text, index);
      else if (!text.startsWith("/*", index)) return index;
      else {
        const end = nestedBlockEnd(text, index, text.length);
        if (end === null) return index;
        index = end;
      }
    }
    return index;
  }

  function opensLiteral(prefix: string): boolean {
    if (!text.startsWith(prefix, at)) return false;
    const next = text[at + prefix.length];
    if (prefix.endsWith("r")) return next === '"' || next === "#";
    return next === '"' || (prefix === "b" && next === "'");
  }

  function opensAttribute(): boolean {
    let index = afterTrivia(at + 1);
    if (text[index] === "!") index = afterTrivia(index + 1);
    return text[index] === "[";
  }

  function attribute(): Stopped | null {
    const start = at;
    const firstInside = spans.length;
    const outerCarriesDocText = carriesDocText;
    const form = text[afterTrivia(at + 1)] === "!" ? "inner" : "outer";
    carriesDocText = false;
    at++;
    insideAttribute++;
    while (text[at] !== "[") {
      const stopped = token();
      if (stopped !== null) return stopped;
    }
    at++;
    if (insideAttribute === 1 && isWordAt(afterTrivia(at), MACRO_EXPORT)) exported = true;
    const stopped = code(true);
    insideAttribute--;
    if (stopped !== null) return stopped;
    if (carriesDocText) {
      spans.splice(firstInside, Infinity);
      found(start, at, form);
    }
    carriesDocText ||= outerCarriesDocText;
    return null;
  }

  function token(): Stopped | null {
    const char = text[at];
    if (text.startsWith("//", at)) lineComment();
    else if (text.startsWith("/*", at)) return blockComment();
    else if (char === '"') return suffixed(quoted());
    else if (char === "'") return lifetimeOrChar();
    else if (isIdentifierStart(at) || isEmoji(at) || DIGIT.test(char ?? "")) return identifier();
    else bump();
    return null;
  }

  function code(closesBracket: boolean): Stopped | null {
    let depth = 0;
    while (at < text.length) {
      const char = text[at];
      let stopped: Stopped | null = null;
      if (char === "#" && opensAttribute()) {
        stopped = attribute();
        if (stopped !== null) return stopped;
        continue;
      }
      const atItemLevel = insideAttribute === 0;
      const significant = atItemLevel && !isTrivia();
      if (significant) itemStarts();
      if (char === "[") {
        depth++;
        at++;
      } else if (char === "]") {
        at++;
        if (closesBracket && depth === 0) return null;
        depth--;
      } else if (atItemLevel && char === "{") {
        braces.push(braceOpened());
        at++;
      } else if (atItemLevel && char === "}") {
        const closed = braces.pop();
        header = closed?.kind === "block" ? closed.interrupts : NO_HEADER;
        at++;
      } else if (atItemLevel && char === ";" && depth === 0) {
        itemEnded();
        at++;
      } else stopped = token();
      if (stopped !== null) return stopped;
      if (significant) previous = char ?? "";
    }
    return null;
  }

  const stopped = code(false);
  if (stopped !== null) return stopped;
  const docOf = (form: DocForm, start: number): Doc => {
    if (form !== "outer") return form;
    return documentsPublicItem.has(start) ? "public" : "other";
  };
  return {
    kind: "lexed",
    spans: spans.map(({ start, end, form }) => ({ start, end, doc: docOf(form, start) })),
  };
}

function placementOf(path: string, tracked: Tracked): Placement {
  let crate = dirname(path);
  while (!tracked(join(crate, MANIFEST))) {
    if (crate === ".") return "elsewhere";
    crate = dirname(crate);
  }
  if (!tracked(join(crate, LIBRARY_ROOT))) return "elsewhere";
  const inCrate = relative(crate, path);
  if (inCrate === LIBRARY_ROOT) return "crate-root";
  if (!inCrate.startsWith(SOURCE_DIR) || inCrate === BINARY_ROOT || inCrate.startsWith(BINARIES_DIR))
    return "elsewhere";
  return "library";
}

const KEPT: readonly KeptForm<Spanned<DocSpan>>[] = [
  {
    shown:
      "in library code, an outer doc comment (`///`, `/** */`, `#[doc]`) on a `pub` item, a `#[macro_export]` macro, or a variant or item of a `pub` enum or trait",
    keeps: ({ span, path, tracked }) => span.doc === "public" && placementOf(path, tracked) !== "elsewhere",
  },
  {
    shown: "an inner doc comment (`//!`, `/*! */`, `#![doc]`) in a library's `src/lib.rs`",
    keeps: ({ span, path, tracked }) => span.doc === "inner" && placementOf(path, tracked) === "crate-root",
  },
];

export const comments: CommentsOf = refusedComments(commentSpans, KEPT);

export const kept = shownOf(KEPT);
