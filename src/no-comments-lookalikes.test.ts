import { describe, expect, test } from "bun:test";
import { ADAPTERS } from "./no-comments-adapters.test-support";
import type { Keep } from "./no-comments-keep";
import { keepOf } from "./no-comments-keep.test-support";
import type { Language } from "./no-comments-languages";
import { findings } from "./no-comments-scan";

type Lookalike = { readonly language: Language; readonly path: string; readonly text: string };

const PATHS: Readonly<Record<Language, string>> = {
  javascript: "a.ts",
  dart: "a.dart",
  sql: "a.sql",
  shell: "a.sh",
  rust: "a.rs",
  python: "a.py",
};

const CODE: Readonly<Record<Language, string>> = {
  javascript: "let a = 1;\n",
  dart: "void f() {}\n",
  sql: "select 1;\n",
  shell: "echo\n",
  rust: "fn f() {}\n",
  python: "x = 1\n",
};

function at(language: Language, comment: string): Lookalike {
  return { language, path: PATHS[language], text: `${comment}\n${CODE[language]}` };
}

const NO_KEEP = keepOf(null);

const KEEP = keepOf(
  [
    'javascript /// <reference types="[a-z]+" />',
    "javascript // agent-gate:[a-z-]+:[0-9]+",
    "javascript /\\*.*",
    "sql --> statement-breakpoint",
    "sql -- [a-z]+-gate:(?:[a-z-]+:)?[0-9]+",
    "shell # agent-gate:[a-z-]+:[0-9]+",
    "shell # v1",
    "python # agent-gate:[a-z-]+:[0-9]+",
    "dart // x-gate:[0-9]+",
    "rust // x-gate:[0-9]+",
    "",
  ].join("\n"),
);

const INTERPRETER_LINES: readonly Lookalike[] = [
  at("python", "#!/usr/bin/env python3"),
  at("python", "#!/usr/bin/env -S python3 -u"),
  at("shell", "#!/usr/bin/env -S bash -e"),
  at("javascript", "#!/usr/bin/env -S node --no-warnings"),
  at("dart", "#!/usr/bin/env dart"),
  at("rust", "#!/usr/bin/env -S cargo +nightly -Zscript"),
  at("shell", "#!/opt/a#b/bin/sh -e"),
];

const ORDINARY_SHEBANGS: readonly Lookalike[] = [
  at("shell", " #!/bin/sh"),
  at("shell", "#!/usr/bin/env -S bash -e # because reasons"),
  at("shell", "#!/usr/bin/env -S bash -e\t#because"),
  at("shell", "#!/usr/bin/env -S bash -e \\c because reasons"),
  at("shell", "#!#/bin/sh"),
  at("javascript", "#!/usr/bin/env -S node # because reasons"),
  at("dart", "#!/usr/bin/env -S dart \\c because reasons"),
  at("rust", "#!/usr/bin/env -S cargo -Zscript # because reasons"),
  at("python", "#!/usr/bin/env -S python3 -u # because reasons"),
  at("python", "#!/usr/bin/env -S python3 -u \\c because reasons"),
  { language: "shell", path: "a.sh", text: "echo\n#!/bin/sh\n" },
  at("python", " #!/usr/bin/env python3"),
];

const KEPT_BY_PATTERN: readonly Lookalike[] = [
  at("javascript", '/// <reference types="bun" />'),
  at("javascript", '/// <reference types="bun" />   '),
  at("javascript", "// agent-gate:no-comments:1"),
  at("javascript", "  // agent-gate:no-comments:1"),
  at("javascript", "\uFEFF// agent-gate:no-comments:1"),
  at("javascript", "/* agent-gate:no-comments:1 */"),
  { language: "javascript", path: "a.ts", text: "let a = 1; // agent-gate:no-comments:1\n" },
  at("sql", "--> statement-breakpoint  "),
  at("sql", "-- agent-gate:no-comments:1"),
  at("sql", "-- x-gate:1"),
  at("shell", "# agent-gate:no-comments:1"),
  at("shell", "# v1"),
  at("python", "# agent-gate:no-comments-python:3"),
  at("dart", "// x-gate:1"),
  at("rust", "// x-gate:1"),
];

