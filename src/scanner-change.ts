import { invariant, unreachable } from "./assert";
import { blobsOf, gitOutput, mergeBase, nulFields } from "./git";

export type Judged =
  | { readonly kind: "staged" }
  | { readonly kind: "pushed"; readonly base: string; readonly head: string }
  | { readonly kind: "all" };

type Side = { readonly path: string; readonly blob: string };

export type Origin = "own" | "copy";

export type Change = { readonly head: Side; readonly base: (Side & { readonly origin: Origin }) | null };

export type FileText = { readonly path: string; readonly text: string };

const REGULAR_FILE_MODES = new Set(["100644", "100755"]);

const CHANGES = ["-M", "-C", "--diff-filter=AMTRC", "-z"];

const RENAMED = "R";

const COPIED = "C";

const NUMSTAT_RECORD = /^([^\t]*\t[^\t]*\t)(.*)$/s;

const BINARY = "-\t-\t";

export function isRegularFileMode(mode: string): boolean {
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
    const origin: Origin = kind === COPIED ? "copy" : "own";
    const base = isRegularFileMode(baseMode) ? { origin, path: basePath, blob: baseBlob } : null;
    changes.push({ head: { path, blob }, base });
  }
  return changes;
}

export function binaryPaths(fields: readonly string[]): Set<string> {
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

export function textualChanges(root: string, judged: Judged): Change[] {
  const diff = diffOf(root, judged);
  const binary = binaryPaths(nulFields(gitOutput(root, [...diff, ...CHANGES, "--numstat"])));
  return changesIn(nulFields(gitOutput(root, [...diff, ...CHANGES, "--raw", "--no-abbrev"]))).filter(
    ({ head }) => !binary.has(head.path),
  );
}
