import { invariant, unreachable } from "./assert";
import { markerLine } from "./gate-marker";
import { blobsOf, gitOutput, mergeBase, nulFields } from "./git";
import { type CommentsOf, type Language, languageOf, type Reading } from "./no-comments-languages";
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

type JudgedFile = { readonly path: string; readonly text: string };

type JudgedHead = { readonly file: JudgedFile; readonly base: Base | null };

type JudgedChange = { readonly heads: readonly JudgedHead[]; readonly bases: readonly JudgedFile[] };

type Pool = Map<string, number>;

type Finding =
  | { readonly kind: "comment"; readonly path: string; readonly line: number; readonly body: string }
  | { readonly kind: "unparsed"; readonly path: string; readonly line: number; readonly reason: string };

export type AdapterOf = (language: Language) => CommentsOf | null;

const REGULAR_FILE_MODES = new Set(["100644", "100755"]);

const CHANGES = ["-M", "-C", "--diff-filter=AMTRC", "-z"];

const RENAMED = "R";

const COPIED = "C";

const NUMSTAT_RECORD = /^([^\t]*\t[^\t]*\t)(.*)$/s;

const BINARY = "-\t-\t";

const WHITESPACE_RUN = /\s+/g;

const FIX = "  Remove each comment; a why belongs in a name, a test or the docs.";

function emptyTree(root: string): string {
  return gitOutput(root, ["hash-object", "-t", "tree", "--stdin"], "").toString().trim();
}

function diffOf(root: string, judged: Judged): string[] {
  switch (judged.kind) {
    case "staged":
      return ["diff", "--cached"];
    case "pushed":
      return ["diff", mergeBase(root, judged.base, judged.head) ?? emptyTree(root), judged.head];
    case "all":
      return ["diff", "--cached", emptyTree(root)];
    default:
      return unreachable(judged);
  }
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

export function filesOf(root: string, sides: readonly Side[]): JudgedFile[] {
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
  const diff = diffOf(root, judged);
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
  const inTheCode = changesInTheCode(root, judged);
  const bases = new Map(inTheCode.flatMap(({ base }) => (base === null ? [] : [[base.path, base]])));
  const files = filesOf(root, [...inTheCode.map(({ head }) => head), ...bases.values()]);
  const heads = inTheCode.map(({ base }, index) => {
    const file = files[index];
    invariant(file !== undefined, "each change's head is read");
    return { file, base: base === null ? null : { origin: base.origin, path: base.path } };
  });
  return { heads, bases: files.slice(inTheCode.length) };
}

function readingOf({ path, text }: JudgedFile, adapterOf: AdapterOf): Reading | null {
  const language = languageOf(path, firstLine(text));
  const comments = language === null ? null : adapterOf(language);
  if (comments === null) return null;
  const reading = comments(path, text);
  if (reading.kind === "unparsed") return reading;
  const lines = text.split("\n");
  const unmarked = reading.comments.filter(({ line }) => markerLine(lines[line - 1] ?? "") === null);
  return { kind: "read", comments: unmarked };
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
  const reading = readingOf(base, adapterOf);
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

function unmatchedIn(reading: Reading | null, own: Pool | null): Reading | null {
  if (reading?.kind !== "read" || own === null) return reading;
  return { kind: "read", comments: reading.comments.filter(({ text }) => !takenFrom(own, text)) };
}

export function findings({ heads, bases }: JudgedChange, adapterOf: AdapterOf): Finding[] {
  const pools = new Map(bases.map((base) => [base.path, poolOf(base, adapterOf)]));
  const unmatched = heads.map(({ file, base }) => {
    const own = base?.origin === "own" ? (pools.get(base.path) ?? null) : null;
    return { file, reading: unmatchedIn(readingOf(file, adapterOf), own) };
  });
  const leftovers = leftoversOf(pools.values());
  const found: Finding[] = [];
  for (const { file, reading } of unmatched) {
    if (reading === null) continue;
    if (reading.kind === "unparsed") {
      found.push({ kind: "unparsed", path: file.path, line: reading.line, reason: reading.reason });
      continue;
    }
    for (const comment of reading.comments)
      if (!takenFrom(leftovers, comment.text))
        found.push({
          kind: "comment",
          path: file.path,
          line: comment.line,
          body: firstLine(comment.text).trim(),
        });
  }
  return found;
}

function lineOf(finding: Finding): string {
  switch (finding.kind) {
    case "comment":
      return `no-comments: ${finding.path}:${finding.line}  ${finding.body}`;
    case "unparsed":
      return `no-comments: ${finding.path}:${finding.line} does not parse: ${finding.reason}; fix its syntax`;
    default:
      return unreachable(finding);
  }
}

export function verdict(found: readonly Finding[]): string[] {
  const lines = found.map(lineOf);
  return found.some(({ kind }) => kind === "comment") ? [...lines, FIX] : lines;
}
