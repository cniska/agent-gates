import { invariant } from "./assert";
import type { Adapter, Reading } from "./no-comments-adapter";
import { isKept, type Keep } from "./no-comments-keep";
import { type Language, languageOf } from "./no-comments-languages";
import { outsideTheCode } from "./no-comments-skips";
import { firstLine } from "./no-comments-spans";
import {
  type Change,
  type FileText,
  filesOf,
  type Judged,
  type Origin,
  textualChanges,
} from "./scanner-change";

type Base = { readonly origin: Origin; readonly path: string };

type JudgedHead = { readonly file: FileText; readonly base: Base | null };

export type JudgedChange = { readonly heads: readonly JudgedHead[]; readonly bases: readonly FileText[] };

type Pool = ReadonlyMap<string, number>;

type Counts = Map<string, number>;

export type Refused = { readonly line: number; readonly body: string };

export type FileFindings =
  | {
      readonly kind: "comments";
      readonly path: string;
      readonly language: Language;
      readonly comments: readonly [Refused, ...Refused[]];
    }
  | { readonly kind: "unparsed"; readonly path: string; readonly line: number; readonly reason: string };

export type AdapterOf = (language: Language) => Adapter | null;

type Reader = { readonly adapterOf: AdapterOf; readonly keep: Keep };

type LanguageReading = { readonly language: Language; readonly reading: Reading };

const WHITESPACE_RUN = /\s+/g;

export function changesInTheCode(root: string, judged: Judged): Change[] {
  const textual = textualChanges(root, judged);
  const outside = outsideTheCode(
    root,
    textual.map(({ head }) => head.path),
  );
  return textual.filter(({ head }) => !outside.has(head.path));
}

export function judgedChange(root: string, judged: Judged): JudgedChange {
  const inTheCode = changesInTheCode(root, judged);
  const bases = new Map(inTheCode.flatMap(({ base }) => (base === null ? [] : [[base.path, base]])));
  const files = filesOf(root, [...inTheCode.map(({ head }) => head), ...bases.values()]);
  const heads = inTheCode.map(({ base }, index) => {
    const file = files[index];
    invariant(file !== undefined, "each change's head is read");
    return {
      file,
      base: base === null ? null : { origin: base.origin, path: base.path },
    };
  });
  return { heads, bases: files.slice(inTheCode.length) };
}

function readingOf({ path, text }: FileText, { adapterOf, keep }: Reader): LanguageReading | null {
  const language = languageOf(path, firstLine(text));
  const adapter = language === null ? null : adapterOf(language);
  if (language === null || adapter === null) return null;
  const reading = adapter.comments(path, text);
  if (reading.kind === "unparsed") return { language, reading };
  const comments = reading.comments.filter((comment) => !isKept(keep, language, comment.text));
  return { language, reading: { kind: "read", comments } };
}

function identityOf(comment: string): string {
  return comment
    .split("\n")
    .map((line) => line.trim().replace(WHITESPACE_RUN, " "))
    .join("\n");
}

function added(pool: Counts, identity: string, count: number): void {
  pool.set(identity, (pool.get(identity) ?? 0) + count);
}

function poolOf(base: FileText, reader: Reader): Pool {
  const pool: Counts = new Map();
  const reading = readingOf(base, reader)?.reading;
  if (reading?.kind === "read") for (const { text } of reading.comments) added(pool, identityOf(text), 1);
  return pool;
}

function leftoversOf(pools: Iterable<Pool>): Pool {
  const leftovers: Counts = new Map();
  for (const pool of pools) for (const [identity, count] of pool) added(leftovers, identity, count);
  return leftovers;
}

function takenFrom(pool: Counts, comment: string): boolean {
  const identity = identityOf(comment);
  const left = pool.get(identity) ?? 0;
  if (left === 0) return false;
  pool.set(identity, left - 1);
  return true;
}

type OwnRead = { readonly read: LanguageReading | null; readonly left: Pool | null };

function unmatchedIn(read: LanguageReading | null, own: Pool | null): OwnRead {
  if (read?.reading.kind !== "read" || own === null) return { read, left: own };
  const left: Counts = new Map(own);
  const comments = read.reading.comments.filter(({ text }) => !takenFrom(left, text));
  return { read: { language: read.language, reading: { kind: "read", comments } }, left };
}

function byPath(a: FileFindings, b: FileFindings): number {
  if (a.path === b.path) return 0;
  return a.path < b.path ? -1 : 1;
}

type Unmatched = { readonly file: FileText; readonly read: LanguageReading | null };

type OwnMatch = { readonly unmatched: readonly Unmatched[]; readonly leftovers: Pool };

function ownMatch({ heads, bases }: JudgedChange, reader: Reader): OwnMatch {
  const pools = new Map(bases.map((base) => [base.path, poolOf(base, reader)]));
  const matched = heads.map(({ file, base }) => {
    const ownPath = base?.origin === "own" ? base.path : null;
    const own = ownPath === null ? null : (pools.get(ownPath) ?? null);
    return { file, ownPath, ...unmatchedIn(readingOf(file, reader), own) };
  });
  const remainders = new Map<string, Pool>();
  for (const { ownPath, left } of matched) {
    if (ownPath === null || left === null) continue;
    invariant(
      !remainders.has(ownPath),
      "git diff -M -C gives each base path at most one renamed or modified head",
    );
    remainders.set(ownPath, left);
  }
  return {
    unmatched: matched.map(({ file, read }) => ({ file, read })),
    leftovers: leftoversOf([...pools].map(([path, pool]) => remainders.get(path) ?? pool)),
  };
}

function crossFileFindings({ unmatched, leftovers }: OwnMatch): FileFindings[] {
  const left: Counts = new Map(leftovers);
  const found: FileFindings[] = [];
  for (const { file, read } of unmatched) {
    if (read === null) continue;
    const { language, reading } = read;
    if (reading.kind === "unparsed") {
      found.push({ kind: "unparsed", path: file.path, line: reading.line, reason: reading.reason });
      continue;
    }
    const [first, ...rest] = reading.comments
      .filter(({ text }) => !takenFrom(left, text))
      .map(({ line, text }) => ({ line, body: firstLine(text).trim() }))
      .sort((a, b) => a.line - b.line);
    if (first !== undefined)
      found.push({ kind: "comments", path: file.path, language, comments: [first, ...rest] });
  }
  return found;
}

export function findings(change: JudgedChange, adapterOf: AdapterOf, keep: Keep): FileFindings[] {
  return crossFileFindings(ownMatch(change, { adapterOf, keep })).sort(byPath);
}
