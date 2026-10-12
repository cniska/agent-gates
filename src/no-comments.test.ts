import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gatesDoctor } from "./doctor";
import { bundled } from "./gate-bundles";
import { installGates, SOURCE_DIR } from "./gates";
import { ADAPTER_FILES, SCANNER_FILE } from "./gates-contract";
import { comments as dartComments } from "./no-comments-dart";
import { comments } from "./no-comments-javascript";
import { LANGUAGE_NAMES, LANGUAGES, languageOf } from "./no-comments-languages";
import { comments as rustComments } from "./no-comments-rust";
import { comments as shellComments } from "./no-comments-shell";
import { comments as sqlComments } from "./no-comments-sql";
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

function gated(files: Record<string, string> = {}): string {
  const dir = repo(files);
  installGates(dir, ["no-comments-javascript"]);
  return dir;
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

function scan(dir: string, args: readonly string[]) {
  const run = spawnSync("node", [join(dir, ".githooks/no-comments/scan.cjs"), ...args], {
    cwd: dir,
    encoding: "utf8",
  });
  return { status: run.status, stderr: run.stderr };
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
  test("refuses each comment, naming its line and first line", async () => {
    const text = "const a = 1; // why\n/* a\n   block */\nconst b = <T,>(x: T) => x;\n/** doc */\n";
    expect(await comments("a.ts", text)).toEqual([
      { line: 1, body: "// why" },
      { line: 2, body: "/* a" },
      { line: 5, body: "/** doc */" },
    ]);
    expect(await comments("a.tsx", "const a = <div>{/* note */}</div>;\n")).toEqual([
      { line: 1, body: "/* note */" },
    ]);
  });

  test("keeps the comments a tool reads", async () => {
    const kept = [
      "// @ts-expect-error",
      "// eslint-disable-next-line no-console",
      "// biome-ignore lint: x",
      "// prettier-ignore",
      "/* #__PURE__ */",
      "/* @__PURE__ */",
      '/// <reference types="bun" />',
      "/*! license */",
      "/** @vitest-environment jsdom */",
    ];
    expect(await comments("a.ts", `#!/usr/bin/env node\n${kept.join("\nf();\n")}\n`)).toEqual([]);
  });

  test("keeps JSDoc types only where plain JavaScript needs them", async () => {
    const typed =
      "/** @type {number} */\nlet a;\n/**\n * @param {string} x\n * @param y\n */\nfunction f(x, y) {}\n";
    expect(await comments("a.js", typed)).toEqual([]);
    expect(
      await comments("a.mjs", "/**\n * @param x the input\n * Adds one.\n */\nfunction f(x) {}\n"),
    ).toEqual([{ line: 1, body: "/**" }]);
    expect(await comments("a.ts", typed)).toEqual([
      { line: 1, body: "/** @type {number} */" },
      { line: 3, body: "/**" },
    ]);
    expect(await comments("bin/tool", `#!/usr/bin/env node\n${typed}const b = <div />;\n`)).toEqual([]);
    expect(await comments("bin/tool", `#!/usr/bin/env bun\n${typed}const b: number = 1;\n`)).toEqual([
      { line: 2, body: "/** @type {number} */" },
      { line: 4, body: "/**" },
    ]);
  });

  test("returns null for a file that does not parse", async () => {
    expect(await comments("a.ts", "const = ;\n")).toBeNull();
    expect(await comments("a.js", "const a: number = 1;\n")).toBeNull();
  });
});

describe("the dart adapter", () => {
  test("refuses each comment, doc comments and nested blocks too", async () => {
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
    expect(await dartComments("a.dart", text)).toEqual([
      { line: 1, body: "/// A doc comment." },
      { line: 2, body: "// trailing" },
      { line: 3, body: "/* outer /* inner */ still outer */" },
      { line: 5, body: "/* a" },
      { line: 7, body: "// after a map in an interpolation" },
      { line: 8, body: "// after an escaped quote" },
    ]);
  });

  test("reads no comment inside a string, raw and triple-quoted alike", async () => {
    const text = [
      "#!/usr/bin/env dart",
      "final a = r'// raw';",
      'final c = r"""// raw \\""";',
      "final b = '''",
      "// inside",
      "''';",
    ].join("\n");
    expect(await dartComments("a.dart", text)).toEqual([]);
  });

  test("keeps the comments the analyzer reads", async () => {
    const text = [
      "// ignore_for_file: avoid_print",
      "// ignore: unused_element",
      "/// ignore: unused_element",
      "// coverage:ignore-line",
      "// @dart=3.0",
      "// @dart = 3.0",
      "void f() {}",
    ].join("\n");
    expect(await dartComments("a.dart", text)).toEqual([]);
  });

  test("returns null for a file whose string, comment or interpolation never closes", async () => {
    expect(await dartComments("a.dart", "final a = 'open;\nfinal b = 1;\n")).toBeNull();
    expect(await dartComments("a.dart", "/* open\n")).toBeNull();
    expect(await dartComments("a.dart", "final a = '${b';\n")).toBeNull();
  });
});

