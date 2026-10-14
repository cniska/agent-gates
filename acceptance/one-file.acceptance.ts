import { afterEach, expect, test } from "bun:test";
import { mkdirSync, readlinkSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { git, readText, removeScratch, scratchDir, shell, writeFiles } from "./cli";
import { commentReply, gated, KEPT_JAVASCRIPT } from "./no-comments";

afterEach(removeScratch);

const SCAN = ".githooks/no-comments/scan.cjs";

function scanFile(dir: string, path: string, from = dir) {
  return shell(from, `node '${join(dir, SCAN)}' --file '${path}'`);
}

function refusal(findings: readonly (readonly [string, readonly string[]])[]) {
  return { status: 1, stdout: "", stderr: commentReply([KEPT_JAVASCRIPT], findings) };
}

const UNTRACKED = ["ignored.ts", "generated.ts", "binary.ts", "new.ts"];

function state(dir: string): readonly string[] {
  return [
    git(dir, ["status", "--porcelain", "--untracked-files=all", "--ignored"]),
    git(dir, ["diff"]),
    git(dir, ["diff", "--cached"]),
    ...UNTRACKED.map((path) => readText(dir, path)),
    readlinkSync(join(dir, "link.ts")),
  ];
}

const PASSES = { status: 0, stdout: "", stderr: "" };

test("AC-35 judges one file as the working tree holds it against HEAD, and writes nothing", () => {
  const dir = gated(["no-comments-javascript"], {
    "src/a.ts": "export const a = 1; // old\n",
    "b.ts": "export const b = 1;\n",
    "m.ts": "export const m = 1; // kept\n",
    "from.ts": "export const f = 1; // moved\n",
    "to.ts": "export const t = 1;\n",
    ".gitignore": "ignored.ts\n",
    ".gitattributes": "generated.ts linguist-generated\n",
  });
  mkdirSync(join(dir, "sub"));

  writeFiles(dir, {
    "src/a.ts": "export const a = 1; // old\nexport const b = 2; // why\n",
    "b.ts": "export const b = 2; // staged\n",
  });
  git(dir, ["add", "b.ts"]);
  writeFiles(dir, {
    "b.ts": "export const b = 2;\n",
    "ignored.ts": "export const i = 1; // ignored\n",
    "generated.ts": "export const g = 1; // generated\n",
    "binary.ts": "// binary\n\u0000\u0001\u0002\n",
    "new.ts": "export const n = 1; // new\n",
    "from.ts": "export const f = 1;\n",
    "to.ts": "export const t = 1; // moved\n",
  });
  symlinkSync("// a link", join(dir, "link.ts"));
  git(dir, ["mv", "m.ts", "renamed.ts"]);
  const before = state(dir);

  const added = refusal([["src/a.ts", ["2  // why"]]]);
  expect(scanFile(dir, "src/a.ts")).toEqual(added);
  expect(scanFile(dir, "a.ts", join(dir, "src"))).toEqual(added);
  expect(scanFile(dir, join(dir, "src/a.ts"), join(dir, "sub"))).toEqual(added);
  for (const path of ["b.ts", "ignored.ts", "generated.ts", "binary.ts", "link.ts", "gone.ts"])
    expect(scanFile(dir, path)).toEqual(PASSES);
  expect(scanFile(dir, "new.ts")).toEqual(refusal([["new.ts", ["1  // new"]]]));
  expect(scanFile(dir, "renamed.ts")).toEqual(refusal([["renamed.ts", ["1  // kept"]]]));
  expect(scanFile(dir, "to.ts")).toEqual(refusal([["to.ts", ["1  // moved"]]]));
  const elsewhere = scratchDir();
  writeFiles(elsewhere, { "a.ts": "export const a = 1; // elsewhere\n" });
  const outside = join(elsewhere, "a.ts");
  expect(scanFile(dir, outside)).toEqual({
    status: 2,
    stdout: "",
    stderr: `no-comments: ${outside} is not inside the checkout at ${dir}; run the scan from inside the checkout that holds ${outside}\n`,
  });

  expect(state(dir)).toEqual(before);
});
