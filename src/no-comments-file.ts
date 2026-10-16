import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { usageErrors } from "./coded-error";
import { diffOutput, gitOutput, isCommit, nulFields } from "./git";
import type { JudgedChange } from "./no-comments-scan";
import { outsideTheCode } from "./no-comments-skips";
import { binaryPaths, filesOf, isRegularFileMode } from "./scanner-change";

const fileUsageError = usageErrors<{
  readonly outside_checkout: { readonly path: string; readonly root: string };
}>({
  outside_checkout: {
    message: ({ path, root }) => `${path} is not inside the checkout at ${root}`,
    resolve: ({ path }) => `run the scan from inside the checkout that holds ${path}`,
  },
});

const NO_CHANGE: JudgedChange = { heads: [], bases: [] };

const HEAD = "HEAD";

const NO_FILE = "/dev/null";

const PARENT = "..";

const NUMSTAT = ["--numstat", "-z"];

const BLOB_ENTRY = /^(\d+) blob ([0-9a-f]+)\t/;

function checkoutPath(root: string, absolute: string): string | null {
  if (lstatSync(absolute, { throwIfNoEntry: false })?.isFile() !== true) return null;
  const real = join(realpathSync(dirname(absolute)), basename(absolute));
  const inRoot = relative(realpathSync(root), real);
  if (inRoot === "" || isAbsolute(inRoot) || inRoot.split(sep)[0] === PARENT)
    throw fileUsageError("outside_checkout", { path: absolute, root });
  return inRoot;
}

function committable(root: string, path: string): boolean {
  const listed = nulFields(
    gitOutput(root, [
      "--literal-pathspecs",
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      path,
    ]),
  );
  return listed.includes(path);
}

function baseBlob(root: string, path: string): string | null {
  if (!isCommit(root, HEAD)) return null;
  const [entry] = nulFields(gitOutput(root, ["--literal-pathspecs", "ls-tree", "-z", HEAD, "--", path]));
  const [, mode, blob] = BLOB_ENTRY.exec(entry ?? "") ?? [];
  return mode !== undefined && blob !== undefined && isRegularFileMode(mode) ? blob : null;
}

function numstatOf(root: string, path: string, base: string | null): readonly string[] {
  if (base === null)
    return nulFields(diffOutput(root, ["diff", "--no-index", ...NUMSTAT, "--", NO_FILE, path]));
  return nulFields(gitOutput(root, ["--literal-pathspecs", "diff", HEAD, ...NUMSTAT, "--", path]));
}

export function fileChange(root: string, absolute: string): JudgedChange {
  const inRoot = checkoutPath(root, absolute);
  if (inRoot === null || !committable(root, inRoot) || outsideTheCode(root, [inRoot]).has(inRoot))
    return NO_CHANGE;
  const blob = baseBlob(root, inRoot);
  const numstat = numstatOf(root, inRoot, blob);
  if (numstat.length === 0 || binaryPaths(numstat).has(inRoot)) return NO_CHANGE;
  const file = { path: inRoot, text: readFileSync(join(root, inRoot), "utf8") };
  if (blob === null) return { heads: [{ file, base: null }], bases: [] };
  return {
    heads: [{ file, base: { origin: "own", path: inRoot } }],
    bases: filesOf(root, [{ path: inRoot, blob }]),
  };
}