describe("the sql adapter", () => {
  test("refuses each comment, inside a function body too", async () => {
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
    expect(await sqlComments("a.sql", text)).toEqual([
      { line: 1, body: "-- header" },
      { line: 2, body: "/* block */" },
      { line: 5, body: "-- in the body" },
      { line: 8, body: "/* outer /* inner */" },
    ]);
  });

  test("reads a dollar quote that is not SQL as a literal, and SQL inside one as code", async () => {
    expect(await sqlComments("a.sql", "comment on table t is $$Don't drop$$;\n")).toEqual([]);
    expect(await sqlComments("a.sql", "do $$ # it's python $$;\n-- after\n")).toEqual([
      { line: 2, body: "-- after" },
    ]);
    const nested =
      "create function f() returns void as $a$\nbegin\n  execute $b$\n  -- inner\n  $b$;\nend $a$;\n";
    expect(await sqlComments("a.sql", nested)).toEqual([{ line: 4, body: "-- inner" }]);
  });

  test("reads positional parameters and identifiers as code, not dollar quotes", async () => {
    expect(await sqlComments("a.sql", "select $1, $2 -- trailing")).toEqual([
      { line: 1, body: "-- trailing" },
    ]);
    expect(await sqlComments("a.sql", "select a$b$c from t;")).toEqual([]);
  });

  test("keeps drizzle's statement breakpoint, and only that exact comment", async () => {
    const text = "create table a (id int);\n--> statement-breakpoint\ncreate table b (id int);\n";
    expect(await sqlComments("a.sql", text)).toEqual([]);
    expect(await sqlComments("a.sql", "--> statement-breakpoint and why\n-- statement-breakpoint\n")).toEqual(
      [
        { line: 1, body: "--> statement-breakpoint and why" },
        { line: 2, body: "-- statement-breakpoint" },
      ],
    );
  });

  test("reads letters beyond ASCII in identifiers and dollar quote tags as Postgres does", async () => {
    expect(await sqlComments("a.sql", "select $ä$Don't$ä$; -- c")).toEqual([{ line: 1, body: "-- c" }]);
    expect(await sqlComments("a.sql", "select ä$b$ from t; -- c")).toEqual([{ line: 1, body: "-- c" }]);
  });

  test("lets a backslash escape the quote only in an escape string", async () => {
    expect(await sqlComments("a.sql", "select E'a\\'-- still quoted';")).toEqual([]);
    expect(await sqlComments("a.sql", "select 'a\\' -- a comment")).toEqual([
      { line: 1, body: "-- a comment" },
    ]);
    expect(await sqlComments("a.sql", "select fE'a\\' -- a comment")).toEqual([
      { line: 1, body: "-- a comment" },
    ]);
  });

  test("returns null for a file whose quote, comment or dollar quote never closes", async () => {
    expect(await sqlComments("a.sql", "select 'open;\n")).toBeNull();
    expect(await sqlComments("a.sql", "/* open\n")).toBeNull();
    expect(await sqlComments("a.sql", "select $$ open;\n")).toBeNull();
    expect(await sqlComments("a.sql", "select $a$ $b$ $a$ $b$;\n")).toBeNull();
  });
});