const NEAR_MISSES: readonly Lookalike[] = [
  at("javascript", '/// <reference types="bun" /> why'),
  at("javascript", '/// <reference types="node" because="Buffer" />'),
  at("javascript", "//agent-gate:no-comments:1"),
  at("javascript", "// agent-gate:no-comments:1 and more"),
  at("javascript", "/* agent-gate:no-comments:1\n*/"),
  at("sql", "--   > statement-breakpoint"),
  at("sql", "---> statement-breakpoint"),
  at("sql", "--> statement-breakpoint and why"),
  at("shell", "# v1 why"),
  at("shell", "# shellcheck disable=SC2034"),
  at("python", "# v1"),
  at("dart", "/// x-gate:1"),
  at("rust", "//! x-gate:1"),
];

const REFUSED_WITHOUT_KEEP: readonly Lookalike[] = [
  ...KEPT_BY_PATTERN,
  at("javascript", "// @ts-expect-error"),
  at("javascript", "// eslint-disable-next-line no-console"),
  at("javascript", "// biome-ignore lint/a/b: reason"),
  at("javascript", "// prettier-ignore"),
  { language: "javascript", path: "a.ts", text: "let a = /* #__PURE__ */ f();\n" },
  at("dart", "// ignore: unused_import"),
  at("dart", "//@dart=2.12"),
  at("python", "# noqa: F401"),
  at("python", "# type: ignore[attr-defined]"),
  at("python", "# pyright: ignore[reportAttributeAccessIssue]"),
  at("python", "# fmt: off"),
  at("python", "# pragma: no cover"),
  at("python", "# -*- coding: latin-1 -*-"),
  at("python", "# coding=cp1252"),
  at("python", '"""A docstring."""'),
  at("javascript", "// SPDX-License-Identifier: MIT"),
  at("shell", "# SPDX-License-Identifier: (GPL-2.0-or-later WITH Linux-syscall-note) OR MIT"),
];

function refusedCount({ path, text }: Lookalike, keep: Keep): number {
  const file = { path, text };
  const found = findings(
    { heads: [{ file, base: null }], bases: [] },
    (language) => ADAPTERS[language],
    keep,
  );
  return found.reduce((sum, finding) => sum + (finding.kind === "comments" ? finding.comments.length : 1), 0);
}

function counted(lookalikes: readonly Lookalike[], keep: Keep): (readonly [string, number])[] {
  return lookalikes.map((lookalike) => [lookalike.text, refusedCount(lookalike, keep)] as const);
}

function each(lookalikes: readonly Lookalike[], count: number): (readonly [string, number])[] {
  return lookalikes.map(({ text }) => [text, count] as const);
}

describe("a first-line interpreter line", () => {
  test("is not judged, with or without a keep file", () => {
    expect(counted(INTERPRETER_LINES, NO_KEEP)).toEqual(each(INTERPRETER_LINES, 0));
    expect(counted(INTERPRETER_LINES, KEEP)).toEqual(each(INTERPRETER_LINES, 0));
  });

  test("is an ordinary comment off line 1, or with a # word or \\c after #!", () => {
    expect(counted(ORDINARY_SHEBANGS, NO_KEEP)).toEqual(each(ORDINARY_SHEBANGS, 1));
    expect(counted(ORDINARY_SHEBANGS, KEEP)).toEqual(each(ORDINARY_SHEBANGS, 1));
  });
});

describe("keep patterns", () => {
  test("keep a comment a pattern of its language matches whole, once trimmed", () => {
    expect(counted(KEPT_BY_PATTERN, KEEP)).toEqual(each(KEPT_BY_PATTERN, 0));
  });

  test("refuse each near miss, another language's pattern and a block spanning lines", () => {
    expect(counted(NEAR_MISSES, KEEP)).toEqual(each(NEAR_MISSES, 1));
  });

  test("leave every comment refused when no keep file exists", () => {
    expect(counted(REFUSED_WITHOUT_KEEP, NO_KEEP)).toEqual(each(REFUSED_WITHOUT_KEEP, 1));
  });
});
