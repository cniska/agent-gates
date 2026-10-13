import { invariant, unreachable } from "./assert";
import { blobsOf, gitOutput, mergeBase, nulFields } from "./git";
import type { Adapter, Reading, Tracked } from "./no-comments-adapter";
import { type Language, languageOf } from "./no-comments-languages";
import { outsideTheCode } from "./no-comments-skips";
import { firstLine } from "./no-comments-spans";

export type Judged =
  | { readonly kind: "staged" }
  | { readonly kind: "pushed"; readonly base: string; readonly head: string }
  | { readonly kind: "all" };

type Side = { readonly path: string; readonly blob: string };

type Origin = "own" | "copy";

type Base = { readonly origin: Origin; readonly path: string };

type Change = { readonly head: Side; readonly base: (Base & { readonly blob: string }) | null };

type Sides = {
  readonly diff: readonly string[];
  readonly base: readonly string[];
  readonly head: readonly string[];
};

type FileText = { readonly path: string; readonly text: string };

type JudgedFile = FileText & { readonly tracked: Tracked };

type JudgedHead = { readonly file: JudgedFile; readonly base: Base | null };

type JudgedChange = { readonly heads: readonly JudgedHead[]; readonly bases: readonly JudgedFile[] };

type Pool = Map<string, number>;

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

type LanguageReading = { readonly language: Language; readonly reading: Reading };

const HEAD = "HEAD";

const INDEX_PATHS = ["ls-files", "--cached", "-z"];

const REGULAR_FILE_MODES = new Set(["100644", "100755"]);

const CHANGES = ["-M", "-C", "--diff-filter=AMTRC", "-z"];

const RENAMED = "R";

const COPIED = "C";

const NUMSTAT_RECORD = /^([^\t]*\t[^\t]*\t)(.*)$/s;

const BINARY = "-\t-\t";

const WHITESPACE_RUN = /\s+/g;

function emptyTree(root: string): string {
  return gitOutput(root, ["hash-object", "-t", "tree", "--stdin"], "").toString().trim();
}

function pathsIn(tree: string): readonly string[] {
  return ["ls-tree", "-r", "--name-only", "-z", tree];
}

function sidesOf(root: string, judged: Judged): Sides {
  switch (judged.kind) {
    case "staged":
      return { diff: ["diff", "--cached"], base: pathsIn(HEAD), head: INDEX_PATHS };
    case "pushed": {
      const base = mergeBase(root, judged.base, judged.head) ?? emptyTree(root);
      return { diff: ["diff", base, judged.head], base: pathsIn(base), head: pathsIn(judged.head) };
    }
    case "all": {
      const base = emptyTree(root);
      return { diff: ["diff", "--cached", base], base: pathsIn(base), head: INDEX_PATHS };
    }
    default:
      return unreachable(judged);
  }
}

function trackedIn(root: string, listing: readonly string[]): Tracked {
  let paths: ReadonlySet<string> | null = null;
  return (path) => {
    paths ??= new Set(nulFields(gitOutput(root, listing)));
    return paths.has(path);
  };
}

function changesIn(fields: readonly string[]): Change[] {
  const changes: Change[] = [];
  let at = 0;
  while (at < fields.length) {
    const [baseMode, mode, baseBlob, blob, status] = (fields[at] ?? "").slice(1).split(" ");
    const kind = status?.charAt(0);
    const pathCount = kind === RENAMED || kind === COPIED ? 2 : 1;
    const basePath = fields[at + 1];
    const path = fields[at + pathCount];
    at += 1 + pathCount;
    invariant(
      baseMode !== undefined &&
        mode !== undefined &&
        baseBlob !== undefined &&
        blob !== undefined &&
        basePath !== undefined &&
        path !== undefined,
      "git diff --raw prints two modes, two blobs, a status and its paths",
    );
    if (!REGULAR_FILE_MODES.has(mode)) continue;
    const origin: Origin = kind === COPIED ? "copy" : "own";
    const base = REGULAR_FILE_MODES.has(baseMode) ? { origin, path: basePath, blob: baseBlob } : null;
    changes.push({ head: { path, blob }, base });
  }
  return changes;
}

function binaryPaths(fields: readonly string[]): Set<string> {
  const binary = new Set<string>();
  let at = 0;
  while (at < fields.length) {
    const [, counts, inlinePath] = NUMSTAT_RECORD.exec(fields[at] ?? "") ?? [];
    const path = inlinePath === "" ? fields[at + 2] : inlinePath;
    at += inlinePath === "" ? 3 : 1;
    invariant(path !== undefined, "git diff --numstat prints the path of each change");
    if (counts === BINARY) binary.add(path);
  }
  return binary;
}

export function filesOf(root: string, sides: readonly Side[]): FileText[] {
  const texts = blobsOf(
    root,
    sides.map(({ blob }) => blob),
  );
  return sides.map(({ path }, index) => {
    const text = texts[index];
    invariant(text !== undefined, "git cat-file --batch returns each blob asked for");
    return { path, text: text.toString() };
  });
}

