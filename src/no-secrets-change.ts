import { realpathSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { invariant, unreachable } from "./assert";
import { blobsOf, gitOutput, mergeBase, nulFields } from "./git";
import { ALLOW_FILE } from "./no-secrets-allow";

export type Judged =
  | { readonly kind: "staged" }
  | { readonly kind: "pushed"; readonly base: string; readonly head: string }
  | { readonly kind: "all" };

export type RootRelative = { readonly inRoot: string };

type Side = { readonly path: string; readonly blob: string };

type Change = { readonly head: Side; readonly base: Side | null };

export type FileText = { readonly path: string; readonly text: string };

export type JudgedChange = { readonly heads: readonly FileText[]; readonly bases: readonly FileText[] };

const REGULAR_FILE_MODES = new Set(["100644", "100755"]);

const CHANGES = ["-M", "-C", "--diff-filter=AMTRC", "-z"];

const RENAMED = "R";

const COPIED = "C";

const NUMSTAT_RECORD = /^([^\t]*\t[^\t]*\t)(.*)$/s;

const BINARY = "-\t-\t";

const PARENT = "..";

const INDEX_ENTRY = /^\d+ ([0-9a-f]+) 0\t/;

const TREE_ENTRY = /^\d+ blob ([0-9a-f]+)\t/;

export function rootRelative(root: string, absolute: string): RootRelative | null {
  const inRoot = relative(realpathSync(root), realpathSync(absolute));
  if (isAbsolute(inRoot) || inRoot.split(sep)[0] === PARENT) return null;
  return { inRoot };
}

function isRegularFileMode(mode: string): boolean {
  return REGULAR_FILE_MODES.has(mode);
}

function emptyTree(root: string): string {
  return gitOutput(root, ["hash-object", "-t", "tree", "--stdin"], "").toString().trim();
}

function diffOf(root: string, judged: Judged): readonly string[] {
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
    if (!isRegularFileMode(mode)) continue;
    const base = isRegularFileMode(baseMode) ? { path: basePath, blob: baseBlob } : null;
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

function filesOf(root: string, sides: readonly Side[]): FileText[] {
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

function textualChanges(root: string, diff: readonly string[]): Change[] {
  const binary = binaryPaths(nulFields(gitOutput(root, [...diff, ...CHANGES, "--numstat"])));
  return changesIn(nulFields(gitOutput(root, [...diff, ...CHANGES, "--raw", "--no-abbrev"]))).filter(
    ({ head }) => !binary.has(head.path),
  );
}

export function judgedChange(root: string, judged: Judged): JudgedChange {
  const changes = textualChanges(root, diffOf(root, judged));
  const bases = new Map(changes.flatMap(({ base }) => (base === null ? [] : [[base.path, base] as const])));
  const files = filesOf(root, [...changes.map(({ head }) => head), ...bases.values()]);
  return { heads: files.slice(0, changes.length), bases: files.slice(changes.length) };
}

function allowBlobOf(root: string, target: Judged): string | null {
  switch (target.kind) {
    case "staged":
    case "all": {
      const [entry] = nulFields(
        gitOutput(root, ["--literal-pathspecs", "ls-files", "-s", "-z", "--", ALLOW_FILE]),
      );
      return INDEX_ENTRY.exec(entry ?? "")?.[1] ?? null;
    }
    case "pushed": {
      const [entry] = nulFields(
        gitOutput(root, ["--literal-pathspecs", "ls-tree", "-z", target.head, "--", ALLOW_FILE]),
      );
      return TREE_ENTRY.exec(entry ?? "")?.[1] ?? null;
    }
    default:
      return unreachable(target);
  }
}

export function allowTextOf(root: string, target: Judged): string | null {
  const blob = allowBlobOf(root, target);
  if (blob === null) return null;
  const [text] = blobsOf(root, [blob]);
  invariant(text !== undefined, "git cat-file --batch returns the allow file's blob");
  return text.toString();
}
