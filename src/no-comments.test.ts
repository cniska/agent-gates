import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gatesDoctor } from "./doctor";
import { bundled } from "./gate-bundles";
import { installGates, SOURCE_DIR } from "./gates";
import { ADAPTER_FILES, SCANNER_FILE } from "./gates-contract";
import { type Comment, type CommentsOf, type Reading, SHARED_SHOWN } from "./no-comments-adapter";
import { ADAPTERS } from "./no-comments-adapters.test-support";
import { LANGUAGE_NAMES, LANGUAGES, type Language, languageOf } from "./no-comments-languages";
import {
  commit,
  commitPastHooks,
  IDENTITY,
  NO_COMMIT,
  refusalOf,
  removeScratchDirs,
  repo,
  scratchDir,
  writeFiles,
} from "./repo.test-support";

function trackedIn(paths: readonly string[]): (path: string) => boolean {
  const tracked = new Set(paths);
  return (path) => tracked.has(path);
}

function untracked(of: CommentsOf): (path: string, text: string) => Reading {
  return (path, text) => of(path, text, trackedIn([]));
}

const comments = untracked(ADAPTERS.javascript.comments);

const dartComments = untracked(ADAPTERS.dart.comments);

const sqlComments = untracked(ADAPTERS.sql.comments);

const shellComments = untracked(ADAPTERS.shell.comments);

const rustComments = untracked(ADAPTERS.rust.comments);

const goComments = untracked(ADAPTERS.go.comments);

function read(comments: readonly Comment[]): Reading {
  return { kind: "read", comments };
}

function unparsed(line: number, reason: string): Reading {
  return { kind: "unparsed", line, reason };
}

const KEPT_IN_JAVASCRIPT =
  "kept in JavaScript and TypeScript: `@ts-expect-error`; a leading `// @ts-check` in plain JavaScript; `eslint-disable-line` and `eslint-disable-next-line` naming rules; `/* eslint-disable */` and `/* eslint-enable */` naming rules; `biome-ignore`, `-all`, `-start` and `-end` naming only rules or `format`; `prettier-ignore` alone; `#__PURE__` or `@__PURE__` alone; `@vitest-environment <env>` alone; a leading `/// <reference`; in plain JavaScript, JSDoc blocks holding only `@type {…}`, `@typedef {…} Name` and `@param {…} name`; one `SPDX-License-Identifier:` line; a gate marker on a line of its own";

const KEPT_IN_RUST =
  "kept in Rust: in library code, an outer doc comment (`///`, `/** */`, `#[doc]`) on a `pub` item, a `#[macro_export]` macro, or a variant or item of a `pub` enum or trait; an inner doc comment (`//!`, `/*! */`, `#![doc]`) in a library's `src/lib.rs`; one `SPDX-License-Identifier:` line; a gate marker on a line of its own";

const KEPT_IN_GO =
  'kept in Go: in library code, a doc or trailing comment `go doc` shows: on the package, or on an exported name, its fields and its methods; `//go:` directives at column 1 (`build`, `generate`, `embed`, `linkname`, `noinline`, `nosplit`, `noescape`, `norace`, `nocheckptr`, `uintptrescapes`, `uintptrkeepalive`, `wasmimport`, `wasmexport`, `debug`, `fix`), with `//go:build` only before `package` and `//go:embed` only above a `var`; `// +build` before `package`; `//line file:N` at column 1, and `/*line file:N*/`; `//export Name` above the top-level func `Name`, in a file that imports `"C"`; the cgo preamble above `import "C"`, but no line of it that starts a C `//` comment; `//nolint:` naming linters, never `all`; `//lint:ignore` and `//lint:file-ignore` naming checks, with a reason; `// Code generated … DO NOT EDIT.` before `package`; in a `_test.go` file outside packages `main` and `main_test`, an `Example` func\'s doc and its closing `// Output:` comment; `// want` in a file under `testdata`; one `SPDX-License-Identifier:` line; a gate marker on a line of its own';

function refusalText(listing: readonly string[], kept: readonly string[] = [KEPT_IN_JAVASCRIPT]): string {
  const count = listing.filter((line) => line.startsWith("  ")).length;
  const total = count === 1 ? "1 comment" : `${count} comments`;
  const header = `no-comments: this change adds ${total}. Remove each comment; a why belongs in a name, a test or the docs.`;
  return [header, ...kept, ...listing, ""].join("\n");
}

function gated(files: Record<string, string> = {}): string {
  const dir = repo(files);
  installGates(dir, ["no-comments-javascript"]);
  return dir;
}

function doctorCheck(dir: string, name: string) {
  return gatesDoctor(dir).checks.find((check) => check.name === name);
}

function git(dir: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", dir, ...IDENTITY, ...args], { encoding: "utf8" }).trim();
}

function commitPaths(dir: string, paths: readonly string[]) {
  const run = spawnSync(
    "git",
    ["-C", dir, ...IDENTITY, "commit", "-q", "-m", "feat: change", "--", ...paths],
    {
      encoding: "utf8",
    },
  );
  return { status: run.status, stderr: run.stderr };
}