export function changesInTheCode(root: string, judged: Judged): Change[] {
  return codeChangesIn(root, sidesOf(root, judged).diff);
}

function codeChangesIn(root: string, diff: readonly string[]): Change[] {
  const binary = binaryPaths(nulFields(gitOutput(root, [...diff, ...CHANGES, "--numstat"])));
  const textual = changesIn(nulFields(gitOutput(root, [...diff, ...CHANGES, "--raw", "--no-abbrev"]))).filter(
    ({ head }) => !binary.has(head.path),
  );
  const outside = outsideTheCode(
    root,
    textual.map(({ head }) => head.path),
  );
  return textual.filter(({ head }) => !outside.has(head.path));
}

export function judgedChange(root: string, judged: Judged): JudgedChange {
  const sides = sidesOf(root, judged);
  const inTheCode = codeChangesIn(root, sides.diff);
  const bases = new Map(inTheCode.flatMap(({ base }) => (base === null ? [] : [[base.path, base]])));
  const files = filesOf(root, [...inTheCode.map(({ head }) => head), ...bases.values()]);
  const trackedAtHead = trackedIn(root, sides.head);
  const trackedAtBase = trackedIn(root, sides.base);
  const heads = inTheCode.map(({ base }, index) => {
    const file = files[index];
    invariant(file !== undefined, "each change's head is read");
    return {
      file: { ...file, tracked: trackedAtHead },
      base: base === null ? null : { origin: base.origin, path: base.path },
    };
  });
  return { heads, bases: files.slice(inTheCode.length).map((file) => ({ ...file, tracked: trackedAtBase })) };
}

function readingOf({ path, text, tracked }: JudgedFile, adapterOf: AdapterOf): LanguageReading | null {
  const language = languageOf(path, firstLine(text));
  const adapter = language === null ? null : adapterOf(language);
  if (language === null || adapter === null) return null;
  return { language, reading: adapter.comments(path, text, tracked) };
}

export function keptIn(adapterOf: AdapterOf, language: Language): readonly string[] {
  const adapter = adapterOf(language);
  invariant(adapter !== null, `the ${language} adapter that refused a comment is loaded`);
  return adapter.kept;
}

function identityOf(comment: string): string {
  return comment
    .split("\n")
    .map((line) => line.trim().replace(WHITESPACE_RUN, " "))
    .join("\n");
}

function added(pool: Pool, identity: string, count: number): void {
  pool.set(identity, (pool.get(identity) ?? 0) + count);
}

function poolOf(base: JudgedFile, adapterOf: AdapterOf): Pool {
  const pool: Pool = new Map();
  const reading = readingOf(base, adapterOf)?.reading;
  if (reading?.kind === "read") for (const { text } of reading.comments) added(pool, identityOf(text), 1);
  return pool;
}

function leftoversOf(pools: Iterable<Pool>): Pool {
  const leftovers: Pool = new Map();
  for (const pool of pools) for (const [identity, count] of pool) added(leftovers, identity, count);
  return leftovers;
}

function takenFrom(pool: Pool, comment: string): boolean {
  const identity = identityOf(comment);
  const left = pool.get(identity) ?? 0;
  if (left === 0) return false;
  pool.set(identity, left - 1);
  return true;
}

function unmatchedIn(read: LanguageReading | null, own: Pool | null): LanguageReading | null {
  if (read?.reading.kind !== "read" || own === null) return read;
  const comments = read.reading.comments.filter(({ text }) => !takenFrom(own, text));
  return { language: read.language, reading: { kind: "read", comments } };
}

function byPath(a: FileFindings, b: FileFindings): number {
  if (a.path === b.path) return 0;
  return a.path < b.path ? -1 : 1;
}

export function findings({ heads, bases }: JudgedChange, adapterOf: AdapterOf): FileFindings[] {
  const pools = new Map(bases.map((base) => [base.path, poolOf(base, adapterOf)]));
  const unmatched = heads.map(({ file, base }) => {
    const own = base?.origin === "own" ? (pools.get(base.path) ?? null) : null;
    return { file, read: unmatchedIn(readingOf(file, adapterOf), own) };
  });
  const leftovers = leftoversOf(pools.values());
  const found: FileFindings[] = [];
  for (const { file, read } of unmatched) {
    if (read === null) continue;
    const { language, reading } = read;
    if (reading.kind === "unparsed") {
      found.push({ kind: "unparsed", path: file.path, line: reading.line, reason: reading.reason });
      continue;
    }
    const [first, ...rest] = reading.comments
      .filter(({ text }) => !takenFrom(leftovers, text))
      .map(({ line, text }) => ({ line, body: firstLine(text).trim() }))
      .sort((a, b) => a.line - b.line);
    if (first !== undefined)
      found.push({ kind: "comments", path: file.path, language, comments: [first, ...rest] });
  }
  return found.sort(byPath);
}
