import { type Use, usesIn } from "./pinned-actions-read";
import { filesOf, type Judged, textualChanges } from "./scanner-change";

export type FileUses = { readonly path: string; readonly unpinned: readonly [Use, ...Use[]] };

const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/;

const ACTION_FILE = /(?:^|\/)action\.ya?ml$/;

const LOCAL_ACTION = "./";

const OWN_REPOSITORY = "$/";

const DOCKER_IMAGE = "docker://";

const COMMIT_SHA = /@[0-9a-f]{40}$/;

const IMAGE_DIGEST = /@sha256:[0-9a-f]{64}$/;

function isJudgedPath(path: string): boolean {
  return WORKFLOW_FILE.test(path) || ACTION_FILE.test(path);
}

function isPinned(ref: string): boolean {
  if (ref.startsWith(LOCAL_ACTION) || ref.startsWith(OWN_REPOSITORY)) return true;
  if (ref.startsWith(DOCKER_IMAGE)) return IMAGE_DIGEST.test(ref);
  return COMMIT_SHA.test(ref);
}

function byPath(a: FileUses, b: FileUses): number {
  if (a.path === b.path) return 0;
  return a.path < b.path ? -1 : 1;
}

export function unpinnedIn(root: string, judged: Judged): readonly FileUses[] {
  const heads = textualChanges(root, judged)
    .map(({ head }) => head)
    .filter(({ path }) => isJudgedPath(path));
  return filesOf(root, heads)
    .flatMap(({ path, text }): FileUses[] => {
      const [first, ...rest] = usesIn(text).filter(({ ref }) => !isPinned(ref));
      return first === undefined ? [] : [{ path, unpinned: [first, ...rest] }];
    })
    .toSorted(byPath);
}