describe("the shell adapter", () => {
  test("refuses each comment, and no hash in a string, heredoc or expansion", async () => {
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
    expect(await shellComments("a.sh", text)).toEqual([
      { line: 2, body: "# header" },
      { line: 3, body: "# trailing" },
      { line: 10, body: "# last in its block" },
      { line: 12, body: "# last in the file" },
    ]);
  });

  test("keeps the shebang and shellcheck's directives, and only those", async () => {
    const text = "#!/bin/sh\n# shellcheck disable=SC2034\nx=1\n  # shellcheck source=lib.sh\n#!/bin/sh\n";
    expect(await shellComments("a.sh", text)).toEqual([{ line: 5, body: "#!/bin/sh" }]);
    expect(await shellComments("a.sh", "# shellchecked by hand\n")).toEqual([
      { line: 1, body: "# shellchecked by hand" },
    ]);
  });

  test("starts a comment only where a word starts", async () => {
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
    expect(await shellComments("a.sh", lines.join("\n"))).toEqual([
      { line: 1, body: "#c" },
      { line: 2, body: "#c" },
      { line: 3, body: "#c" },
      { line: 4, body: "#c" },
      { line: 5, body: "#c" },
      { line: 7, body: "#c" },
    ]);
    expect(await shellComments("a.sh", "echo a\\\n# not a comment\necho b \\\n# a comment\n")).toEqual([
      { line: 4, body: "# a comment" },
    ]);
  });

  test("reads no comment in a parameter, an arithmetic expansion or a regex", async () => {
    const lines = [
      `echo $# \${#x} \${x#p} \${x##p} \${x/#a/b} $$#`,
      "echo $((1 << 2)) $[1+2] $'a\\'#b' $\"#\"",
      "(( x << 1 ))",
      "[[ $x =~ #a ]]",
      `echo \${x:-$(echo #c`,
      ")}",
    ];
    expect(await shellComments("a.sh", lines.join("\n"))).toEqual([{ line: 5, body: "#c" }]);
  });

  test("reads comments inside command and process substitutions, a case in one too", async () => {
    const lines = [
      "x=$( (case a in b) echo;; (c) :;; esac) ) #1",
      'echo "$(echo "# x" #2',
      ')" <(echo #3',
      ")#3b",
      "echo `echo a #4`",
      'echo `echo "\\`echo #5\\`"` #6',
      'y=`sed -e "s,\\"\\\\"(,," #7`',
    ];
    expect((await shellComments("a.sh", lines.join("\n")))?.map(({ line, body }) => [line, body])).toEqual([
      [1, "#1"],
      [2, "#2"],
      [3, "#3"],
      [5, "#4"],
      [6, "#5"],
      [6, "#6"],
      [7, "#7"],
    ]);
  });

  test("reads a =~ regex as one word, its parenthesised groups and alternatives included", async () => {
    const regex = "[[ $l =~ ^[[:space:]]*(#|$) ]]";
    expect(await shellComments("a.sh", `${regex}\n`)).toEqual([]);
    expect(await shellComments("a.sh", `x=$(${regex} && echo y)\n`)).toEqual([]);
    expect(await shellComments("a.sh", "[[ $l =~ ^( #a)$ ]] #c\n")).toEqual([{ line: 1, body: "#c" }]);
  });

  test("closes a substitution at its own parenthesis, not at a case pattern's", async () => {
    expect(await shellComments("a.sh", 'x="$(case a in b) echo " #c";; esac)"\n')).toEqual([]);
    expect(await shellComments("a.sh", 'x="$(case a in b) echo esac;; c) echo " #c";; esac)"\n')).toEqual([]);
  });

  test("reads (( as arithmetic where a command starts, and after for", async () => {
    expect(await shellComments("a.sh", "if (( x << 1 )); then :; fi\n")).toEqual([]);
    expect(await shellComments("a.sh", "for ((i = 0; i << 2; i++)); do :; done\n")).toEqual([]);
    expect(await shellComments("a.sh", "echo $[1 << 2]\n")).toEqual([]);
  });

  test("unescapes a backtick's quotes inside double quotes before reading it", async () => {
    expect(await shellComments("a.sh", 'echo "`echo \\"a #b\\"`"\n')).toEqual([]);
    expect(await shellComments("a.sh", 'echo "`echo \\"#\\" #x`"\n')).toEqual([{ line: 1, body: "#x" }]);
  });

  test("reads heredoc bodies as text, and the substitutions in an unquoted one as code", async () => {
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
    expect(await shellComments("a.sh", lines.join("\n"))).toEqual([
      { line: 1, body: "# c" },
      { line: 3, body: "#in" },
      { line: 9, body: "#here" },
      { line: 12, body: "# after" },
    ]);
  });

  test("returns null for a quote, substitution or heredoc that never closes", async () => {
    for (const open of [
      "echo 'a\n",
      'echo "a\n',
      "echo $'a\n",
      "echo $(a\n",
      "echo ${a\n",
      "echo `a\n",
      "echo $[1\n",
    ])
      expect([open, await shellComments("a.sh", open)]).toEqual([open, null]);
    expect(await shellComments("a.sh", "cat <<EOF\nbody\n")).toBeNull();
    expect(await shellComments("a.sh", "cat <<EOF\nbody\n EOF\n")).toBeNull();
    expect(await shellComments("a.sh", "if true; then\n  echo # open\n")).toEqual([
      { line: 2, body: "# open" },
    ]);
  });
});

