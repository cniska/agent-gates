import {
  checkout,
  commitAs,
  committing,
  type Env,
  git,
  install,
  type Outcome,
  refusedWith,
  writeFiles,
} from "./cli";

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

export function gated(gates: readonly string[], files: Readonly<Record<string, string>> = {}): string {
  const dir = checkout(files);
  install(dir, gates);
  git(dir, ["add", "-A"]);
  commitAs(dir, "chore: start");
  return dir;
}

export function commitStaged(dir: string, paths: readonly string[] = [], env: Env = {}): Outcome {
  return committing(dir, ["-q", "-m", "feat: change things", ...paths], env);
}

export function restart(dir: string, to = "HEAD"): string {
  git(dir, ["reset", "-q", "--hard", to]);
  git(dir, ["clean", "-q", "-f", "-d"]);
  return dir;
}

export function commitFiles(dir: string, files: Readonly<Record<string, string>>): Outcome {
  writeFiles(dir, files);
  git(dir, ["add", "-A"]);
  return commitStaged(dir);
}

export function lines(texts: readonly string[]): string {
  return texts.map((text) => `${text}\n`).join("");
}

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
