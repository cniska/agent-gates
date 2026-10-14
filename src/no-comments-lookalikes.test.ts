import { describe, expect, test } from "bun:test";
import { ADAPTERS } from "./no-comments-adapters.test-support";
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

const KEPT: readonly Lookalike[] = [
  at("javascript", '/// <reference types="bun" />'),
  at("javascript", '/// <reference types="bun" />   '),
  at("sql", "--> statement-breakpoint  "),
  at("python", "#!/usr/bin/env python3"),
  at("python", "#!/usr/bin/env -S python3 -u"),
  at("shell", "#!/usr/bin/env -S bash -e"),
  at("javascript", "#!/usr/bin/env -S node --no-warnings"),
  at("dart", "#!/usr/bin/env dart"),
  at("rust", "#!/usr/bin/env -S cargo +nightly -Zscript"),
  at("shell", "#!/opt/a#b/bin/sh -e"),
];

const REFUSED: readonly Lookalike[] = [
  at("javascript", "// @ts-expect-error"),
  at("javascript", "// eslint-disable-next-line no-console"),
  at("javascript", "// biome-ignore lint/a/b: reason"),
  at("javascript", "// prettier-ignore"),
  { language: "javascript", path: "a.ts", text: "let a = /* #__PURE__ */ f();\n" },
  { language: "javascript", path: "a.ts", text: 'let a = 1;\n/// <reference types="bun" />\n' },
  at("javascript", '/// <reference types="bun" /> why'),
  at("dart", "// ignore: unused_import"),
  at("dart", "//@dart=2.12"),
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
  at("sql", "--   > statement-breakpoint"),
  at("sql", "---> statement-breakpoint"),
  at("python", "# noqa: F401"),
  at("python", "# type: ignore[attr-defined]"),
  at("python", "# pyright: ignore[reportAttributeAccessIssue]"),
  at("python", "# fmt: off"),
  at("python", "# pragma: no cover"),
  at("python", " #!/usr/bin/env python3"),
  at("python", "# -*- coding: latin-1 -*-"),
  at("python", "# coding=cp1252"),
  at("python", '"""A docstring."""'),
];

const SHARED_KEPT: readonly Lookalike[] = [
  at("javascript", "// agent-gate:no-comments:1"),
  at("shell", "# agent-gate:no-comments:1"),
  at("dart", "// x-gate:1"),
  at("rust", "// x-gate:1"),
  at("python", "# agent-gate:no-comments:1"),
  at("javascript", "\uFEFF// agent-gate:no-comments:1"),
  at("sql", "-- agent-gate:no-comments:1"),
  at("sql", "-- x-gate:1"),
  at("shell", "# x-gate:lint:12"),
  at("python", "# agent-gate:no-comments-python:3"),
];

const SHARED_REFUSED: readonly Lookalike[] = [
  at("javascript", "/* SPDX-License-Identifier: MIT **/"),
  at("dart", "/* SPDX-License-Identifier: MIT **/"),
  at("sql", "/* SPDX-License-Identifier: MIT **/"),
  at("rust", "/* SPDX-License-Identifier: MIT **/"),
  at("dart", "// SPDX-License-Identifier: MIT"),
  at("shell", "#### SPDX-License-Identifier: MIT OR Apache-2.0"),
  at("sql", "--- SPDX-License-Identifier: MIT"),
  at("javascript", "// SPDX-License-Identifier: GPL-2.0-only WITH Classpath-exception-2.0"),
  at("shell", "# SPDX-License-Identifier: (GPL-2.0-or-later WITH Linux-syscall-note) OR MIT"),
  at("javascript", "  // agent-gate:no-comments:1"),
  at("javascript", "/* agent-gate:no-comments:1 */"),
  at("javascript", "//agent-gate:no-comments:1"),
  at("shell", "  # agent-gate:no-comments:1"),
  at("dart", "/// x-gate:1"),
  at("rust", "/// x-gate:1"),
  at("rust", "//! x-gate:1"),
  at("sql", "--- agent-gate:no-comments:1"),
  at("sql", "/* agent-gate:no-comments:1 */"),
  at("javascript", "// SPDX-License-Identifier: MIT because"),
  at("shell", "# this-is-a-hack-because-of-bug-gate:1"),
  at("shell", "# hack-gate:this-is-a-hack:1"),
  at("python", "# agent-gate:because-reasons:1"),
  at("javascript", "// SPDX-License-Identifier: MIT WITH this-was-a-workaround"),
  at("javascript", "// SPDX-License-Identifier: (GPL-2.0-only WITH because-reasons)"),
];

function refusedByAdapter({ language, path, text }: Lookalike): number {
  const reading = ADAPTERS[language].comments(path, text);
  expect([text, reading.kind]).toEqual([text, "read"]);
  return reading.kind === "read" ? reading.comments.length : -1;
}

function refusedByScan({ path, text }: Lookalike): number {
  const file = { path, text };
  const found = findings({ heads: [{ file, base: null }], bases: [] }, (language) => ADAPTERS[language]);
  return found.reduce((sum, finding) => sum + (finding.kind === "comments" ? finding.comments.length : 1), 0);
}

describe("directive lookalikes", () => {
  test("keeps each form a tool reads, whatever blanks or block delimiters surround it", () => {
    for (const lookalike of KEPT)
      expect([lookalike.text, refusedByAdapter(lookalike)]).toEqual([lookalike.text, 0]);
  });

  test("refuses each near miss", () => {
    for (const lookalike of REFUSED)
      expect([lookalike.text, refusedByAdapter(lookalike)]).toEqual([lookalike.text, 1]);
  });

  test("keeps the shared forms in every language that can write them", () => {
    for (const lookalike of SHARED_KEPT)
      expect([lookalike.path, lookalike.text, refusedByScan(lookalike)]).toEqual([
        lookalike.path,
        lookalike.text,
        0,
      ]);
  });

  test("refuses each near miss of a shared form", () => {
    for (const lookalike of SHARED_REFUSED)
      expect([lookalike.path, lookalike.text, refusedByScan(lookalike)]).toEqual([
        lookalike.path,
        lookalike.text,
        1,
      ]);
  });
});
