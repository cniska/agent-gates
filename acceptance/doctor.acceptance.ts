import { afterEach, expect, test } from "bun:test";
import { chmodSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  agentGates,
  type Check,
  check,
  checkout,
  each,
  git,
  hooksPath,
  install,
  installs,
  jsonLine,
  refuses,
  removeScratch,
  writeFiles,
} from "./cli";

afterEach(removeScratch);

const INSTALL_USAGE =
  "agent-gates install <gate>, once per gate, choosing from commit-subject, format, no-comments-javascript, no-comments-dart, no-comments-sql, no-comments-shell, no-comments-rust, no-comments-python, no-comments (each language the tracked files hold)";

const NO_PACKAGE_JSON = "no package.json, so each contributor runs git config core.hooksPath .githooks once";

const NO_COMMENTS_FILES = [
  ".githooks/.gitattributes",
  ".githooks/pre-commit",
  ".githooks/pre-push",
  ".githooks/pre-commit.d/no-comments",
  ".githooks/pre-push.d/no-comments",
  ".githooks/no-comments/scan.cjs",
  ".github/workflows/no-comments.yml",
  ".githooks/judge-push",
];

function doctorReports(dir: string, checks: readonly Check[]): void {
  const ran = agentGates(dir, ["doctor"]);
  expect([ran.status, ran.stderr]).toEqual([0, ""]);
  expect(jsonLine(ran.stdout)).toEqual({ command: "doctor", ok: true, result: { checks, failing: 0 } });
}

function passing(name: string, detail: string): Check {
  return { name, state: "ok", detail, fix: null };
}

test("AC-11 reports no gate, then every check passing", () => {
  const dir = checkout();
  doctorReports(dir, [{ name: "gates", state: "warn", detail: "no gate is installed", fix: INSTALL_USAGE }]);

  install(dir, ["commit-subject"]);
  install(dir, ["no-comments-javascript"]);
  writeFiles(dir, { "src/a.ts": "export const a = 1;\n" });
  git(dir, ["add", "-A"]);
  doctorReports(dir, [
    passing("gates", "commit-subject, no-comments-javascript"),
    ...[
      ".githooks/commit-msg",
      ".github/workflows/commits.yml",
      ".githooks/.gitattributes",
      ".githooks/pre-push",
      ".githooks/pre-push.d/commit-subject",
      ".githooks/judge-push",
      ".githooks/pre-commit",
      ".githooks/pre-commit.d/no-comments",
      ".githooks/pre-push.d/no-comments",
      ".githooks/no-comments/scan.cjs",
      ".github/workflows/no-comments.yml",
      ".githooks/no-comments/javascript.cjs",
    ].map((name) => passing(name, "installed")),
    passing("hooksPath", "core.hooksPath is .githooks"),
    passing("prepare", NO_PACKAGE_JSON),
    passing("commit prefixes", "none installed, so the gate allows its default set"),
    passing("no-comments languages", "javascript, as the tracked files need"),
    passing("no-comments backlog", "the tracked files hold no comment"),
  ]);
});

test("AC-12 warns of tracked languages without a gate and gates without a language", () => {
  const dir = checkout({ "a.ts": "export const a = 1;\n", "b.py": "x = 1\n" });
  install(dir, ["no-comments-javascript"]);
  install(dir, ["no-comments-rust"]);
  git(dir, ["add", "-A"]);
  doctorReports(dir, [
    passing("gates", "no-comments-javascript, no-comments-rust"),
    ...[...NO_COMMENTS_FILES, ".githooks/no-comments/javascript.cjs", ".githooks/no-comments/rust.cjs"].map(
      (name) => passing(name, "installed"),
    ),
    passing("hooksPath", "core.hooksPath is .githooks"),
    passing("prepare", NO_PACKAGE_JSON),
    {
      name: "no-comments languages",
      state: "warn",
      detail:
        "python reads 1 tracked file, but no-comments-python is not installed; no-comments-rust is installed, but the project tracks no file rust reads",
      fix: "agent-gates install no-comments; delete .githooks/no-comments/rust.cjs",
    },
    passing("no-comments backlog", "the tracked files hold no comment"),
  ]);
});