describe("the rust adapter", () => {
  test("refuses each comment, doc comments and nested blocks too", async () => {
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
    expect(await rustComments("a.rs", text)).toEqual([
      { line: 1, body: "//! Crate docs." },
      { line: 2, body: "/// Item docs." },
      { line: 3, body: "// trailing" },
      { line: 4, body: "/* outer /* inner */ still outer */" },
      { line: 5, body: "/** block docs */" },
      { line: 6, body: "/*! inner block docs */" },
      { line: 7, body: "/* a" },
      { line: 9, body: "//// four slashes" },
    ]);
  });

  test("reads no comment inside a literal, and finds the one after it", async () => {
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
    expect(await rustComments("a.rs", lines.join("\n"))).toEqual([
      { line: 1, body: "// 1" },
      { line: 2, body: "// 2" },
      { line: 3, body: "// 3" },
      { line: 4, body: "// 4" },
      { line: 5, body: "// 5" },
      { line: 6, body: "// 6" },
      { line: 7, body: "// 7" },
      { line: 8, body: "// 8" },
      { line: 9, body: "// 9" },
      { line: 10, body: "// 10" },
      { line: 13, body: "// 13" },
      { line: 14, body: "// 14" },
    ]);
  });

  test("refuses a doc attribute that carries doc text, and keeps every other attribute", async () => {
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
    expect(await rustComments("a.rs", lines.join("\n"))).toEqual([
      { line: 1, body: '#![doc = "Crate docs."]' },
      { line: 2, body: '#[doc = include_str!("../README.md")]' },
      { line: 8, body: '# [ doc = "spaced" ]' },
      { line: 9, body: '#[doc = "a ] in a string"]' },
      { line: 10, body: "#[doc = concat!(" },
    ]);
  });

  test("refuses doc text anywhere in an attribute, and only there", async () => {
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
    expect(await rustComments("a.rs", lines.join("\n"))).toEqual([
      { line: 1, body: '#[cfg_attr(docsrs, doc = "text")]' },
      { line: 2, body: '#![cfg_attr(feature = "x", doc = include_str!("x.md"))]' },
    ]);
  });

  test("refuses a doc attribute once, with the comments inside it", async () => {
    expect(await rustComments("a.rs", '#[doc = "x" /* y */]\n')).toEqual([
      { line: 1, body: '#[doc = "x" /* y */]' },
    ]);
    expect(await rustComments("a.rs", '#[doc = concat!(\n  // n\n  "x")]\n')).toEqual([
      { line: 1, body: "#[doc = concat!(" },
    ]);
    expect(await rustComments("a.rs", "#[derive(Debug /* y */)]\n")).toEqual([{ line: 1, body: "/* y */" }]);
    expect(await rustComments("a.rs", '#[doc /* y */ = "x"]\n')).toEqual([
      { line: 1, body: '#[doc /* y */ = "x"]' },
    ]);
    expect(await rustComments("a.rs", '# /* y */ [doc = "x"]\n')).toEqual([
      { line: 1, body: '# /* y */ [doc = "x"]' },
    ]);
    expect(await rustComments("a.rs", "# /* y */ [derive(Debug)]\n")).toEqual([{ line: 1, body: "/* y */" }]);
    expect(await rustComments("a.rs", '#[x(#[doc = "y"] /* z */)]\n')).toEqual([
      { line: 1, body: '#[x(#[doc = "y"] /* z */)]' },
    ]);
  });

  test("refuses the doc attribute a macro forwards", async () => {
    const text = "macro_rules! m {\n    ($(#[doc = $doc:expr])*) => {};\n}\n";
    expect(await rustComments("a.rs", text)).toEqual([{ line: 2, body: "#[doc = $doc:expr]" }]);
  });

  test("skips a first-line shebang, and reads #![ there as an inner attribute", async () => {
    expect(await rustComments("a.rs", "#!/usr/bin/env run-cargo-script // x\nfn main() {}\n")).toEqual([]);
    expect(await rustComments("a.rs", '#! [doc = "x"]\n')).toEqual([{ line: 1, body: '#! [doc = "x"]' }]);
    expect(await rustComments("a.rs", "#![allow(dead_code)] // x\n")).toEqual([{ line: 1, body: "// x" }]);
    expect(await rustComments("a.rs", "fn main() {}\n#!/bin/sh // x\n")).toEqual([{ line: 2, body: "// x" }]);
    expect(await rustComments("a.rs", "#! /* a */ // b\n[allow(dead_code)]\n")).toEqual([
      { line: 1, body: "/* a */" },
      { line: 1, body: "// b" },
    ]);
    expect(await rustComments("a.rs", "#! /// doc\n[allow(dead_code)]\n")).toEqual([]);
  });

  test("returns null for a file whose literal or comment never closes", async () => {
    for (const open of [
      'let a = "open;\n',
      'let a = r#"open"";\n',
      'let a = br"open;\n',
      'let a = c"open;\n',
      "let a = ' ;\n",
      "let a = '\\u{1F600};\n",
      "let a = b'x;\n",
      "let a = r#;\n",
      "/* open /* nested */\n",
    ])
      expect([open, await rustComments("a.rs", open)]).toEqual([open, null]);
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
    writeFiles(dir, { "src/a.ts": "export const a = 1; // why\n", "src/b.js": "/* b */\nexport {};\n" });
    expect(commit(dir)).toEqual({
      status: 1,
      stderr: [
        "no-comments: src/a.ts:1  // why",
        "no-comments: src/b.js:1  /* b */",
        "  Remove each comment; a why belongs in a name, a test or the docs.",
        "",
      ].join("\n"),
    });
    expect(git(dir, ["rev-list", "--count", "HEAD"])).toBe("1");
  });

  test("judges a file whole, not only the lines the commit changes", () => {
    const dir = repo({ "a.ts": "// old\nexport const a = 1;\n" });
    expect(commit(dir).status).toBe(0);
    installGates(dir, ["no-comments-javascript"]);
    expect(commit(dir).status).toBe(0);
    writeFiles(dir, { "a.ts": "// old\nexport const a = 2;\n" });
    expect(commit(dir).stderr).toStartWith("no-comments: a.ts:1  // old\n");
  });

  test("keeps an agent-gate marker in any language, and only the whole marker", () => {
    const dir = gated({ "a.ts": "// agent-gate:no-comments:1\nexport {};\n" });
    expect(commit(dir)).toEqual({ status: 0, stderr: "" });
    writeFiles(dir, { "a.ts": "// agent-gate:no-comments:1 and more\nexport {};\n" });
    expect(commit(dir).stderr).toStartWith("no-comments: a.ts:1  // agent-gate:no-comments:1 and more\n");
    writeFiles(dir, { "a.ts": "export {}; // agent-gate:no-comments:1\n" });
    expect(commit(dir).stderr).toStartWith("no-comments: a.ts:1  // agent-gate:no-comments:1\n");
  });

  test("keeps another tool's gate marker, with or without a part", () => {
    const dir = gated({ "a.ts": "// dim-gate:1\n// other-tool-gate:lint:12\nexport {};\n" });
    expect(commit(dir)).toEqual({ status: 0, stderr: "" });
    writeFiles(dir, { "a.ts": "// dim-gate:one\nexport {};\n" });
    expect(commit(dir).stderr).toStartWith("no-comments: a.ts:1  // dim-gate:one\n");
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
      stderr: [
        "no-comments: bin/tool:2  # why",
        "no-comments: db/a.sql:1  -- why",
        "no-comments: lib/a.dart:1  // why",
        'no-comments: src/a.rs:1  #[doc = "why"]',
        "  Remove each comment; a why belongs in a name, a test or the docs.",
        "",
      ].join("\n"),
    });
  });

  test("refuses a file that does not parse", () => {
    const dir = gated({ "a.ts": "const = ;\n" });
    expect(commit(dir)).toEqual({ status: 1, stderr: "no-comments: a.ts does not parse; fix its syntax\n" });
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
      stderr:
        "no-comments: a.ts:1  // why\n  Remove each comment; a why belongs in a name, a test or the docs.\n",
    });
  });

  test("skips generated, vendored, binary and non-regular files", () => {
    const dir = gated({
      ".gitattributes": "vendor/** linguist-vendored\nsrc/gen.ts linguist-generated\n",
      "vendor/v.js": "// vendored\n",
      "src/gen.ts": "// made by a tool\n",
      "src/header.ts": "// Code GENERATED by a tool\nexport {};\n",
      "src/auto.ts": "// This file is Auto-Generated.\nexport {};\n",
      "src/data.js": "\0// binary\n",
      "README.md": "# Comments here are prose\n",
    });
    symlinkSync("// a link target", join(dir, "src/link.ts"));
    expect(commit(dir)).toEqual({ status: 0, stderr: "" });
    writeFiles(dir, { "src/lower.ts": "// generated by hand\nexport {};\n" });
    expect(commit(dir).stderr).toStartWith("no-comments: src/lower.ts:1");
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
    return { status: run.status, stderr: run.stderr };
  }

  test("judges the files changed since the merge base of the pushed base", () => {
    const dir = gated({ "a.ts": "// old\n" });
    const base = commitPastHooks(dir, "feat: start");
    writeFiles(dir, { "b.ts": "// new\n" });
    const head = commitPastHooks(dir, "feat: more");
    expect(judged(dir, { base, head, ref: "refs/heads/main" })).toEqual({
      status: 1,
      stderr:
        "no-comments: b.ts:1  // new\n  Remove each comment; a why belongs in a name, a test or the docs.\n",
    });
    expect(judged(dir, { base: head, head, ref: "refs/heads/main" })).toEqual({ status: 0, stderr: "" });
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
      stderr:
        "no-comments: b.ts:1  // early\n  Remove each comment; a why belongs in a name, a test or the docs.\n",
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
      stderr:
        "no-comments: a.ts:1  // root\n  Remove each comment; a why belongs in a name, a test or the docs.\n",
    });
  });

  test("judges every file when a new branch reaches a remote with no default branch", () => {
    const dir = gated({ "a.ts": "// root\n" });
    commitPastHooks(dir, "feat: start");
    writeFiles(dir, { "b.ts": "export {};\n" });
    const head = commitPastHooks(dir, "feat: more");
    expect(judged(dir, { base: NO_COMMIT, head, ref: "refs/heads/topic" })).toEqual({
      status: 1,
      stderr:
        "no-comments: a.ts:1  // root\n  Remove each comment; a why belongs in a name, a test or the docs.\n",
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
      stderr:
        "no-comments: b.ts:1  // orphan\n  Remove each comment; a why belongs in a name, a test or the docs.\n",
    });
  });

  test("exits 2 on a call that names a base without a head", () => {
    const dir = gated();
    expect(scan(dir, ["HEAD"])).toEqual({
      status: 2,
      stderr:
        "no-comments: scan.cjs takes no arguments or a base and a head, and got 1: HEAD; node scan.cjs [<base> <head>]\n",
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
    const dir = gated({ "a.ts": "export {};\n", "bin/tool": "#!/usr/bin/env node\n" });
    git(dir, ["add", "-A"]);
    expect(gatesDoctor(dir).checks.at(-1)).toEqual({
      name: "no-comments languages",
      state: "ok",
      detail: "javascript, as the tracked files need",
      fix: null,
    });
    git(dir, ["rm", "-q", "-f", "a.ts", "bin/tool"]);
    writeFiles(dir, { ".gitattributes": "gen.ts linguist-generated\n", "gen.ts": "export {};\n" });
    git(dir, ["add", "-A"]);
    expect(gatesDoctor(dir).checks.at(-1)).toEqual({
      name: "no-comments-javascript",
      state: "warn",
      detail: "installed, but the project tracks no file javascript reads",
      fix: "delete .githooks/no-comments/javascript.cjs",
    });
    expect(gatesDoctor(repo({ "a.ts": "export {};\n" })).checks.map(({ name }) => name)).toEqual(["gates"]);
  });

  test("doctor names every tracked language whose gate is not installed, with one install for all", () => {
    const dir = gated({ "a.ts": "export {};\n", "a.dart": "void f() {}\n", "b.dart": "", "db/a.sql": "" });
    git(dir, ["add", "-A"]);
    expect(gatesDoctor(dir).checks.at(-1)).toEqual({
      name: "no-comments languages",
      state: "warn",
      detail:
        "dart reads 2 tracked files, but no-comments-dart is not installed; sql reads 1 tracked file, but no-comments-sql is not installed",
      fix: "agent-gates install no-comments-dart no-comments-sql",
    });
  });
});
