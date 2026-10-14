import { afterEach, expect, test } from "bun:test";
import { rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { checkout, commitAs, committing, git, install, type Outcome, removeScratch, writeFiles } from "./cli";

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

function commentReply(kept: readonly string[], findings: Findings): string {
  const count = findings.reduce((total, [, found]) => total + found.length, 0);
  return lines([
    `no-comments: this change adds ${count} ${count === 1 ? "comment" : "comments"}. ${REMOVE}`,
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

test.todo("AC-24 judges the pushed range in CI, annotating findings for GitHub", () => {});
test.todo("AC-25 sweeps the tracked files, and exits 2 or 3 when it cannot judge", () => {});