test("AC-13 counts the comments tracked files hold, through the installed adapters alone", () => {
  const dir = checkout({
    "a.ts": "export const a = 1; // a\n",
    "c.ts": "export const b = 2; /* b */\nexport const c = 3; // c\n",
    "bad.ts": "export const = ;\n",
    "b.py": "x = 1  # read by no installed adapter\n",
  });
  install(dir, ["no-comments-javascript"]);
  git(dir, ["add", "-A"]);
  writeFiles(dir, { "untracked.ts": "export const d = 4; // untracked\n" });
  expect(check(dir, "no-comments backlog")).toEqual({
    name: "no-comments backlog",
    state: "warn",
    detail: "the tracked files hold 3 comments, and 1 file does not parse",
    fix: "node .githooks/no-comments/scan.cjs --all lists each one",
  });

  git(dir, ["rm", "-q", "--cached", "c.ts", "bad.ts"]);
  rmSync(join(dir, "c.ts"));
  writeFiles(dir, { "a.ts": "export const a = 1;\n" });
  git(dir, ["add", "a.ts"]);
  expect(check(dir, "no-comments backlog")).toEqual(
    passing("no-comments backlog", "the tracked files hold no comment"),
  );

  writeFiles(dir, {
    "a.ts": "export const a = 1; // a\n",
    ".githooks/no-comments/scan.cjs": "module.exports = {};\n",
  });
  git(dir, ["add", "a.ts"]);
  expect(check(dir, "no-comments backlog")).toEqual({
    name: "no-comments backlog",
    state: "warn",
    detail:
      "not counted while these differ from this agent-gates, since the count runs them: .githooks/no-comments/scan.cjs",
    fix: "agent-gates install",
  });
});

test("AC-29 installs the gate of each tracked language, and refuses when none is tracked", () => {
  const dir = checkout({ "a.ts": "export const a = 1;\n", "b.py": "x = 1\n" });
  git(dir, ["add", "-A"]);
  doctorReports(dir, [
    { name: "gates", state: "warn", detail: "no gate is installed", fix: INSTALL_USAGE },
    {
      name: "no-comments languages",
      state: "warn",
      detail:
        "javascript reads 1 tracked file, but no-comments-javascript is not installed; python reads 1 tracked file, but no-comments-python is not installed",
      fix: "agent-gates install no-comments",
    },
  ]);

  installs(dir, ["no-comments"], {
    gates: ["no-comments-javascript", "no-comments-python"],
    files: each("missing", [
      ...NO_COMMENTS_FILES,
      ".githooks/no-comments/javascript.cjs",
      ".githooks/no-comments/python.cjs",
    ]),
    prepare: "absent",
  });

  const untyped = checkout({ "notes.txt": "a note\n" });
  git(untyped, ["add", "-A"]);
  refuses(untyped, ["no-comments"], {
    kind: "refusal",
    code: "no_language_tracked",
    message: `${untyped} tracks no file a no-comments gate reads, so there is no language to install`,
    meta: { root: untyped },
    resolve: `stop and ask the owner which gates the project runs, then ${INSTALL_USAGE}`,
  });
  expect(readdirSync(untyped).sort()).toEqual([".git", "notes.txt"]);
  expect(hooksPath(untyped)).toBe("");
});

test("AC-38 warns of the project's own hook steps no workflow runs", () => {
  const dir = checkout();
  install(dir, ["commit-subject"]);
  expect(check(dir, "hook steps")).toBeUndefined();
  writeFiles(dir, {
    ".githooks/pre-commit.d/lint": "#!/bin/sh\nnpm run lint\n",
    ".githooks/pre-push.d/test": "#!/bin/sh\nnpm test\n",
    ".githooks/pre-commit.d/notes": "#!/bin/sh\nexit 1\n",
    ".githooks/pre-commit.d/marked": "#!/bin/sh\n# agent-gate:format:1\n",
  });
  for (const step of ["pre-commit.d/lint", "pre-push.d/test", "pre-commit.d/marked"])
    chmodSync(join(dir, ".githooks", step), 0o755);
  const steps = ".githooks/pre-commit.d/lint, .githooks/pre-push.d/test";
  writeFiles(dir, { ".github/workflows/lint.yml": "      - run: .githooks/pre-commit.d/lint-fix\n" });
  expect(check(dir, "hook steps")).toEqual({
    name: "hook steps",
    state: "warn",
    detail: `no workflow in .github/workflows runs ${steps}, so CI never checks what it refuses`,
    fix: `add a workflow step that runs ${steps}`,
  });
  writeFiles(dir, {
    ".github/workflows/steps.yml":
      "jobs:\n  steps:\n    steps:\n      - run: .githooks/pre-commit.d/lint && .githooks/pre-push.d/test\n",
  });
  expect(check(dir, "hook steps")).toEqual({
    name: "hook steps",
    state: "ok",
    detail: `a workflow runs ${steps}`,
    fix: null,
  });
});
