import { afterEach, expect, test } from "bun:test";
import { rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import {
  checkout,
  cloneOf,
  commitAs,
  committing,
  git,
  githubStep,
  install,
  NO_COMMIT,
  type Outcome,
  pathOf,
  readText,
  removeScratch,
  scratchDir,
  shell,
  stepScript,
  writeFiles,
} from "./cli";

afterEach(removeScratch);

const ALL_LANGUAGES = ["javascript", "dart", "sql", "shell", "rust", "python"].map(
  (language) => `no-comments-${language}`,
);

const REMOVE = "Remove each comment; a why belongs in a name, a test or the docs.";

const FIX_SYNTAX = "Fix the syntax where each file stops parsing.";

const SHEBANG = "the first-line shebang, with no `#` word or `\\c` after `#!`";

const KEPT_JAVASCRIPT = `kept in JavaScript and TypeScript: ${SHEBANG}; a leading \`/// <reference …/>\` holding only its attributes; a gate marker on a line of its own`;

const KEPT_PYTHON = `kept in Python: ${SHEBANG}; a gate marker on a line of its own`;

type Findings = readonly (readonly [path: string, lines: readonly string[]])[];

function gated(gates: readonly string[], files: Readonly<Record<string, string>> = {}): string {
  const dir = checkout(files);
  install(dir, gates);
  git(dir, ["add", "-A"]);
  commitAs(dir, "chore: start");
  return dir;
}

function commitStaged(dir: string, paths: readonly string[] = []): Outcome {
  return committing(dir, ["-q", "-m", "feat: change things", ...paths]);
}

function restart(dir: string, to = "HEAD"): string {
  git(dir, ["reset", "-q", "--hard", to]);
  git(dir, ["clean", "-q", "-f", "-d"]);
  return dir;
}

function commitFiles(dir: string, files: Readonly<Record<string, string>>): Outcome {
  writeFiles(dir, files);
  git(dir, ["add", "-A"]);
  return commitStaged(dir);
}

const PASSED: Outcome = { status: 0, stderr: "", made: true };

function lines(texts: readonly string[]): string {
  return texts.map((text) => `${text}\n`).join("");
}

function commentReply(kept: readonly string[], findings: Findings, lead = "this change adds"): string {
  const count = findings.reduce((total, [, found]) => total + found.length, 0);
  return lines([
    `no-comments: ${lead} ${count} ${count === 1 ? "comment" : "comments"}. ${REMOVE}`,
    ...kept,
    ...findings.flatMap(([path, found]) => [path, ...found.map((line) => `  ${line}`)]),
  ]);
}

function refusedWith(text: string): Outcome {
  return { status: 1, stderr: text, made: false };
}

function javascriptRefusal(findings: Findings): Outcome {
  return refusedWith(commentReply([KEPT_JAVASCRIPT], findings));
}

function unparsedRefusal(path: string, line: number, reason: string): Outcome {
  return refusedWith(
    lines([
      `no-comments: 1 file does not parse. ${FIX_SYNTAX}`,
      path,
      `  ${line}  does not parse: ${reason}`,
    ]),
  );
}

test("AC-19 refuses a commit that adds comments, judging the index", () => {
  const dir = gated(["no-comments-javascript"], { "a.ts": "export const a = 1;\n" });
  expect(commitFiles(dir, { "a.ts": "export const a = 2;\n" })).toEqual(PASSED);

  expect(
    commitFiles(dir, {
      "a.ts": "export const a = 3; // three\n/* a block\n   over lines */\nexport const b = 4;\n",
      "b.ts": "// b\nexport const c = 5;\n",
    }),
  ).toEqual(
    javascriptRefusal([
      ["a.ts", ["1  // three", "2  /* a block"]],
      ["b.ts", ["1  // b"]],
    ]),
  );

  restart(dir);
  writeFiles(dir, { "a.ts": "export const a = 3; // staged\n" });
  git(dir, ["add", "a.ts"]);
  writeFiles(dir, { "a.ts": "export const a = 3;\n" });
  expect(commitStaged(dir)).toEqual(javascriptRefusal([["a.ts", ["1  // staged"]]]));
  expect(commitStaged(dir, ["a.ts"])).toEqual(PASSED);
  expect(git(dir, ["show", "HEAD:a.ts"])).toBe("export const a = 3;");
});

const KEPT = "// keep this one\nexport const a = 1;\nexport const b = 2;\n";

test("AC-20 passes a comment the change moved, reindented or renamed with its file", () => {
  const dir = gated(["no-comments-javascript"], { "a.ts": KEPT });
  const base = git(dir, ["rev-parse", "HEAD"]);

  expect(
    commitFiles(restart(dir, base), {
      "a.ts": "export const a = 1;\n// keep this one\nexport const b = 2;\n",
    }),
  ).toEqual(PASSED);
  expect(
    commitFiles(restart(dir, base), {
      "a.ts":
        "export const a = 1;\nexport function f(): void {\n    //   keep   this one\n}\nexport const b = 2;\n",
    }),
  ).toEqual(PASSED);
  git(restart(dir, base), ["mv", "a.ts", "renamed.ts"]);
  expect(commitStaged(dir)).toEqual(PASSED);
  expect(
    commitFiles(restart(dir, base), {
      "a.ts": "export const a = 1;\nexport const b = 2;\n",
      "c.ts": "// keep this one\nexport const c = 3;\n",
    }),
  ).toEqual(PASSED);
});

test("AC-20 refuses a comment the change edited, split, joined, duplicated, copied or freed", () => {
  const dir = gated(["no-comments-javascript"], { "a.ts": KEPT });
  const base = git(dir, ["rev-parse", "HEAD"]);
  expect(commitFiles(restart(dir, base), { "a.ts": KEPT.replace("keep this one", "keep this two") })).toEqual(
    javascriptRefusal([["a.ts", ["1  // keep this two"]]]),
  );
  expect(
    commitFiles(restart(dir, base), { "a.ts": KEPT.replace("// keep this one", "// keep\n// this one") }),
  ).toEqual(javascriptRefusal([["a.ts", ["1  // keep", "2  // this one"]]]));
  expect(commitFiles(restart(dir, base), { "a.ts": `${KEPT}// keep this one\n` })).toEqual(
    javascriptRefusal([["a.ts", ["4  // keep this one"]]]),
  );
  expect(commitFiles(restart(dir, base), { "c.ts": "// keep this one\nexport const c = 3;\n" })).toEqual(
    javascriptRefusal([["c.ts", ["1  // keep this one"]]]),
  );
  rmSync(join(restart(dir, base), "a.ts"));
  expect(
    commitFiles(dir, { "c.ts": "export function other(): number {\n  return 3;\n}\n// keep this one\n" }),
  ).toEqual(javascriptRefusal([["c.ts", ["4  // keep this one"]]]));

  const split = gated(["no-comments-javascript"], { "a.ts": "// keep\n// this one\nexport const a = 1;\n" });
  expect(commitFiles(split, { "a.ts": "// keep this one\nexport const a = 1;\n" })).toEqual(
    javascriptRefusal([["a.ts", ["1  // keep this one"]]]),
  );
  restart(split);
  writeFiles(split, { "a.ts": "// keep this one\nexport const = ;\n" });
  git(split, ["add", "a.ts"]);
  commitAs(split, "chore: break the file");
  expect(commitFiles(split, { "a.ts": "// keep this one\nexport const a = 1;\n" })).toEqual(
    javascriptRefusal([["a.ts", ["1  // keep this one"]]]),
  );
});

test("AC-21 skips what is not code, and routes a file by its extension or shebang", () => {
  const dir = gated(["no-comments-javascript", "no-comments-python"], {
    ".gitattributes": "generated.ts linguist-generated\nvendor/** linguist-vendored\n",
  });
  symlinkSync("// a link", join(dir, "link.ts"));
  expect(
    commitFiles(dir, {
      "generated.ts": "// generated\nexport const a = 1;\n",
      "vendor/lib.ts": "// vendored\nexport const b = 2;\n",
      "binary.ts": "// binary\n\u0000\u0001\u0002\n",
      "README.md": "# Title\n\n<!-- a comment -->\n",
      "says-generated.ts": "// @generated by a tool, do not edit\nexport const c = 3;\n",
    }),
  ).toEqual(javascriptRefusal([["says-generated.ts", ["1  // @generated by a tool, do not edit"]]]));

  restart(dir);
  expect(
    commitFiles(dir, {
      "bin/node-tool": "#!/usr/bin/env -S node --no-warnings\n// node\n",
      "bin/python-tool": "#!/usr/bin/python3.12\n# python\n",
      "bin/uv-tool": "#!/usr/bin/env uv run --script\n# uv\n",
    }),
  ).toEqual(
    refusedWith(
      commentReply(
        [KEPT_JAVASCRIPT, KEPT_PYTHON],
        [
          ["bin/node-tool", ["2  // node"]],
          ["bin/python-tool", ["2  # python"]],
          ["bin/uv-tool", ["2  # uv"]],
        ],
      ),
    ),
  );

  const throwing = gated(["no-comments-javascript"]);
  writeFiles(throwing, { ".githooks/no-comments/javascript.cjs": 'throw new Error("loaded");\n' });
  expect(commitFiles(throwing, { "README.md": "<!-- a comment -->\n", "a.py": "x = 1  # python\n" })).toEqual(
    PASSED,
  );
});

test("AC-22 refuses a file that does not parse, at the line where it stops", () => {
  const dir = gated(ALL_LANGUAGES);
  for (const [path, text, line, reason] of [
    ["a.dart", "void main() {\n  var s = 'abc;\n}\n", 2, "Unterminated string"],
    ["a.sql", "select 1;\nselect 'abc;\n", 2, "Unterminated quote"],
    ["a.sh", 'echo hi\necho "abc\n', 2, "Unterminated quote"],
    ["b.sh", "cat <<EOF\nabc\n", 1, "Unterminated heredoc"],
    ["a.rs", 'fn main() {\n    let s = "abc;\n}\n', 2, "Unterminated string"],
    ["a.py", 'x = 1\ny = "abc\n', 2, "Unterminated string"],
    ["b.dart", "void main() {}\n/* never\n", 2, "Unterminated comment"],
    ["c.dart", "void main() {\n  print(1);\n", 1, "Unterminated brace"],
    ["b.sql", "select (1;\n", 1, "Unterminated parenthesis"],
    ["a.ts", "export const a = 1;\nexport const = ;\n", 2, "Unexpected token"],
  ] as const) {
    expect(commitFiles(restart(dir), { [path]: text })).toEqual(unparsedRefusal(path, line, reason));
  }
});

test("AC-23 cuts a long comment and a long reply", () => {
  const dir = gated(["no-comments-javascript"]);
  expect(commitFiles(dir, { "long.ts": `export const a = 1; // ${"x".repeat(130)}\n` })).toEqual(
    javascriptRefusal([["long.ts", [`1  // ${"x".repeat(116)}…`]]]),
  );

  restart(dir);
  const many = Array.from(
    { length: 150 },
    (_, at) => `export const a${at} = ${at}; // comment number ${at}\n`,
  );
  const shown = Array.from({ length: 133 }, (_, at) => `  ${at + 1}  // comment number ${at}`);
  expect(commitFiles(dir, { "many.ts": many.join(""), "z.ts": "// z\n" })).toEqual(
    refusedWith(
      lines([
        `no-comments: this change adds 151 comments. ${REMOVE}`,
        KEPT_JAVASCRIPT,
        "many.ts",
        ...shown,
        "many.ts: 17 more",
        "z.ts: 1 more",
      ]),
    ),
  );
});

type Push = { readonly base: string; readonly head: string; readonly ref: string };

function judgePush(dir: string, push: Push) {
  const workflow = readText(dir, ".github/workflows/no-comments.yml");
  return githubStep(dir, stepScript(workflow, "Judge each file the push changes"), {
    BASE_SHA: push.base,
    HEAD_SHA: push.head,
    PUSHED_REF: push.ref,
    DEFAULT_BRANCH: "main",
    RUNNER_TEMP: scratchDir(),
  });
}

test("AC-24 judges the pushed range in CI, annotating findings for GitHub", () => {
  const origin = gated(["no-comments-javascript"], { "old.ts": "// old\nexport const old = 0;\n" });
  const clone = cloneOf(origin);
  const before = git(clone, ["rev-parse", "HEAD"]);
  writeFiles(clone, { "clean.ts": "export const clean = 1;\n" });
  git(clone, ["add", "-A"]);
  const clean = commitAs(clone, "feat: add a clean file");
  expect(judgePush(clone, { base: before, head: clean, ref: "refs/heads/main" })).toEqual({
    status: 0,
    stdout: "",
    stderr: "",
  });

  const many = Array.from({ length: 12 }, (_, at) => `export const a${at} = ${at}; // c${at}\n`);
  writeFiles(clone, { "many.ts": many.join("") });
  git(clone, ["add", "-A"]);
  const head = commitAs(clone, "feat: add many comments");
  expect(judgePush(clone, { base: before, head, ref: "refs/heads/main" })).toEqual({
    status: 1,
    stdout: lines([
      ...Array.from({ length: 9 }, (_, at) => `::error file=many.ts,line=${at + 1}::// c${at}`),
      "::error::no-comments: 3 more findings; the step's log lists them all",
    ]),
    stderr: commentReply(
      [KEPT_JAVASCRIPT],
      [["many.ts", Array.from({ length: 12 }, (_, at) => `${at + 1}  // c${at}`)]],
    ),
  });

  git(clone, ["checkout", "-q", "-b", "feature", before]);
  writeFiles(clone, { "branch.ts": "export const branch = 2; // branch\n" });
  git(clone, ["add", "-A"]);
  const branch = commitAs(clone, "feat: add a branch file");
  expect(judgePush(clone, { base: NO_COMMIT, head: branch, ref: "refs/heads/feature" })).toEqual({
    status: 1,
    stdout: lines(["::error file=branch.ts,line=1::// branch"]),
    stderr: commentReply([KEPT_JAVASCRIPT], [["branch.ts", ["1  // branch"]]]),
  });

  git(clone, ["checkout", "-q", "--orphan", "lone"]);
  git(clone, ["rm", "-q", "-r", "--cached", "old.ts", "branch.ts"]);
  rmSync(join(clone, "old.ts"));
  rmSync(join(clone, "branch.ts"));
  writeFiles(clone, { "lone.ts": "export const lone = 3; // lone\n" });
  git(clone, ["add", "-A"]);
  const lone = commitAs(clone, "feat: start over");
  expect(judgePush(clone, { base: NO_COMMIT, head: lone, ref: "refs/heads/lone" })).toEqual({
    status: 1,
    stdout: lines(["::error file=lone.ts,line=1::// lone"]),
    stderr: commentReply([KEPT_JAVASCRIPT], [["lone.ts", ["1  // lone"]]]),
  });
});

const USAGE =
  "scan.cjs takes no arguments, --all, a base and a head, or --file and a path, each optionally after --format github";

const USAGE_FIX = "node scan.cjs [--format github] [--all | <base> <head> | --file <path>]";

test("AC-25 sweeps the tracked files, and exits 2 or 3 when it cannot judge", () => {
  const dir = gated(["no-comments-javascript"], { "a.ts": "export const a = 1; // a\n" });
  writeFiles(dir, { "b.ts": "export const b = 2; // b\n" });
  git(dir, ["add", "b.ts"]);
  writeFiles(dir, { "b.ts": "export const b = 2;\n", "c.ts": "export const c = 3; // c\n" });
  expect(shell(dir, "node .githooks/no-comments/scan.cjs --all")).toEqual({
    status: 1,
    stdout: "",
    stderr: commentReply(
      [KEPT_JAVASCRIPT],
      [
        ["a.ts", ["1  // a"]],
        ["b.ts", ["1  // b"]],
      ],
      "the tracked files hold",
    ),
  });

  for (const [args, count] of [
    ["HEAD", "1: HEAD"],
    ["--all HEAD", "2: --all HEAD"],
    ["--nope", "1: --nope"],
  ] as const)
    expect(shell(dir, `node .githooks/no-comments/scan.cjs ${args}`)).toEqual({
      status: 2,
      stdout: "",
      stderr: `no-comments: ${USAGE}, and got ${count}; ${USAGE_FIX}\n`,
    });

  const withoutNode = pathOf(["git", "sh"]);
  expect(shell(dir, ".githooks/pre-commit.d/no-comments", { PATH: withoutNode })).toEqual({
    status: 3,
    stdout: "",
    stderr: "no-comments: node is not on PATH, so the commit's comments cannot be judged; install Node.js\n",
  });

  writeFiles(dir, { ".githooks/no-comments/javascript.cjs": "module.exports = {};\n" });
  expect(shell(dir, "node .githooks/no-comments/scan.cjs --all")).toEqual({
    status: 3,
    stdout: "",
    stderr: `no-comments: invariant failed: ${join(dir, ".githooks/no-comments/javascript.cjs")} exports comments(); stop and hand this error to the owner as a bug in agent-gates; no command you run resolves it\n`,
  });
});
