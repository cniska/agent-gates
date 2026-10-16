import { lines, type Outcome, refusedWith } from "./cli";

export const LANGUAGES = ["javascript", "dart", "sql", "shell", "rust", "python"];

export const ALL_LANGUAGES = LANGUAGES.map((language) => `no-comments-${language}`);

export const REMOVE = "Remove each comment; a why belongs in a name, a test or the docs.";

export const FIX_SYNTAX = "Fix the syntax where each file stops parsing.";

const SHEBANG = "the first-line shebang, with no `#` word or `\\c` after `#!`";

export const KEPT_JAVASCRIPT = `kept in JavaScript and TypeScript: ${SHEBANG}; a leading \`/// <reference …/>\` holding only its attributes; a gate marker on a line of its own`;

export const KEPT_PYTHON = `kept in Python: ${SHEBANG}; a gate marker on a line of its own`;

export const KEPT_DART = `kept in Dart: ${SHEBANG}; a gate marker on a line of its own`;

export const KEPT_SQL =
  "kept in SQL: drizzle's `--> statement-breakpoint`; a gate marker on a line of its own";

export const KEPT_SHELL = `kept in shell: ${SHEBANG}; a gate marker on a line of its own`;

export const KEPT_RUST = `kept in Rust: ${SHEBANG}; a gate marker on a line of its own`;

type Findings = readonly (readonly [path: string, lines: readonly string[]])[];

export function commentReply(kept: readonly string[], findings: Findings, lead = "this change adds"): string {
  const count = findings.reduce((total, [, found]) => total + found.length, 0);
  return lines([
    `no-comments: ${lead} ${count} ${count === 1 ? "comment" : "comments"}. ${REMOVE}`,
    ...kept,
    ...findings.flatMap(([path, found]) => [path, ...found.map((line) => `  ${line}`)]),
  ]);
}

export function javascriptRefusal(findings: Findings): Outcome {
  return refusedWith(commentReply([KEPT_JAVASCRIPT], findings));
}
