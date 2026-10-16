import { realpathSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { invariant, unreachable } from "./assert";
import { blobsOf, gitOutput, nulFields } from "./git";
import { ALLOW_FILE } from "./no-secrets-allow";
import { type FileText, filesOf, type Judged, textualChanges } from "./scanner-change";

export type RootRelative = { readonly inRoot: string };

export type JudgedChange = { readonly heads: readonly FileText[]; readonly bases: readonly FileText[] };

const PARENT = "..";

const INDEX_ENTRY = /^\d+ ([0-9a-f]+) 0\t/;

const TREE_ENTRY = /^\d+ blob ([0-9a-f]+)\t/;

export function rootRelative(root: string, absolute: string): RootRelative | null {
  const inRoot = relative(realpathSync(root), realpathSync(absolute));
  if (isAbsolute(inRoot) || inRoot.split(sep)[0] === PARENT) return null;
  return { inRoot };
}

export function judgedChange(root: string, judged: Judged): JudgedChange {
  const changes = textualChanges(root, judged);
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