function scanned(dir: string, args: readonly string[]) {
  const run = spawnSync("node", [join(dir, ".githooks/no-comments/scan.cjs"), ...args], {
    cwd: dir,
    encoding: "utf8",
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

function scan(dir: string, args: readonly string[]) {
  const { status, stdout, stderr } = scanned(dir, args);
  expect(stdout).toBe("");
  return { status, stderr };
}

afterEach(removeScratchDirs);

describe("the language table", () => {
  test("routes each extension and interpreter to one language at most", () => {
    for (const key of ["extensions", "interpreters"] as const) {
      const claimed = LANGUAGE_NAMES.flatMap((language) => LANGUAGES[language][key]);
      expect([key, claimed.length]).toEqual([key, new Set(claimed).size]);
    }
  });

  test("routes by extension, and by the shebang when there is none", () => {
    expect(languageOf("src/a.tsx", "")).toBe("javascript");
    expect(languageOf("types/a.d.ts", "#!/bin/sh")).toBe("javascript");
    expect(languageOf("README.md", "#!/usr/bin/env node")).toBeNull();
    expect(languageOf("bin/tool", "#!/usr/bin/env node")).toBe("javascript");
    expect(languageOf("bin/tool", "#!/usr/bin/env -S bun --silent")).toBe("javascript");
    expect(languageOf("bin/tool", "#!/usr/local/bin/deno run")).toBe("javascript");
    expect(languageOf("bin/tool", "#!/usr/bin/env python3")).toBeNull();
    expect(languageOf(".eslintrc", "")).toBeNull();
    expect(languageOf("lib/a.dart", "")).toBe("dart");
    expect(languageOf("bin/tool", "#!/usr/bin/env dart")).toBe("dart");
    expect(languageOf("db/001.sql", "")).toBe("sql");
    expect(languageOf("src/main.rs", "")).toBe("rust");
    expect(languageOf("scripts/a.sh", "")).toBe("shell");
    expect(languageOf("scripts/a.bash", "")).toBe("shell");
    for (const shebang of ["#!/bin/sh", "#!/usr/bin/env bash", "#!/bin/dash", "#!/bin/zsh -f"])
      expect([shebang, languageOf(".githooks/pre-push", shebang)]).toEqual([shebang, "shell"]);
  });
});

describe("the javascript adapter", () => {
  test("refuses each comment, naming its line and first line", () => {
    const text = "const a = 1; // why\n/* a\n   block */\nconst b = <T,>(x: T) => x;\n/** doc */\n";
    expect(comments("a.ts", text)).toEqual(
      read([
        { line: 1, text: "// why" },
        { line: 2, text: "/* a\n   block */" },
        { line: 5, text: "/** doc */" },
      ]),
    );
    expect(comments("a.tsx", "const a = <div>{/* note */}</div>;\n")).toEqual(
      read([{ line: 1, text: "/* note */" }]),
    );
  });

  test("counts lines by newline alone, as git does", () => {
    expect(comments("a.ts", 'const s = "\u2028\u2029";\rconst t = 1;\n// why\n')).toEqual(
      read([{ line: 2, text: "// why" }]),
    );
    expect(comments("a.ts", 'const s = "\u2028";\rconst = ;\n')).toMatchObject({ kind: "unparsed", line: 1 });
  });

  test("keeps the comments a tool reads, with a reason on the same line", () => {
    const kept = [
      '/// <reference types="bun" />',
      "// @ts-expect-error",
      "// @ts-expect-error: the fixture is malformed on purpose",
      "/* @ts-expect-error */",
      "// eslint-disable-next-line no-console",
      "// eslint-disable-line no-console, no-alert -- prints the banner",
      "/* eslint-disable-next-line no-console */",
      "/* eslint-disable no-console */",
      "/* eslint-enable no-console */",
      "// biome-ignore lint/style/useConst: x",
      "// biome-ignore lint/correctness/noUnusedVariables(foo): x",
      "// biome-ignore format: x",
      "// biome-ignore-all lint/suspicious/noConsole: x",
      "/* biome-ignore-start lint/suspicious/noConsole: x */",
      "// biome-ignore-end lint/suspicious/noConsole",
      "// prettier-ignore",
      "/* #__PURE__ */",
      "/* @__PURE__ */",
      "/** @vitest-environment jsdom */",
    ];
    expect(comments("a.ts", `#!/usr/bin/env node\n${kept.join("\nf();\n")}\n`)).toEqual(read([]));
  });

  test("refuses a directive that silences everything, configures a tool, or spans lines", () => {
    const refused = [
      "// @ts-ignore",
      "// @ts-nocheck",
      "// @ts-expect-errors",
      "// eslint-disable",
      "/* eslint-disable */",
      "// eslint-disable-next-line -- reason",
      "// eslint-disable no-console",
      "// eslint-enable no-console",
      "/* eslint-enable */",
      "/* eslint-env node */",
      "/* eslint no-console: off */",
      "/* global window */",
      "/*! license */",
      "// biome-ignore",
      "// biome-ignore lint: x",
      "// biome-ignore lint/style: x",
      "// biome-ignore-all lint: x",
      "// biome-ignore lint/style/useConst lint: x",
      "// biome-ignore format lint: x",
      "// prettier-ignore because",
      "/* #__PURE__ call */",
      "/** @vitest-environment */",
      "/**\n * @ts-expect-error\n */",
      "/* eslint-disable\n   no-console */",
    ];
    let line = 1;
    const listed = refused.map((text) => {
      const at = line;
      line += text.split("\n").length + 1;
      return { line: at, text };
    });
    expect(comments("a.ts", `${refused.join("\nf();\n")}\n`)).toEqual(read(listed));
  });

  test("keeps `@ts-check` and `/// <reference` only in the leading line comments TypeScript reads them from", () => {
    const leading = '// @ts-check\n/// <reference types="bun" />\n"use strict";\n';
    expect(comments("a.js", `${leading}f();\n// @ts-check\n/// <reference types="node" />\n`)).toEqual(
      read([
        { line: 5, text: "// @ts-check" },
        { line: 6, text: '/// <reference types="node" />' },
      ]),
    );
    expect(comments("a.js", "/* @ts-check */\nf();\n")).toEqual(read([{ line: 1, text: "/* @ts-check */" }]));
    expect(comments("a.ts", '// / <reference types="bun" />\nf();\n')).toEqual(
      read([{ line: 1, text: '// / <reference types="bun" />' }]),
    );
    expect(comments("a.ts", "// @ts-check\nf();\n")).toEqual(read([{ line: 1, text: "// @ts-check" }]));
  });

  test("keeps JSDoc types only where plain JavaScript needs them", () => {
    const typed =
      "/** @type {number} */\nlet a;\n/**\n * @param {string} x\n * @param {{ n: number }} [y=1]\n */\nfunction f(x, y) {}\n";
    expect(comments("a.js", typed)).toEqual(read([]));
    expect(comments("a.cjs", "/** @typedef {{ n: number }} Point */\n")).toEqual(read([]));
    expect(comments("a.jsx", `${typed}const b = <div />;\n`)).toEqual(read([]));
    for (const described of [
      "/**\n * @param {number} x the input\n */",
      "/**\n * @param {number} x\n * Adds one.\n */",
      "/** @param x */",
      "/** @type {number} the count */",
      "/** @typedef {object} Point\n * @property {number} n */",
    ])
      expect(comments("a.mjs", `${described}\nfunction f(x) {}\n`)).toEqual(
        read([{ line: 1, text: described }]),
      );
    expect(comments("a.ts", typed)).toEqual(
      read([
        { line: 1, text: "/** @type {number} */" },
        { line: 3, text: "/**\n * @param {string} x\n * @param {{ n: number }} [y=1]\n */" },
      ]),
    );
    expect(comments("bin/tool", `#!/usr/bin/env node\n${typed}const b = <div />;\n`)).toEqual(read([]));
    expect(comments("bin/tool", `#!/usr/bin/env bun\n${typed}const b: number = 1;\n`)).toEqual(
      read([
        { line: 2, text: "/** @type {number} */" },
        { line: 4, text: "/**\n * @param {string} x\n * @param {{ n: number }} [y=1]\n */" },
      ]),
    );
  });

  test("names the line and reason Babel gives for a file that does not parse", () => {
    expect(comments("a.ts", "const a = 1;\nconst = ;\n")).toEqual(unparsed(2, "Unexpected token"));
    expect(comments("a.js", "\nconst a: number = 1;\n")).toEqual(
      unparsed(2, "Missing initializer in const declaration"),
    );
    expect(comments("a.ts", "const a = 1;\nconst b = `open\n\n")).toEqual(
      unparsed(2, "Unterminated template"),
    );
  });

  test("reads either decorator dialect TypeScript accepts", () => {
    expect(comments("a.ts", "export @dec class A {\n  @dec accessor x = 1; // stage 3\n}\n")).toEqual(
      read([{ line: 2, text: "// stage 3" }]),
    );
    expect(
      comments("a.ts", "@Controller() export class A {\n  m(@Body() body: unknown) {} // legacy\n}\n"),
    ).toEqual(read([{ line: 2, text: "// legacy" }]));
    expect(comments("a.ts", "export @dec class A {\n  m(@Body() body: unknown) {}\n}\n")).toEqual(
      unparsed(2, "Decorators cannot be used to decorate parameters"),
    );
    expect(
      comments("a.ts", "@Controller() export class A {\n  m(@Body() body: unknown) {}\n}\nconst = ;\n"),
    ).toEqual(unparsed(4, "Unexpected token"));
  });
});

describe("the dart adapter", () => {
  test("refuses each comment, doc comments and nested blocks too", () => {
    const text = [
      "/// A doc comment.",
      "final url = 'https://example.com'; // trailing",
      "/* outer /* inner */ still outer */",
      `final s = "\${map['//']} // still the string";`,
      "/* a",
      "   block */",
      `final m = '\${{'a': 1}['a']}'; // after a map in an interpolation`,
      "final e = 'it\\'s // x'; // after an escaped quote",
    ].join("\n");
    expect(dartComments("a.dart", text)).toEqual(
      read([
        { line: 1, text: "/// A doc comment." },
        { line: 2, text: "// trailing" },
        { line: 3, text: "/* outer /* inner */ still outer */" },
        { line: 5, text: "/* a\n   block */" },
        { line: 7, text: "// after a map in an interpolation" },
        { line: 8, text: "// after an escaped quote" },
      ]),
    );
  });

  test("reads no comment inside a string, raw and triple-quoted alike", () => {
    const text = [
      "#!/usr/bin/env dart",
      "final a = r'// raw';",
      'final c = r"""// raw \\""";',
      "final b = '''",
      "// inside",
      "''';",
    ].join("\n");
    expect(dartComments("a.dart", text)).toEqual(read([]));
  });

  test("keeps the comments the analyzer reads", () => {
    const text = [
      "// ignore_for_file: avoid_print",
      "// ignore: unused_element",
      "/// ignore: unused_element",
      "// ignore: unused_element, dead_code",
      "// ignore:UNUSED_IMPORT",
      "// ignore: custom_lint/my_rule",
      "// ignore_for_file: avoid_print , dead_code",
      "// @dart=3.0",
      "// @dart = 3.0",
      "void f() {}",
    ].join("\n");
    expect(dartComments("a.dart", text)).toEqual(read([]));
  });

  test("refuses coverage directives, a language version that is not alone, and an ignore that names no diagnostic", () => {
    const refused = [
      "// coverage:ignore-line",
      "/// @dart = 3.0",
      "// @dart = 3.0 for the records",
      "// @dart = 3",
      "// ignore: type=lint",
      "// ignore_for_file: type=lint",
      "// ignore: because the api is weird",
      "// ignore: unused_element, kept for the plugin API",
      "// ignore:",
      "// ignore: custom_lint/",
      "// ignore: custom_lint /my_rule",
    ];
    expect(dartComments("a.dart", [...refused, "void f() {}"].join("\n"))).toEqual(
      read(refused.map((text, index) => ({ line: index + 1, text }))),
    );
  });

  test("names the line where a string, comment or interpolation that never closes opens", () => {
    expect(dartComments("a.dart", "final a = 1;\nfinal b = 'open;\nfinal c = 1;\n")).toEqual(
      unparsed(2, "Unterminated string"),
    );
    expect(dartComments("a.dart", "final a = 1;\n/* open\nmore\n")).toEqual(
      unparsed(2, "Unterminated comment"),
    );
    expect(dartComments("a.dart", "final a = 1;\nfinal b = '${c';\n")).toEqual(
      unparsed(2, "Unterminated string"),
    );
    expect(dartComments("a.dart", "final a = 1;\nfinal b = '''${c\nmore\n")).toEqual(
      unparsed(2, "Unterminated interpolation"),
    );
  });

  test("refuses unbalanced brackets, naming where one opens unclosed or closes unopened", () => {
    expect(dartComments("a.dart", "void f() {\n  g([1, (2)], {'a': 1});\n}\n")).toEqual(read([]));
    expect(dartComments("a.dart", `final s = '\${[1].map((x) => '\${x}')}';\n`)).toEqual(read([]));
    expect(dartComments("a.dart", "void f() {\n  g(1;\n}\n")).toEqual(unparsed(3, 'Unexpected "}"'));
    expect(dartComments("a.dart", "void f() {\n  g(1);\n")).toEqual(unparsed(1, "Unterminated brace"));
    expect(dartComments("a.dart", "final a = [1, 2;\n")).toEqual(unparsed(1, "Unterminated bracket"));
    expect(dartComments("a.dart", "final a = 1);\n")).toEqual(unparsed(1, 'Unexpected ")"'));
    expect(dartComments("a.dart", `final s = '\${(1}';\n`)).toEqual(unparsed(1, 'Unexpected "}"'));
  });
});

describe("the sql adapter", () => {
  test("refuses each comment, inside a function body too", () => {
    const text = [
      "-- header",
      `select '--not a comment', "col--name" from t; /* block */`,
      "create function f() returns void language plpgsql as $body$",
      "begin",
      "  -- in the body",
      "  perform 'it''s -- quoted';",
      "end $body$;",
      "/* outer /* inner */",
      "   still outer */",
      `select "a""--b" from t;`,
    ].join("\n");
    expect(sqlComments("a.sql", text)).toEqual(
      read([
        { line: 1, text: "-- header" },
        { line: 2, text: "/* block */" },
        { line: 5, text: "-- in the body" },
        { line: 8, text: "/* outer /* inner */\n   still outer */" },
      ]),
    );
  });

  test("reads a dollar quote that is not SQL as a literal, and SQL inside one as code", () => {
    expect(sqlComments("a.sql", "comment on table t is $$Don't drop$$;\n")).toEqual(read([]));
    expect(sqlComments("a.sql", "do $$ # it's python $$;\n-- after\n")).toEqual(
      read([{ line: 2, text: "-- after" }]),
    );
    const nested =
      "create function f() returns void as $a$\nbegin\n  execute $b$\n  -- inner\n  $b$;\nend $a$;\n";
    expect(sqlComments("a.sql", nested)).toEqual(read([{ line: 4, text: "-- inner" }]));
  });

  test("reads positional parameters and identifiers as code, not dollar quotes", () => {
    expect(sqlComments("a.sql", "select $1, $2 -- trailing")).toEqual(
      read([{ line: 1, text: "-- trailing" }]),
    );
    expect(sqlComments("a.sql", "select a$b$c from t;")).toEqual(read([]));
  });

  test("keeps drizzle's statement breakpoint, and only that exact comment", () => {
    const text = "create table a (id int);\n--> statement-breakpoint\ncreate table b (id int);\n";
    expect(sqlComments("a.sql", text)).toEqual(read([]));
    expect(sqlComments("a.sql", "--> statement-breakpoint and why\n-- statement-breakpoint\n")).toEqual(
      read([
        { line: 1, text: "--> statement-breakpoint and why" },
        { line: 2, text: "-- statement-breakpoint" },
      ]),
    );
  });

  test("reads letters beyond ASCII in identifiers and dollar quote tags as Postgres does", () => {
    expect(sqlComments("a.sql", "select $ä$Don't$ä$; -- c")).toEqual(read([{ line: 1, text: "-- c" }]));
    expect(sqlComments("a.sql", "select ä$b$ from t; -- c")).toEqual(read([{ line: 1, text: "-- c" }]));
  });

  test("lets a backslash escape the quote only in an escape string", () => {
    expect(sqlComments("a.sql", "select E'a\\'-- still quoted';")).toEqual(read([]));
    expect(sqlComments("a.sql", "select 'a\\' -- a comment")).toEqual(
      read([{ line: 1, text: "-- a comment" }]),
    );
    expect(sqlComments("a.sql", "select fE'a\\' -- a comment")).toEqual(
      read([{ line: 1, text: "-- a comment" }]),
    );
  });

  test("names the line where a quote, comment or dollar quote that never closes opens", () => {
    expect(sqlComments("a.sql", "select 1;\nselect 'open;\nmore\n")).toEqual(
      unparsed(2, "Unterminated quote"),
    );
    expect(sqlComments("a.sql", "select 1;\n/* open\nmore\n")).toEqual(unparsed(2, "Unterminated comment"));
    expect(sqlComments("a.sql", "select 1;\nselect $$ open;\nmore\n")).toEqual(
      unparsed(2, "Unterminated dollar quote"),
    );
    expect(sqlComments("a.sql", "select $a$\n$b$ $a$\n$b$;\n")).toEqual(
      unparsed(3, "Unterminated dollar quote"),
    );
  });

  test("refuses unbalanced brackets and a $ that starts no dollar quote or parameter", () => {
    expect(sqlComments("a.sql", "select (a[1]) from t where b in ('(', ']');\n")).toEqual(read([]));
    expect(sqlComments("a.sql", "select 1;\nselect count(*;\n")).toEqual(
      unparsed(2, "Unterminated parenthesis"),
    );
    expect(sqlComments("a.sql", "select a[1;\n")).toEqual(unparsed(1, "Unterminated bracket"));
    expect(sqlComments("a.sql", "select 1);\n")).toEqual(unparsed(1, 'Unexpected ")"'));
    expect(sqlComments("a.sql", "select (a];\n")).toEqual(unparsed(1, 'Unexpected "]"'));
    expect(sqlComments("a.sql", "select 1;\nselect $ from t;\n")).toEqual(unparsed(2, 'Unexpected "$"'));
    expect(sqlComments("a.sql", "do $$ print(( $$;\n-- after\n")).toEqual(
      read([{ line: 2, text: "-- after" }]),
    );
  });
});

describe("the shell adapter", () => {
  test("refuses each comment, and no hash in a string, heredoc or expansion", () => {
    const text = [
      "#!/usr/bin/env bash",
      "# header",
      "echo \"a # b\" 'c # d' a#b $# # trailing",
      "cat <<EOF",
      "# heredoc text",
      "EOF",
      `n=\${#list[@]}`,
      "if true; then",
      "  :",
      "  # last in its block",
      "fi",
      "# last in the file",
    ].join("\n");
    expect(shellComments("a.sh", text)).toEqual(
      read([
        { line: 2, text: "# header" },
        { line: 3, text: "# trailing" },
        { line: 10, text: "# last in its block" },
        { line: 12, text: "# last in the file" },
      ]),
    );
  });

  test("keeps the shebang and shellcheck's directives that are not suppressions, and only those", () => {
    const text = [
      "#!/bin/sh",
      "# shellcheck shell=bash",
      "x=1",
      "  # shellcheck source=lib.sh source-path=SCRIPTDIR external-sources=true # sourced at runtime",
      "# shellcheck enable=require-variable-braces",
      "# shellcheck disable=SC2034",
      "# shellcheck source=lib.sh disable=SC1090",
      "#!/bin/sh",
      "",
    ].join("\n");
    expect(shellComments("a.sh", text)).toEqual(
      read([
        { line: 6, text: "# shellcheck disable=SC2034" },
        { line: 7, text: "# shellcheck source=lib.sh disable=SC1090" },
        { line: 8, text: "#!/bin/sh" },
      ]),
    );
    expect(shellComments("a.sh", "# shellchecked by hand\n")).toEqual(
      read([{ line: 1, text: "# shellchecked by hand" }]),
    );
  });

  test("starts a comment only where a word starts", () => {
    const lines = [
      "a=1 #c",
      "echo a;#c",
      "echo a&#c",
      "echo a|#c",
      "a=( #c",
      ")",
      "f() #c",
      "{ :; }",
      "a#b c\\#d",
    ];
    expect(shellComments("a.sh", lines.join("\n"))).toEqual(
      read([
        { line: 1, text: "#c" },
        { line: 2, text: "#c" },
        { line: 3, text: "#c" },
        { line: 4, text: "#c" },
        { line: 5, text: "#c" },
        { line: 7, text: "#c" },
      ]),
    );
    expect(shellComments("a.sh", "echo a\\\n# not a comment\necho b \\\n# a comment\n")).toEqual(
      read([{ line: 4, text: "# a comment" }]),
    );
  });

  test("reads no comment in a parameter, an arithmetic expansion or a regex", () => {
    const lines = [
      `echo $# \${#x} \${x#p} \${x##p} \${x/#a/b} $$#`,
      "echo $((1 << 2)) $[1+2] $'a\\'#b' $\"#\"",
      "(( x << 1 ))",
      "[[ $x =~ #a ]]",
      `echo \${x:-$(echo #c`,
      ")}",
    ];
    expect(shellComments("a.sh", lines.join("\n"))).toEqual(read([{ line: 5, text: "#c" }]));
  });

  test("reads comments inside command and process substitutions, a case in one too", () => {
    const lines = [
      "x=$( (case a in b) echo;; (c) :;; esac) ) #1",
      'echo "$(echo "# x" #2',
      ')" <(echo #3',
      ")#3b",
      "echo `echo a #4`",
      'echo `echo "\\`echo #5\\`"` #6',
      'y=`sed -e "s,\\"\\\\"(,," #7`',
    ];
    expect(shellComments("a.sh", lines.join("\n"))).toEqual(
      read([
        { line: 1, text: "#1" },
        { line: 2, text: "#2" },
        { line: 3, text: "#3" },
        { line: 5, text: "#4" },
        { line: 6, text: "#5" },
        { line: 6, text: "#6" },
        { line: 7, text: "#7" },
      ]),
    );
  });

  test("reads a =~ regex as one word, its parenthesised groups and alternatives included", () => {
    const regex = "[[ $l =~ ^[[:space:]]*(#|$) ]]";
    expect(shellComments("a.sh", `${regex}\n`)).toEqual(read([]));
    expect(shellComments("a.sh", `x=$(${regex} && echo y)\n`)).toEqual(read([]));
    expect(shellComments("a.sh", "[[ $l =~ ^( #a)$ ]] #c\n")).toEqual(read([{ line: 1, text: "#c" }]));
  });

  test("reads an extended glob as one word, its alternatives and nested groups included", () => {
    expect(shellComments("a.sh", "ls @(a|#b)\n")).toEqual(read([]));
    expect(shellComments("a.sh", "ls !(x|#y) ?(a) *(b) +(c|@(d|#e)) # real\n")).toEqual(
      read([{ line: 1, text: "# real" }]),
    );
    expect(shellComments("a.sh", "ls @('#a'|\"#b\"|$(echo #c\n))\n")).toEqual(
      read([{ line: 1, text: "#c" }]),
    );
    expect(shellComments("a.sh", "case $x in\n  @(a|#b)) echo ;;\nesac\n")).toEqual(read([]));
    expect(shellComments("a.sh", "a+=(x) # c\necho $@(y) # d\n")).toEqual(
      read([
        { line: 1, text: "# c" },
        { line: 2, text: "# d" },
      ]),
    );
  });

  test("closes a substitution at its own parenthesis, not at a case pattern's", () => {
    expect(shellComments("a.sh", 'x="$(case a in b) echo " #c";; esac)"\n')).toEqual(read([]));
    expect(shellComments("a.sh", 'x="$(case a in b) echo esac;; c) echo " #c";; esac)"\n')).toEqual(read([]));
  });

  test("reads (( as arithmetic where a command starts, and after for", () => {
    expect(shellComments("a.sh", "if (( x << 1 )); then :; fi\n")).toEqual(read([]));
    expect(shellComments("a.sh", "for ((i = 0; i << 2; i++)); do :; done\n")).toEqual(read([]));
    expect(shellComments("a.sh", "echo $[1 << 2]\n")).toEqual(read([]));
  });

  test("unescapes a backtick's quotes inside double quotes before reading it", () => {
    expect(shellComments("a.sh", 'echo "`echo \\"a #b\\"`"\n')).toEqual(read([]));
    expect(shellComments("a.sh", 'echo "`echo \\"#\\" #x`"\n')).toEqual(read([{ line: 1, text: "#x" }]));
  });

  test("reads heredoc bodies as text, and the substitutions in an unquoted one as code", () => {
    const lines = [
      "cat <<EOF; cat <<-'E2' # c",
      "# body",
      "$(echo #in",
      ")",
      "EOF",
      "\t# body",
      "\t$(echo #x",
      "\tE2",
      "cat <<\\E3; cat <<< x #here",
      "$(echo #literal)",
      "E3",
      "# after",
    ];
    expect(shellComments("a.sh", lines.join("\n"))).toEqual(
      read([
        { line: 1, text: "# c" },
        { line: 3, text: "#in" },
        { line: 9, text: "#here" },
        { line: 12, text: "# after" },
      ]),
    );
  });

  test("names the line where a quote, substitution or heredoc that never closes opens", () => {
    for (const [open, reason] of [
      ["echo 'a\nb\n", "Unterminated quote"],
      ['echo "a\nb\n', "Unterminated quote"],
      ["echo $'a\nb\n", "Unterminated quote"],
      ["echo $(a\nb\n", "Unterminated substitution"],
      ["echo ${a\nb\n", "Unterminated parameter expansion"],
      ["echo `a\nb\n", "Unterminated backquote"],
      ["echo `echo $(a`\nb\n", "Unterminated substitution"],
      ["echo $[1\nb\n", "Unterminated arithmetic expansion"],
      ["ls @(a\nb\n", "Unterminated extended glob"],
      ["cat <<EOF\nbody\n", "Unterminated heredoc"],
      ["cat <<EOF\nbody\n EOF\n", "Unterminated heredoc"],
    ] as const)
      expect([open, shellComments("a.sh", `x=1\n${open}`)]).toEqual([open, unparsed(2, reason)]);
    expect(shellComments("a.sh", "if true; then\n  echo # open\n")).toEqual(
      read([{ line: 2, text: "# open" }]),
    );
  });
});

describe("the rust adapter", () => {
  test("refuses each comment, doc comments and nested blocks too", () => {
    const text = [
      "//! Crate docs.",
      "/// Item docs.",
      "fn f() {} // trailing",
      "/* outer /* inner */ still outer */",
      "/** block docs */",
      "/*! inner block docs */",
      "/* a",
      "   block */",
      "//// four slashes",
    ].join("\n");
    expect(rustComments("a.rs", text)).toEqual(
      read([
        { line: 1, text: "//! Crate docs." },
        { line: 2, text: "/// Item docs." },
        { line: 3, text: "// trailing" },
        { line: 4, text: "/* outer /* inner */ still outer */" },
        { line: 5, text: "/** block docs */" },
        { line: 6, text: "/*! inner block docs */" },
        { line: 7, text: "/* a\n   block */" },
        { line: 9, text: "//// four slashes" },
      ]),
    );
  });

  test("reads no comment inside a literal, and finds the one after it", () => {
    const lines = [
      'let a = "http://x /* y */"; // 1',
      'let b = "a\\" // still the string"; // 2',
      'let c = r##"a "# // still raw"##; // 3',
      'let d = b"// bytes"; let e = br#"// raw bytes"#; // 4',
      'let f = c"// c string"; let g = cr#"/* raw c */"#; // 5',
      "let h = ['\"', '\\'', '/', '\\u{1F600}', '\\x41', '😀']; // 6",
      "let i = b'\"'; let j = b'\\''; // 7",
      "fn k<'a>(x: &'a str) -> &'static str { x } // 8",
      "'outer: loop { break 'outer; } // 9",
      "let r#type = r#match; fn l<'r#fn>() {} // 10",
      'let m = "line one',
      "// still the string",
      '"; // 13',
      'let n = "suffixed"usize; let o = x"y" ; // 14',
      'let 😀r"\\" = 1; // in the string rustc reads after an emoji identifier"',
      `let 😀${String.fromCodePoint(0x200d)}r"\\" = 1; // still the string past a zero-width joiner"`,
    ];
    expect(rustComments("a.rs", lines.join("\n"))).toEqual(
      read([
        { line: 1, text: "// 1" },
        { line: 2, text: "// 2" },
        { line: 3, text: "// 3" },
        { line: 4, text: "// 4" },
        { line: 5, text: "// 5" },
        { line: 6, text: "// 6" },
        { line: 7, text: "// 7" },
        { line: 8, text: "// 8" },
        { line: 9, text: "// 9" },
        { line: 10, text: "// 10" },
        { line: 13, text: "// 13" },
        { line: 14, text: "// 14" },
      ]),
    );
  });

  test("refuses a doc attribute that carries doc text, and keeps every other attribute", () => {
    const lines = [
      '#![doc = "Crate docs."]',
      '#[doc = include_str!("../README.md")]',
      "#[doc(hidden)]",
      '#[doc(alias = "x")]',
      "#[doc(inline)]",
      "#[derive(Debug)]",
      "#[cfg_attr(test, derive(Clone))]",
      '# [ doc = "spaced" ]',
      '#[doc = "a ] in a string"] fn f() {}',
      "#[doc = concat!(",
      '    "spans [lines]",',
      ")]",
      'let doc = "#[doc = x]";',
    ];
    expect(rustComments("a.rs", lines.join("\n"))).toEqual(
      read([
        { line: 1, text: '#![doc = "Crate docs."]' },
        { line: 2, text: '#[doc = include_str!("../README.md")]' },
        { line: 8, text: '# [ doc = "spaced" ]' },
        { line: 9, text: '#[doc = "a ] in a string"]' },
        { line: 10, text: '#[doc = concat!(\n    "spans [lines]",\n)]' },
      ]),
    );
  });

  test("refuses doc text anywhere in an attribute, and only there", () => {
    const lines = [
      '#[cfg_attr(docsrs, doc = "text")]',
      '#![cfg_attr(feature = "x", doc = include_str!("x.md"))]',
      "#[cfg(doc)]",
      '#[cfg_attr(docsrs, doc(cfg(feature = "x")))]',
      "#[cfg_attr(test, assert(doc == 1))]",
      "#[cases(doc => 1)]",
      "let doc = 1;",
      "fn f(doc: u8) { if doc == 1 {} }",
    ];
    expect(rustComments("a.rs", lines.join("\n"))).toEqual(
      read([
        { line: 1, text: '#[cfg_attr(docsrs, doc = "text")]' },
        { line: 2, text: '#![cfg_attr(feature = "x", doc = include_str!("x.md"))]' },
      ]),
    );
  });

  test("refuses a doc attribute once, with the comments inside it", () => {
    expect(rustComments("a.rs", '#[doc = "x" /* y */]\n')).toEqual(
      read([{ line: 1, text: '#[doc = "x" /* y */]' }]),
    );
    expect(rustComments("a.rs", '#[doc = concat!(\n  // n\n  "x")]\n')).toEqual(
      read([{ line: 1, text: '#[doc = concat!(\n  // n\n  "x")]' }]),
    );
    expect(rustComments("a.rs", "#[derive(Debug /* y */)]\n")).toEqual(read([{ line: 1, text: "/* y */" }]));
    expect(rustComments("a.rs", '#[doc /* y */ = "x"]\n')).toEqual(
      read([{ line: 1, text: '#[doc /* y */ = "x"]' }]),
    );
    expect(rustComments("a.rs", '# /* y */ [doc = "x"]\n')).toEqual(
      read([{ line: 1, text: '# /* y */ [doc = "x"]' }]),
    );
    expect(rustComments("a.rs", "# /* y */ [derive(Debug)]\n")).toEqual(read([{ line: 1, text: "/* y */" }]));
    expect(rustComments("a.rs", '#[x(#[doc = "y"] /* z */)]\n')).toEqual(
      read([{ line: 1, text: '#[x(#[doc = "y"] /* z */)]' }]),
    );
  });

  test("refuses the doc attribute a macro forwards", () => {
    const text = "macro_rules! m {\n    ($(#[doc = $doc:expr])*) => {};\n}\n";
    expect(rustComments("a.rs", text)).toEqual(read([{ line: 2, text: "#[doc = $doc:expr]" }]));
  });

  test("skips a first-line shebang, and reads #![ there as an inner attribute", () => {
    expect(rustComments("a.rs", "#!/usr/bin/env run-cargo-script // x\nfn main() {}\n")).toEqual(read([]));
    expect(rustComments("a.rs", '#! [doc = "x"]\n')).toEqual(read([{ line: 1, text: '#! [doc = "x"]' }]));
    expect(rustComments("a.rs", "#![allow(dead_code)] // x\n")).toEqual(read([{ line: 1, text: "// x" }]));
    expect(rustComments("a.rs", "fn main() {}\n#!/bin/sh // x\n")).toEqual(read([{ line: 2, text: "// x" }]));
    expect(rustComments("a.rs", "#! /* a */ // b\n[allow(dead_code)]\n")).toEqual(
      read([
        { line: 1, text: "/* a */" },
        { line: 1, text: "// b" },
      ]),
    );
    expect(rustComments("a.rs", "#! /// doc\n[allow(dead_code)]\n")).toEqual(read([]));
  });

  test("names the line where a literal or comment that never closes opens", () => {
    for (const [open, reason] of [
      ['let a = "open;\nb\n', "Unterminated string"],
      ['let a = r#"open"";\nb\n', "Unterminated raw string"],
      ['let a = br"open;\nb\n', "Unterminated raw string"],
      ['let a = c"open;\nb\n', "Unterminated string"],
      ["let a = ' ;\nb\n", "Unterminated character"],
      ["let a = '\\u{1F600};\nb\n", "Unterminated character"],
      ["let a = b'x;\nb\n", "Unterminated character"],
      ["let a = r#;\nb\n", "Unterminated raw string"],
      ["/* open /* nested */\nb\n", "Unterminated comment"],
    ] as const)
      expect([open, rustComments("a.rs", `fn f() {}\n${open}`)]).toEqual([open, unparsed(2, reason)]);
  });

  test("keeps in library code the outer docs of a pub item, an exported macro, and a pub enum's or trait's members", () => {
    const lines = [
      "/// Public.",
      "pub fn a() {}",
      "/// Restricted.",
      "pub(crate) fn b() {}",
      "/// Private.",
      "fn c() {}",
      "/// Exported.",
      "#[macro_export]",
      "macro_rules! m { () => {} }",
      "#[derive(Debug)]",
      "/** Enum. */",
      "#[non_exhaustive]",
      "pub enum E {",
      "    /// Variant.",
      "    A { x: u8 },",
      "    /// Next variant.",
      "    B,",
      "}",
      "pub unsafe trait T<const N: usize = { [0u8; 1].len() }> {",
      "    /// Trait item.",
      "    fn f();",
      "}",
      "pub struct S {",
      "    /// Field.",
      "    pub x: u8,",
      "    /// Private field.",
      "    y: u8,",
      "}",
      '#[doc = "Attribute."]',
      "pub const C: u8 = 1;",
      "enum Private {",
      "    /// Private variant.",
      "    A,",
      "}",
      "pub fn g() {",
      "    /// In a body.",
      "    let x = 1;",
      "}",
      "pub trait U<const N: usize = { let x = 1; x }>: Into<[u8; { 1 }]> + Foo<{ 2 }, { 3 }> {",
      "    /// After blocks in the header.",
      "    fn k();",
      "}",
      "/// Raw.",
      "r#pub fn h() {}",
      "/// Last.",
    ];
    const text = lines.join("\n");
    const library = trackedIn(["Cargo.toml", "src/lib.rs"]);
    expect(ADAPTERS.rust.comments("src/a.rs", text, library)).toEqual(
      read([
        { line: 3, text: "/// Restricted." },
        { line: 5, text: "/// Private." },
        { line: 26, text: "/// Private field." },
        { line: 32, text: "/// Private variant." },
        { line: 36, text: "/// In a body." },
        { line: 43, text: "/// Raw." },
        { line: 45, text: "/// Last." },
      ]),
    );
  });

  test("keeps public docs only under a library crate's src, and inner docs only in its src/lib.rs", () => {
    const text = '//! Crate.\n#![doc = "Crate."]\n/*! Crate. */\n/// Public.\npub fn a() {}\n';
    const inner = [
      { line: 1, text: "//! Crate." },
      { line: 2, text: '#![doc = "Crate."]' },
      { line: 3, text: "/*! Crate. */" },
    ];
    const all = [...inner, { line: 4, text: "/// Public." }];
    const library = ["Cargo.toml", "src/lib.rs"];
    for (const [path, tracked, refused] of [
      ["src/lib.rs", library, []],
      ["src/a/b.rs", library, inner],
      ["src/main.rs", library, all],
      ["src/bin/tool.rs", library, all],
      ["examples/a.rs", library, all],
      ["tests/a.rs", library, all],
      ["src/lib.rs", ["Cargo.toml"], all],
      ["src/lib.rs", ["src/lib.rs"], all],
      ["crates/x/src/lib.rs", ["Cargo.toml", "crates/x/Cargo.toml", "crates/x/src/lib.rs"], []],
      ["tools/x/src/lib.rs", [...library, "tools/x/Cargo.toml"], all],
    ] as const)
      expect([path, tracked, ADAPTERS.rust.comments(path, text, trackedIn(tracked))]).toEqual([
        path,
        tracked,
        read(refused),
      ]);
  });
});

describe("the go adapter", () => {
  test("refuses each comment, and reads no comment inside a string, raw string or rune", () => {
    const lines = [
      "\uFEFFpackage main",
      "",
      'var a = "// not a comment" // trailing',
      "var b = `raw /* not a comment",
      "// still raw` /* block */",
      "var c = '/' + '\\'' // after runes",
      "/* a",
      "   block */",
      "/* blocks /* do not nest */ var d = 1",
    ];
    expect(goComments("main.go", lines.join("\n"))).toEqual(
      read([
        { line: 3, text: "// trailing" },
        { line: 5, text: "/* block */" },
        { line: 6, text: "// after runes" },
        { line: 7, text: "/* a\n   block */" },
        { line: 9, text: "/* blocks /* do not nest */" },
      ]),
    );
  });

  test("names the line where a literal or comment that never closes opens", () => {
    for (const [open, reason] of [
      ['var a = "open\nb\n', "Unterminated string"],
      ['var a = "open\\\nb\n', "Unterminated string"],
      ["var a = `open\nb\n", "Unterminated raw string"],
      ["var a = '\nb\n", "Unterminated rune"],
      ["/* open\nb\n", "Unterminated comment"],
    ] as const)
      expect([open, goComments("a.go", `package a\n${open}`)]).toEqual([open, unparsed(2, reason)]);
  });

  test("keeps in library code the docs and trailing comments go doc shows on exported names", () => {
    const lines = [
      "// Package a is kept.",
      "package a",
      "",
      "// T is kept.",
      "type T struct {",
      "\t// A is kept.",
      "\tA int // kept",
      "\tE int; // kept after an explicit semicolon",
      "\t// b is refused.",
      "\tb int // refused",
      "\t// Reader is kept.",
      "\tio.Reader",
      "\t*inner // refused",
      "\tN struct {",
      "\t\tX int // kept",
      "\t\ty int // refused",
      "\t}",
      "\tM map[struct {",
      "\t\tK int // kept",
      "\t\tk int // refused",
      "\t}]struct {",
      "\t\tV int // kept",
      "\t\tv int // refused",
      "\t}",
      "\tC chan struct {",
      "\t\tE int // kept",
      "\t\te int // refused",
      "\t}",
      "}",
      "",
      "// t is refused.",
      "type t struct{ X int }",
      "",
      "type I interface {",
      "\t// M is kept.",
      "\tM() // kept",
      "\tm() // refused",
      "\terror // kept",
      "\tinner // refused",
      "\t~int | ~string // kept",
      "}",
      "",
      "// F is kept.",
      "func F() {} // refused",
      "",
      "// M is kept.",
      "func (r *T) M() {}",
      "",
      "// N is refused.",
      "func (t) N() {}",
      "",
      "// Group is kept.",
      "const (",
      "\t// B is kept.",
      "\tB = iota // kept",
      "\tc // refused",
      ")",
      "",
      "var v, W = 1, 2 // kept",
      "",
      "// f is refused.",
      "func f() {",
      "\t// refused",
      "}",
      "",
      "// D is kept,",
      "//nolint:all",
      "//lint:ignore SA1019",
      "// nolint",
      "// but not the directives above it.",
      "func D() {}",
    ];
    const kept = (line: string) => /is kept|\/\/ kept|but not/.test(line);
    const refused = lines.flatMap((line, index) => {
      const at = line.indexOf("//");
      return at < 0 || kept(line) ? [] : [{ line: index + 1, text: line.slice(at) }];
    });
    expect(goComments("a.go", lines.join("\n"))).toEqual(read(refused));
  });

  test("keeps a trailing block comment that spans lines, and a package doc after a byte order mark", () => {
    const text =
      "\uFEFF// Package a.\npackage a\n\ntype T struct {\n\tA int /* kept\n\t   across lines */\n\t// b is refused.\n\tb int\n\tC int /* kept\n\t*/ d int // refused\n}\n";
    expect(goComments("a.go", text)).toEqual(
      read([
        { line: 7, text: "// b is refused." },
        { line: 10, text: "// refused" },
      ]),
    );
  });

  test("keeps exported docs only outside package main and outside test files", () => {
    const text = "// Package a.\npackage a\n\n// F is exported.\nfunc F() {}\n";
    const all = [
      { line: 1, text: "// Package a." },
      { line: 4, text: "// F is exported." },
    ];
    for (const [path, body, refused] of [
      ["a.go", text, []],
      ["cmd/a/main.go", text.replace("package a", "package main"), all],
      ["a_test.go", text, all],
      ["a_test.go", text.replace("package a", "package a_test"), all],
    ] as const)
      expect([path, goComments(path, body)]).toEqual([path, read(refused)]);
  });

  test("keeps cgo's preamble, and exports on top-level funcs, only in a file that imports C", () => {
    const lines = [
      "package main",
      "",
      "// #include <stdio.h>",
      "// // a C comment is refused",
      'import "C"',
      "",
      "//export F",
      "func F() {}",
      "",
      "//export G",
      "func H() {}",
      "",
      "//export M",
      "func (T) M() {}",
      "",
      "/*",
      "#include <stdlib.h>",
      "// refused with its whole block",
      "*/",
      'import "C"',
    ];
    expect(goComments("main.go", lines.join("\n"))).toEqual(
      read([
        { line: 4, text: "// // a C comment is refused" },
        { line: 10, text: "//export G" },
        { line: 13, text: "//export M" },
        { line: 16, text: "/*\n#include <stdlib.h>\n// refused with its whole block\n*/" },
      ]),
    );
    expect(
      goComments(
        "main.go",
        'package main\n\n// #include <stdio.h>\nimport "fmt"\n\n//export F\nfunc F() {}\n',
      ),
    ).toEqual(
      read([
        { line: 3, text: "// #include <stdio.h>" },
        { line: 6, text: "//export F" },
      ]),
    );
  });

  test("keeps go:embed only at column 1 above a var", () => {
    const text =
      "package a\n\n//go:embed a.txt\nvar a string\n\nvar (\n\t//go:embed b.txt\n\tb string\n)\n\n//go:embed c.txt\nconst c = 1\n";
    expect(goComments("a.go", text)).toEqual(
      read([
        { line: 7, text: "//go:embed b.txt" },
        { line: 11, text: "//go:embed c.txt" },
      ]),
    );
  });

  test("keeps an Example's doc and its closing output in a test file outside package main", () => {
    const lines = [
      "package a_test",
      "",
      "// ExampleF is kept.",
      "func ExampleF() {",
      "\t// refused",
      "\tfmt.Println(1)",
      "\t// Output: 1",
      "}",
      "",
      "// Examplef is refused.",
      "func Examplef() {",
      "\t// Output: refused",
      "}",
      "",
      "// Example_params is refused.",
      "func Example_params(t int) {",
      "\t// Output: refused",
      "}",
      "",
      "func Example_suffix() {",
      "\t// Unordered output: kept",
      "\t// 2",
      "}",
      "",
      "func Example_last() {",
      "\t// Output: refused, not the last group",
      "",
      "\tfmt.Println(1)",
      "\t// refused",
      "}",
    ];
    const kept = (line: string) => /is kept|Output: 1|output: kept|\/\/ 2/.test(line);
    const refused = lines.flatMap((line, index) => {
      const at = line.indexOf("//");
      return at < 0 || kept(line) ? [] : [{ line: index + 1, text: line.slice(at) }];
    });
    expect(goComments("a_test.go", lines.join("\n"))).toEqual(read(refused));
    const main = lines.join("\n").replace("package a_test", "package main");
    expect(goComments("a_test.go", main)).toEqual(
      read(
        main.split("\n").flatMap((line, index) => {
          const at = line.indexOf("//");
          return at < 0 ? [] : [{ line: index + 1, text: line.slice(at) }];
        }),
      ),
    );
  });

  test("keeps want comments only in a file under testdata", () => {
    const text = 'package a\n\nvar x = 1 // want "x"\n';
    expect(goComments("testdata/src/a/a.go", text)).toEqual(read([]));
    expect(goComments("a/testdatum/a.go", text)).toEqual(read([{ line: 3, text: '// want "x"' }]));
  });
});

describe("the README", () => {
  test("lists the forms each adapter keeps, and those every language keeps", () => {
    const cell = (forms: readonly string[]) => (forms.length === 0 ? "none" : forms.join("; "));
    const readme = readFileSync(join(import.meta.dir, "../README.md"), "utf8");
    const own = (language: Language) => {
      const { kept } = ADAPTERS[language];
      expect(kept.slice(kept.length - SHARED_SHOWN.length)).toEqual([...SHARED_SHOWN]);
      return kept.slice(0, kept.length - SHARED_SHOWN.length);
    };
    const rows = [
      ...LANGUAGE_NAMES.map((language) => `| ${LANGUAGES[language].shown} | ${cell(own(language))} |`),
      `| Every language | ${cell(SHARED_SHOWN)} |`,
    ];
    expect(readme).toContain(["| Language | Kept comments |", "| --- | --- |", ...rows].join("\n"));
  });
});

describe("the bundles", () => {
  test("leave the language table out of every adapter, so a new language changes only the scanner", async () => {
    for (const [source, text] of Object.entries(await bundled()))
      expect([source, text.includes("interpreters")]).toEqual([source, source === "no-comments/scan.cjs"]);
  });

  test("put each adapter beside the scanner, where the scanner loads it", () => {
    for (const language of LANGUAGE_NAMES)
      expect(ADAPTER_FILES[language].target).toBe(`.githooks/no-comments/${language}.cjs`);
    expect(SCANNER_FILE.target).toBe(".githooks/no-comments/scan.cjs");
  });

  test("are the committed gate files, rebuilt from src", async () => {
    const built = await bundled();
    expect(Object.keys(built)).toEqual([
      "no-comments/scan.cjs",
      ...LANGUAGE_NAMES.map((language) => `no-comments/${language}.cjs`),
    ]);
    for (const [source, text] of Object.entries(built)) {
      expect([source, readFileSync(join(SOURCE_DIR, source), "utf8") === text]).toEqual([source, true]);
    }
  });
});

describe("the pre-commit hook", () => {
  test("refuses each comment the commit stages, and lets a clean commit through", () => {
    const dir = gated({ "src/a.ts": "export const a = 1;\n" });
    expect(commit(dir)).toEqual({ status: 0, stderr: "" });
    writeFiles(dir, {
      "src/a.ts": "export const a = 1; // why\n",
      "src/b.js": "/* b\n   more */\nexport {};\n",
    });
    expect(commit(dir)).toEqual({
      status: 1,
      stderr: refusalText(["src/a.ts", "  1  // why", "src/b.js", "  1  /* b"]),
    });
    expect(git(dir, ["rev-list", "--count", "HEAD"])).toBe("1");
  });

  test("refuses only the comments a change adds, an edited one among them", () => {
    const dir = repo({ "a.ts": "// old\nexport const a = 1;\n" });
    expect(commit(dir).status).toBe(0);
    installGates(dir, ["no-comments-javascript"]);
    expect(commit(dir).status).toBe(0);
    writeFiles(dir, { "a.ts": "// old\nexport const a = 2;\n" });
    expect(commit(dir)).toEqual({ status: 0, stderr: "" });
    writeFiles(dir, { "a.ts": "// old\nexport const a = 3; // new\n" });
    expect(commit(dir).stderr).toBe(refusalText(["a.ts", "  2  // new"]));
    writeFiles(dir, { "a.ts": "// older\nexport const a = 3;\n" });
    expect(commit(dir).stderr).toBe(refusalText(["a.ts", "  1  // older"]));
  });

  test("keeps a comment the change moves, renamed, reindented or into another file", () => {
    const body = "export const a = 1;\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;\n";
    const dir = gated({ "a.ts": `/* kept\n   block */\nexport function f() {}\n${body}// moved\n` });
    commitPastHooks(dir, "feat: start");
    git(dir, ["mv", "a.ts", "renamed.ts"]);
    writeFiles(dir, {
      "renamed.ts": `export function f() {\n  /* kept\n     block */\n}\n${body}`,
      "b.ts": "// moved\nexport {};\n",
    });
    expect(commit(dir)).toEqual({ status: 0, stderr: "" });
  });

  test("refuses a comment the change duplicates, or a block it joins", () => {
    const dir = gated({ "a.ts": "// twice\n/* one\n   two */\nexport {};\n" });
    commitPastHooks(dir, "feat: start");
    writeFiles(dir, { "a.ts": "// twice\n// twice\n/* one two */\nexport {};\n" });
    expect(commit(dir).stderr).toBe(refusalText(["a.ts", "  2  // twice", "  3  /* one two */"]));
  });

  test("refuses the copy or the new duplicate, never the comment its source keeps", () => {
    const body = "export const a = 1;\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;\n";
    const dir = gated({ "z.ts": `// kept\n${body}` });
    commitPastHooks(dir, "feat: start");
    writeFiles(dir, { "z.ts": `// kept\n${body}export const e = 5;\n`, "a-copy.ts": `// kept\n${body}` });
    expect(commit(dir).stderr).toBe(refusalText(["a-copy.ts", "  1  // kept"]));
    rmSync(join(dir, "a-copy.ts"));
    writeFiles(dir, { "a.ts": "// kept\nexport {};\n" });
    expect(commit(dir).stderr).toBe(refusalText(["a.ts", "  1  // kept"]));
  });

  test("skips a binary file the change renames or copies", () => {
    const dir = gated({ "data.js": "\0// binary\nexport {};\n".repeat(20) });
    commitPastHooks(dir, "feat: start");
    git(dir, ["mv", "data.js", "moved.js"]);
    writeFiles(dir, {
      "moved.js": `${"\0// binary\nexport {};\n".repeat(20)}// more\n`,
      "copy.js": "\0// binary\nexport {};\n".repeat(20),
    });
    expect(commit(dir)).toEqual({ status: 0, stderr: "" });
  });

  test("judges every comment of a file whose base does not parse, and refuses one that still does not", () => {
    const dir = gated({ "a.ts": "// old\nconst = ;\n" });
    commitPastHooks(dir, "feat: start");
    writeFiles(dir, { "a.ts": "// old\nconst a = 1;\n" });
    expect(commit(dir).stderr).toBe(refusalText(["a.ts", "  1  // old"]));
    writeFiles(dir, { "a.ts": "// old\nconst = 1;\n" });
    expect(commit(dir)).toEqual({
      status: 1,
      stderr: [
        "no-comments: 1 file does not parse. Fix the syntax where each file stops parsing.",
        "a.ts",
        "  2  does not parse: Unexpected token",
        "",
      ].join("\n"),
    });
  });

  test("keeps an agent-gate marker in any language, and only the whole marker", () => {
    const dir = gated({ "a.ts": "// agent-gate:no-comments:1\nexport {};\n" });
    expect(commit(dir)).toEqual({ status: 0, stderr: "" });
    writeFiles(dir, { "a.ts": "// agent-gate:no-comments:1 and more\nexport {};\n" });
    expect(commit(dir).stderr).toBe(refusalText(["a.ts", "  1  // agent-gate:no-comments:1 and more"]));
    writeFiles(dir, { "a.ts": "export {}; // agent-gate:no-comments:1\n" });
    expect(commit(dir).stderr).toBe(refusalText(["a.ts", "  1  // agent-gate:no-comments:1"]));
  });

  test("keeps another tool's gate marker, with or without a part", () => {
    const dir = gated({ "a.ts": "// dim-gate:1\n// other-tool-gate:lint:12\nexport {};\n" });
    expect(commit(dir)).toEqual({ status: 0, stderr: "" });
    writeFiles(dir, { "a.ts": "// dim-gate:one\nexport {};\n" });
    expect(commit(dir).stderr).toBe(refusalText(["a.ts", "  1  // dim-gate:one"]));
  });

  test("judges each language with the adapter installed for it", () => {
    const dir = repo();
    installGates(dir, ["no-comments-dart", "no-comments-sql", "no-comments-shell", "no-comments-rust"]);
    writeFiles(dir, {
      "lib/a.dart": "void f() {} // why\n",
      "src/a.rs": '#[doc = "why"]\nfn f() {}\n',
      "db/a.sql": "select 1; -- why\n",
      "bin/tool": "#!/bin/sh\n# why\n",
      "a.ts": "// why\n",
    });
    expect(commit(dir)).toEqual({
      status: 1,
      stderr: refusalText(
        [
          "bin/tool",
          "  2  # why",
          "db/a.sql",
          "  1  -- why",
          "lib/a.dart",
          "  1  // why",
          "src/a.rs",
          '  1  #[doc = "why"]',
        ],
        [
          "kept in Dart: `ignore:` and `ignore_for_file:` naming only diagnostics; `// @dart = x.y` alone; one `SPDX-License-Identifier:` line; a gate marker on a line of its own",
          "kept in SQL: drizzle's `--> statement-breakpoint`; one `SPDX-License-Identifier:` line; a gate marker on a line of its own",
          "kept in shell: the first-line shebang; `shellcheck` directives of `source=`, `source-path=`, `shell=`, `external-sources=` and `enable=`; one `SPDX-License-Identifier:` line; a gate marker on a line of its own",
          KEPT_IN_RUST,
        ],
      ),
    });
  });

  test("refuses a kept Rust doc the change moves out of library code or off a pub item", () => {
    const dir = repo({
      "Cargo.toml": '[package]\nname = "x"\n',
      "src/lib.rs": "//! Crate.\npub mod util;\n",
      "src/util.rs": "/// Util.\npub fn util() {}\n",
      "src/other.rs": "/// Other.\npub fn other() {}\n",
    });
    installGates(dir, ["no-comments-rust"]);
    expect(commit(dir)).toEqual({ status: 0, stderr: "" });
    rmSync(join(dir, "src/util.rs"));
    writeFiles(dir, {
      "examples/util.rs": "/// Util.\npub fn util() {}\n",
      "src/other.rs": "/// Other.\nfn other() {}\n",
    });
    expect(commit(dir).stderr).toBe(
      refusalText(["examples/util.rs", "  1  /// Util.", "src/other.rs", "  1  /// Other."], [KEPT_IN_RUST]),
    );
  });

  test("judges a Rust file's base by the crate HEAD holds, and its head by the crate the index holds", () => {
    const dir = repo({
      "Cargo.toml": '[package]\nname = "x"\n',
      "src/lib.rs": "pub mod a;\n",
      "src/a.rs": "/// A.\npub fn a() {}\n",
    });
    installGates(dir, ["no-comments-rust"]);
    expect(commit(dir)).toEqual({ status: 0, stderr: "" });
    rmSync(join(dir, "src/lib.rs"));
    writeFiles(dir, { "src/a.rs": "/// A.\npub fn a() -> u8 { 1 }\n" });
    expect(commit(dir).stderr).toBe(refusalText(["src/a.rs", "  1  /// A."], [KEPT_IN_RUST]));
  });

  test("refuses a kept Go doc the change moves into package main or off an exported name", () => {
    const dir = repo({
      "a/a.go": "// Package a.\npackage a\n\n// F does.\nfunc F() {}\n",
      "b/b.go": "package b\n\n// G does.\nfunc G() {}\n",
    });
    installGates(dir, ["no-comments-go"]);
    expect(commit(dir)).toEqual({ status: 0, stderr: "" });
    writeFiles(dir, {
      "a/a.go": "// Package a.\npackage main\n\n// F does.\nfunc F() {}\n",
      "b/b.go": "package b\n\n// G does.\nfunc g() {}\n",
    });
    expect(commit(dir).stderr).toBe(
      refusalText(
        ["a/a.go", "  1  // Package a.", "  4  // F does.", "b/b.go", "  3  // G does."],
        [KEPT_IN_GO],
      ),
    );
  });

  test("keeps one SPDX-License-Identifier line in every language, and nothing more with it", () => {
    const dir = repo();
    installGates(dir, ["no-comments-javascript", "no-comments-sql", "no-comments-shell", "no-comments-rust"]);
    writeFiles(dir, {
      "a.ts":
        "// SPDX-License-Identifier: MIT\n/* SPDX-License-Identifier: Apache-2.0 OR MIT */\nexport {};\n",
      "b.ts":
        "// SPDX-License-Identifier: MIT because\n/*\n * SPDX-License-Identifier: MIT\n */\nexport {};\n",
      "a.sql": "-- SPDX-License-Identifier: GPL-2.0-only WITH Classpath-exception-2.0\nselect 1;\n",
      "a.sh": "#!/bin/sh\n# SPDX-License-Identifier: LicenseRef-Own\n",
      "a.rs": "// SPDX-License-Identifier: MIT\nfn f() {}\n",
    });
    expect(commit(dir)).toEqual({
      status: 1,
      stderr: refusalText(["b.ts", "  1  // SPDX-License-Identifier: MIT because", "  2  /*"]),
    });
  });

  test("refuses a file that does not parse, naming where and why", () => {
    const dir = gated({ "a.ts": "const a = 1;\nconst = ;\n" });
    expect(commit(dir)).toEqual({
      status: 1,
      stderr: [
        "no-comments: 1 file does not parse. Fix the syntax where each file stops parsing.",
        "a.ts",
        "  2  does not parse: Unexpected token",
        "",
      ].join("\n"),
    });
  });

  test("reads the staged content, and the index git commit <paths> builds", () => {
    const dir = gated({ "a.ts": "export const a = 1;\n" });
    expect(commit(dir).status).toBe(0);
    writeFiles(dir, { "a.ts": "export const a = 2; // why\n" });
    execFileSync("git", ["-C", dir, "add", "a.ts"]);
    writeFiles(dir, { "a.ts": "export const a = 2;\n" });
    expect(commitPaths(dir, []).status).toBe(1);
    expect(commitPaths(dir, ["a.ts"])).toEqual({ status: 0, stderr: "" });
    writeFiles(dir, { "a.ts": "export const a = 3; // why\n" });
    expect(commitPaths(dir, ["a.ts"])).toEqual({
      status: 1,
      stderr: refusalText(["a.ts", "  1  // why"]),
    });
  });

  test("skips linguist-generated, vendored, binary and non-regular files, and nothing a file says of itself", () => {
    const dir = gated({
      ".gitattributes": "vendor/** linguist-vendored\nsrc/gen.ts linguist-generated\n",
      "vendor/v.js": "// vendored\n",
      "src/gen.ts": "// made by a tool\n",
      "src/data.js": "\0// binary\n",
      "README.md": "# Comments here are prose\n",
    });
    symlinkSync("// a link target", join(dir, "src/link.ts"));
    expect(commit(dir)).toEqual({ status: 0, stderr: "" });
    writeFiles(dir, { "src/header.ts": "// Code GENERATED by a tool\nexport {};\n" });
    expect(commit(dir).stderr).toBe(refusalText(["src/header.ts", "  1  // Code GENERATED by a tool"]));
  });

  test("loads an adapter only for a file it reads, and leaves a language alone without one", () => {
    const dir = gated();
    writeFileSync(join(dir, ".githooks/no-comments/javascript.cjs"), "throw new Error('loaded');\n");
    writeFiles(dir, { "notes.md": "# notes\n" });
    expect(commit(dir, { add: ["notes.md"] })).toEqual({ status: 0, stderr: "" });
    writeFiles(dir, { "a.ts": "// why\n" });
    const bug =
      "no-comments: loaded; stop and hand this error to the owner as a bug in agent-gates; no command you run resolves it\n";
    expect(commit(dir, { add: ["a.ts"] })).toEqual({ status: 1, stderr: bug });
    const scan = spawnSync("node", [".githooks/no-comments/scan.cjs"], { cwd: dir, encoding: "utf8" });
    expect([scan.status, scan.stderr]).toEqual([3, bug]);
    rmSync(join(dir, ".githooks/no-comments/javascript.cjs"));
    expect(commit(dir, { add: ["a.ts"] })).toEqual({ status: 0, stderr: "" });
  });

  test("lets a merge commit through", () => {
    const dir = gated({ "a.ts": "export {};\n" });
    expect(commit(dir).status).toBe(0);
    git(dir, ["checkout", "-q", "-b", "side"]);
    writeFiles(dir, { "b.ts": "export {};\n" });
    expect(commit(dir).status).toBe(0);
    git(dir, ["checkout", "-q", "-"]);
    writeFiles(dir, { "c.ts": "export {};\n" });
    expect(commit(dir).status).toBe(0);
    git(dir, ["merge", "-q", "--no-commit", "side"]);
    writeFiles(dir, { "b.ts": "// resolved\nexport {};\n" });
    expect(commit(dir)).toEqual({ status: 0, stderr: "" });
  });

  test("exits 3 when an adapter returns what the scanner does not read", () => {
    const dir = gated();
    const adapter = join(dir, ".githooks/no-comments/javascript.cjs");
    writeFileSync(adapter, "exports.comments = () => [];\n");
    writeFiles(dir, { "a.ts": "// why\n" });
    git(dir, ["add", "a.ts"]);
    const unkept = scan(dir, []);
    expect(unkept.status).toBe(3);
    expect(unkept.stderr).toContain("javascript.cjs exports the comment forms it keeps");
    writeFileSync(adapter, "exports.comments = () => [];\nexports.kept = [];\n");
    const run = scan(dir, []);
    expect(run.status).toBe(3);
    expect(run.stderr).toContain(
      "javascript.cjs returns the comments it read, or where the file stops parsing",
    );
  });

  test("exits 3 when node is not on PATH, since nothing was judged", () => {
    const dir = gated();
    const bin = scratchDir();
    symlinkSync(execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim(), join(bin, "git"));
    const run = spawnSync("/bin/sh", [".githooks/pre-commit.d/no-comments"], {
      cwd: dir,
      env: { PATH: bin },
      encoding: "utf8",
    });
    expect([run.status, run.stderr]).toEqual([
      3,
      "no-comments: node is not on PATH, so the commit's comments cannot be judged; install Node.js\n",
    ]);
  });
});

describe("the pre-commit dispatcher", () => {
  test("runs each executable step in order and stops at the first that fails", () => {
    const dir = gated();
    writeFiles(dir, {
      ".githooks/pre-commit.d/a-first": "#!/bin/sh\necho first >> steps\n",
      ".githooks/pre-commit.d/b-skipped": "#!/bin/sh\necho skipped >> steps\n",
      ".githooks/pre-commit.d/c-fails": "#!/bin/sh\necho fails >> steps\nexit 3\n",
      ".githooks/pre-commit.d/d-never": "#!/bin/sh\necho never >> steps\n",
    });
    for (const step of ["a-first", "c-fails", "d-never"])
      chmodSync(join(dir, ".githooks/pre-commit.d", step), 0o755);
    const run = spawnSync(join(dir, ".githooks/pre-commit"), { cwd: dir, encoding: "utf8" });
    expect(run.status).toBe(3);
    expect(readFileSync(join(dir, "steps"), "utf8")).toBe("first\nfails\n");
  });
});

describe("the no-comments workflow", () => {
  function judgeStep(): string {
    const text = readFileSync(join(SOURCE_DIR, "no-comments.yml"), "utf8");
    const run = /^ {8}run: \|\n((?: {10}.*\n)+)/m.exec(text)?.[1];
    if (run === undefined) throw new Error("no-comments.yml runs no command");
    return run;
  }

  function judged(dir: string, push: { base: string; head: string; ref: string }) {
    const run = spawnSync("bash", ["-e", "-c", judgeStep()], {
      cwd: dir,
      env: {
        ...process.env,
        BASE_SHA: push.base,
        HEAD_SHA: push.head,
        PUSHED_REF: push.ref,
        DEFAULT_BRANCH: "main",
      },
      encoding: "utf8",
    });
    return { status: run.status, stdout: run.stdout, stderr: run.stderr };
  }

  test("judges the files changed since the merge base of the pushed base", () => {
    const dir = gated({ "a.ts": "// old\n" });
    const base = commitPastHooks(dir, "feat: start");
    writeFiles(dir, { "b.ts": "// new\n" });
    const head = commitPastHooks(dir, "feat: more");
    expect(judged(dir, { base, head, ref: "refs/heads/main" })).toEqual({
      status: 1,
      stdout: "::error file=b.ts,line=1::// new\n",
      stderr: refusalText(["b.ts", "  1  // new"]),
    });
    expect(judged(dir, { base: head, head, ref: "refs/heads/main" })).toEqual({
      status: 0,
      stdout: "",
      stderr: "",
    });
  });

  test("reads a pushed Rust file's crate from the pushed head, not the index", () => {
    const dir = repo({ "Cargo.toml": '[package]\nname = "x"\n', "src/lib.rs": "pub fn a() {}\n" });
    installGates(dir, ["no-comments-rust"]);
    const base = commitPastHooks(dir, "feat: start");
    writeFiles(dir, { "src/lib.rs": "/// A.\npub fn a() {}\n" });
    const head = commitPastHooks(dir, "feat: docs");
    git(dir, ["rm", "-q", "--cached", "Cargo.toml"]);
    expect(scan(dir, [base, head])).toEqual({ status: 0, stderr: "" });
    expect(scan(dir, ["--all"]).stderr).toBe(
      refusalText(["src/lib.rs", "  1  /// A."], [KEPT_IN_RUST]).replace(
        "this change adds",
        "the tracked files hold",
      ),
    );
  });

  test("judges a new branch from its merge base with the default branch, not its tip alone", () => {
    const dir = gated({ "a.ts": "// on main\n" });
    git(dir, ["update-ref", "refs/remotes/origin/main", commitPastHooks(dir, "feat: start")]);
    writeFiles(dir, { "b.ts": "// early\n" });
    commitPastHooks(dir, "feat: early");
    writeFiles(dir, { "c.ts": "export {};\n" });
    const head = commitPastHooks(dir, "feat: tip");
    expect(judged(dir, { base: NO_COMMIT, head, ref: "refs/heads/topic" })).toEqual({
      status: 1,
      stdout: "::error file=b.ts,line=1::// early\n",
      stderr: refusalText(["b.ts", "  1  // early"]),
    });
  });

  test("judges every file when the default branch is pushed for the first time", () => {
    const dir = gated({ "a.ts": "// root\n" });
    commitPastHooks(dir, "feat: start");
    writeFiles(dir, { "b.ts": "export {};\n" });
    const head = commitPastHooks(dir, "feat: more");
    git(dir, ["update-ref", "refs/remotes/origin/main", head]);
    expect(judged(dir, { base: NO_COMMIT, head, ref: "refs/heads/main" })).toEqual({
      status: 1,
      stdout: "::error file=a.ts,line=1::// root\n",
      stderr: refusalText(["a.ts", "  1  // root"]),
    });
  });

  test("judges every file when a new branch reaches a remote with no default branch", () => {
    const dir = gated({ "a.ts": "// root\n" });
    commitPastHooks(dir, "feat: start");
    writeFiles(dir, { "b.ts": "export {};\n" });
    const head = commitPastHooks(dir, "feat: more");
    expect(judged(dir, { base: NO_COMMIT, head, ref: "refs/heads/topic" })).toEqual({
      status: 1,
      stdout: "::error file=a.ts,line=1::// root\n",
      stderr: refusalText(["a.ts", "  1  // root"]),
    });
  });

  test("judges every file of a new branch that shares no history with the default branch", () => {
    const dir = gated({ "a.ts": "export {};\n" });
    git(dir, ["update-ref", "refs/remotes/origin/main", commitPastHooks(dir, "feat: start")]);
    git(dir, ["checkout", "-q", "--orphan", "pages"]);
    writeFiles(dir, { "b.ts": "// orphan\n" });
    commitPastHooks(dir, "feat: orphan");
    writeFiles(dir, { "c.ts": "export {};\n" });
    const head = commitPastHooks(dir, "feat: tip");
    expect(judged(dir, { base: NO_COMMIT, head, ref: "refs/heads/pages" })).toEqual({
      status: 1,
      stdout: "::error file=b.ts,line=1::// orphan\n",
      stderr: refusalText(["b.ts", "  1  // orphan"]),
    });
  });

  test("exits 2 on a call that names a base without a head, or --all with one, or a flag it does not know", () => {
    const dir = gated();
    const usage = (got: string) =>
      `no-comments: scan.cjs takes no arguments, --all, or a base and a head, each optionally after --format github, and got ${got}; node scan.cjs [--format github] [--all | <base> <head>]\n`;
    expect(scan(dir, ["HEAD"])).toEqual({ status: 2, stderr: usage("1: HEAD") });
    expect(scan(dir, ["--all", "HEAD"])).toEqual({ status: 2, stderr: usage("2: --all HEAD") });
    expect(scan(dir, ["--format", "json"])).toEqual({ status: 2, stderr: usage("2: --format json") });
    expect(scan(dir, ["--format"])).toEqual({ status: 2, stderr: usage("1: --format") });
    expect(scan(dir, ["--format", "github", "--format", "github"])).toEqual({
      status: 2,
      stderr: usage("4: --format github --format github"),
    });
    expect(scan(dir, ["--json"])).toEqual({ status: 2, stderr: usage("1: --json") });
    expect(scan(dir, ["HEAD", "--format", "github", "HEAD"])).toEqual({
      status: 2,
      stderr: usage("4: HEAD --format github HEAD"),
    });
    expect(scan(dir, ["--all", "--format", "github"])).toEqual({
      status: 2,
      stderr: usage("3: --all --format github"),
    });
  });

  test("annotates each finding for GitHub with --format github, and logs the whole reply", () => {
    const dir = gated({ "a.ts": "// why\nexport {};\n".repeat(300) });
    commitPastHooks(dir, "feat: start");
    const { status, stdout, stderr } = scanned(dir, ["--format", "github", "--all"]);
    expect(status).toBe(1);
    expect(stdout.split("\n").slice(0, 2)).toEqual([
      "::error file=a.ts,line=1::// why",
      "::error file=a.ts,line=3::// why",
    ]);
    expect(stdout).toEndWith("\n::error::no-comments: 291 more findings; the step's log lists them all\n");
    expect(stderr.split("\n")).toHaveLength(304);
  });

  test("annotates a pushed change for GitHub", () => {
    const dir = gated({ "a.ts": "export {};\n" });
    const base = commitPastHooks(dir, "feat: start");
    writeFiles(dir, { "a.ts": "// why\nexport {};\n" });
    const head = commitPastHooks(dir, "feat: why");
    expect(scanned(dir, ["--format", "github", base, head])).toEqual({
      status: 1,
      stdout: "::error file=a.ts,line=1::// why\n",
      stderr: refusalText(["a.ts", "  1  // why"]),
    });
  });

  test("keeps the reply within 4,000 bytes, counting the comments it does not show", () => {
    const dir = gated({ "a.ts": "// why\nexport {};\n".repeat(300) });
    commitPastHooks(dir, "feat: start");
    const { status, stderr } = scan(dir, ["--all"]);
    expect(status).toBe(1);
    expect(Buffer.byteLength(stderr)).toBeLessThanOrEqual(4000);
    expect(stderr).toStartWith("no-comments: the tracked files hold 300 comments.");
    expect(stderr).toMatch(/\na\.ts: \d+ more\n$/);
  });

  test("judges every comment of every tracked file with --all, as the index holds it", () => {
    const dir = gated({ "a.ts": "// old\nexport {};\n", "b.ts": "export {};\n" });
    commitPastHooks(dir, "feat: start");
    writeFiles(dir, { "b.ts": "// staged\nexport {};\n" });
    git(dir, ["add", "b.ts"]);
    writeFiles(dir, { "a.ts": "export {};\n", "c.ts": "// untracked\n" });
    expect(scan(dir, ["--all"])).toEqual({
      status: 1,
      stderr: [
        "no-comments: the tracked files hold 2 comments. Remove each comment; a why belongs in a name, a test or the docs.",
        KEPT_IN_JAVASCRIPT,
        "a.ts",
        "  1  // old",
        "b.ts",
        "  1  // staged",
        "",
      ].join("\n"),
    });
  });
});

describe("install and doctor", () => {
  test("refuses a project's own pre-commit hook, and writes nothing", () => {
    const dir = repo({ ".githooks/pre-commit": "#!/bin/sh\nmake check\n" });
    expect(refusalOf(() => installGates(dir, ["no-comments-javascript"]))).toBe("hook_occupied");
    expect(existsSync(join(dir, ".githooks/no-comments"))).toBe(false);
    expect(readFileSync(join(dir, ".githooks/pre-commit"), "utf8")).toBe("#!/bin/sh\nmake check\n");
    expect(installGates(dir, ["commit-subject"]).gates).toEqual(["commit-subject"]);
  });

  test("doctor fails a project's own pre-commit hook with the move as the fix", () => {
    const dir = gated({ "a.ts": "export {};\n" });
    writeFileSync(join(dir, ".githooks/pre-commit"), "#!/bin/sh\nmake check\n");
    const report = gatesDoctor(dir);
    expect(report.failing).toBe(1);
    expect(report.checks.find(({ name }) => name === ".githooks/pre-commit")).toEqual({
      name: ".githooks/pre-commit",
      state: "fail",
      detail: `${dir} has its own .githooks/pre-commit, which a gate would replace`,
      fix: `stop and hand this error to the owner: ${dir}'s .githooks/pre-commit must move out before the gates install; a step that runs before each commit belongs in .githooks/pre-commit.d/<name>, and commit-subject owns .githooks/commit-msg`,
    });
  });

  test("doctor matches the installed languages against the tracked files", () => {
    const dir = gated({
      "a.ts": "export {};\n",
      "bin/tool": "#!/usr/bin/env node\n",
      "img.dart": "\0binary\n",
    });
    git(dir, ["add", "-A"]);
    expect(doctorCheck(dir, "no-comments languages")).toEqual({
      name: "no-comments languages",
      state: "ok",
      detail: "javascript, as the tracked files need",
      fix: null,
    });
    git(dir, ["rm", "-q", "-f", "a.ts", "bin/tool"]);
    writeFiles(dir, { ".gitattributes": "gen.ts linguist-generated\n", "gen.ts": "export {};\n" });
    git(dir, ["add", "-A"]);
    expect(doctorCheck(dir, "no-comments languages")).toEqual({
      name: "no-comments languages",
      state: "warn",
      detail: "no-comments-javascript is installed, but the project tracks no file javascript reads",
      fix: "delete .githooks/no-comments/javascript.cjs",
    });
    expect(gatesDoctor(repo({ "a.ts": "export {};\n" })).checks.map(({ name }) => name)).toEqual(["gates"]);
  });

  test("doctor reports missing and unused languages in one check, with one fix for both", () => {
    const dir = gated({ "a.dart": "void f() {}\n" });
    git(dir, ["add", "-A"]);
    expect(gatesDoctor(dir).checks.filter(({ name }) => name === "no-comments languages")).toEqual([
      {
        name: "no-comments languages",
        state: "warn",
        detail:
          "dart reads 1 tracked file, but no-comments-dart is not installed; no-comments-javascript is installed, but the project tracks no file javascript reads",
        fix: "agent-gates install no-comments-dart; delete .githooks/no-comments/javascript.cjs",
      },
    ]);
  });

  test("doctor names every tracked language whose gate is not installed, with one install for all", () => {
    const dir = gated({ "a.ts": "export {};\n", "a.dart": "void f() {}\n", "b.dart": "", "db/a.sql": "" });
    git(dir, ["add", "-A"]);
    expect(doctorCheck(dir, "no-comments languages")).toEqual({
      name: "no-comments languages",
      state: "warn",
      detail:
        "dart reads 2 tracked files, but no-comments-dart is not installed; sql reads 1 tracked file, but no-comments-sql is not installed",
      fix: "agent-gates install no-comments-dart no-comments-sql",
    });
  });

  test("doctor counts the tracked comments a sweep would refuse, through the installed adapters", () => {
    const dir = gated({ "a.ts": "// old\nexport {};\n", "b.ts": "export {};\n", "c.dart": "// unread\n" });
    commitPastHooks(dir, "feat: start");
    expect(doctorCheck(dir, "no-comments backlog")).toEqual({
      name: "no-comments backlog",
      state: "warn",
      detail: "the tracked files hold 1 comment",
      fix: "node .githooks/no-comments/scan.cjs --all lists each one",
    });
    writeFiles(dir, { "b.ts": "// staged\nexport {\n" });
    git(dir, ["add", "b.ts"]);
    expect(doctorCheck(dir, "no-comments backlog")?.detail).toBe(
      "the tracked files hold 1 comment, and 1 file does not parse",
    );
    git(dir, ["rm", "-q", "-f", "a.ts", "b.ts"]);
    expect(doctorCheck(dir, "no-comments backlog")).toEqual({
      name: "no-comments backlog",
      state: "ok",
      detail: "the tracked files hold no comment",
      fix: null,
    });
  });

  test("doctor runs no installed gate file that differs from this agent-gates, and still reports", () => {
    const dir = gated({ "a.ts": "// old\nexport {};\n" });
    commitPastHooks(dir, "feat: start");
    writeFileSync(
      join(dir, ".githooks/no-comments/javascript.cjs"),
      ["// agent-gate:no-comments-javascript:1", 'throw new Error("ran");', ""].join("\n"),
    );
    const report = gatesDoctor(dir);
    expect(report.checks.find(({ name }) => name === ".githooks/no-comments/javascript.cjs")?.state).toBe(
      "warn",
    );
    expect(report.checks.find(({ name }) => name === "no-comments backlog")).toEqual({
      name: "no-comments backlog",
      state: "warn",
      detail:
        "not counted while these differ from this agent-gates, since the count runs them: .githooks/no-comments/javascript.cjs",
      fix: "agent-gates install",
    });
  });
});
