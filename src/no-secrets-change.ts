import { realpathSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { type FileText, filesOf, type Judged, textualChanges } from "./scanner-change";

export type RootRelative = { readonly inRoot: string };

export type JudgedChange = { readonly heads: readonly FileText[]; readonly bases: readonly FileText[] };

const PARENT = "..";

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
