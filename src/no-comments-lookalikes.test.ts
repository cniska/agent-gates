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
};

const CODE: Readonly<Record<Language, string>> = {
  javascript: "let a = 1;\n",
  dart: "void f() {}\n",
  sql: "select 1;\n",
  shell: "echo\n",
  rust: "fn f() {}\n",
};

function at(language: Language, comment: string): Lookalike {
  return { language, path: PATHS[language], text: `${comment}\n${CODE[language]}` };
}

const KEPT: readonly Lookalike[] = [
  at("javascript", "// @ts-expect-error   "),
  at("javascript", "//* @ts-expect-error"),
  { language: "javascript", path: "a.js", text: "// @ts-check\nlet a = 1;\n" },
  { language: "javascript", path: "a.ts", text: "let a = 1; // eslint-disable-line no-console\n" },
  at("javascript", "// eslint-disable-next-line no-console"),
  at("javascript", "/* eslint-disable no-console */"),
  at("javascript", "// biome-ignore lint/a/b:reason"),
  at("javascript", "// biome-ignore lint/a/b: -x"),
  { language: "javascript", path: "a.ts", text: "let a = 1; /* prettier-ignore */\n" },
  { language: "javascript", path: "a.ts", text: "let a = 1; // prettier-ignore   \n" },
  { language: "javascript", path: "a.ts", text: "let a = /* #__PURE__ */ f();\n" },
  { language: "javascript", path: "a.ts", text: "// #__PURE__   \nf();\n" },
  at("javascript", "/** @vitest-environment jsdom */"),
  at("javascript", "// @vitest-environment jsdom   "),
  at("javascript", '/// <reference types="bun" />'),
  at("dart", "// ignore:unused_import"),
  at("dart", "/// ignore: x"),
  at("dart", "// ignore_for_file: unused_import"),
  at("dart", "//@dart=2.12"),
  at("shell", "# shellcheck source=x   "),
  at("shell", "#shellcheck source=x # why"),
  at("sql", "--> statement-breakpoint  "),
];

const REFUSED: readonly Lookalike[] = [
  at("javascript", "// @ts-expect-errorx"),
  at("javascript", "// @ts-check"),
  { language: "javascript", path: "a.js", text: "let a = 1;\n// @ts-check\n" },
  at("javascript", "// eslint-disable-next-line"),
  at("javascript", "// eslint-disable no-console"),
  at("javascript", "/* eslint-disable */"),
  at("javascript", "// biome-ignore lint/a/b reason"),
  at("javascript", "// prettier-ignore because"),
  at("javascript", "/* prettier-ignore\n */"),
  { language: "javascript", path: "a.ts", text: "let a = /* #__PURE__ x */ f();\n" },
  at("javascript", "/** @vitest-environment */"),
  { language: "javascript", path: "a.ts", text: 'let a = 1;\n/// <reference types="bun" />\n' },
  at("dart", "/* ignore: x */"),
  at("dart", "////ignore: x"),
  at("dart", "///@dart=2.12"),
  at("dart", "// @dart = 2.12 because"),
  at("shell", "##shellcheck source=x"),
  at("shell", "# shellcheck source=x because"),
  at("sql", "--   > statement-breakpoint"),
  at("sql", "---> statement-breakpoint"),
];

const SHARED_KEPT: readonly Lookalike[] = [
  at("javascript", "// agent-gate:no-comments:1"),
  at("shell", "# agent-gate:no-comments:1"),
  at("dart", "// x-gate:1"),
  at("rust", "// x-gate:1"),
  at("sql", "-- agent-gate:no-comments:1"),
  at("sql", "-- x-gate:1"),
  at("javascript", "/* SPDX-License-Identifier: MIT **/"),
  at("dart", "/* SPDX-License-Identifier: MIT **/"),
  at("sql", "/* SPDX-License-Identifier: MIT **/"),
  at("rust", "/* SPDX-License-Identifier: MIT **/"),
  at("dart", "// SPDX-License-Identifier: MIT"),
  at("shell", "#### SPDX-License-Identifier: MIT OR Apache-2.0"),
  at("sql", "--- SPDX-License-Identifier: MIT"),
];

const SHARED_REFUSED: readonly Lookalike[] = [
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
];

function refusedByAdapter({ language, path, text }: Lookalike): number {
  const reading = ADAPTERS[language].comments(path, text, () => false);
  expect([text, reading.kind]).toEqual([text, "read"]);
  return reading.kind === "read" ? reading.comments.length : -1;
}

function refusedByScan({ path, text }: Lookalike): number {
  const file = { path, text, tracked: () => false };
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
