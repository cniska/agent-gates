import { afterEach, expect, test } from "bun:test";
import { chmodSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  AWS_KEY,
  agentGates,
  type Check,
  check,
  checkout,
  doctor,
  each,
  fingerprint,
  git,
  hooksPath,
  install,
  installs,
  pathOf,
  pathWithNode18,
  refuses,
  removeScratchDirs,
  shell,
  toonOf,
  writeFiles,
} from "./cli";

afterEach(removeScratchDirs);

const INSTALL_USAGE =
  "agent-gates install <gate>, once per gate, choosing from commit-subject, format, no-comments-javascript, no-comments-dart, no-comments-sql, no-comments-shell, no-comments-rust, no-comments-python, no-comments-yaml, no-comments-swift, no-secrets, pinned-actions, no-comments (each language the tracked files hold)";

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
  const ran = agentGates(dir, ["doctor", "--full"]);
  expect([ran.status, ran.stderr]).toEqual([0, ""]);
  const count = (state: string) => checks.filter((reported) => reported.state === state).length;
  const counts = { ok: count("ok"), warn: count("warn"), fail: count("fail") };
  expect(toonOf(ran.stdout)).toEqual({ command: "doctor", ok: true, result: { counts, checks } });
}

function passing(name: string, detail: string): Check {
  return { name, state: "ok", detail, fix: null };
}

function systemNode(): string {
  return shell(checkout(), "node --version").stdout.trim();
}

test("AC-11 reports no gate, then every check passing", () => {
  const dir = checkout();
  doctorReports(dir, [{ name: "gates", state: "warn", detail: "no gate is installed", fix: INSTALL_USAGE }]);

  install(dir, ["commit-subject"]);
  install(dir, ["no-comments-javascript"]);
  install(dir, ["no-comments-shell"]);
  install(dir, ["no-comments-yaml"]);
  writeFiles(dir, { "src/a.ts": "export const a = 1;\n" });
  git(dir, ["add", "-A"]);
  doctorReports(dir, [
    passing("gates", "commit-subject, no-comments-javascript, no-comments-shell, no-comments-yaml"),
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
      ".githooks/no-comments/shell.cjs",
      ".githooks/no-comments/yaml.cjs",
    ].map((name) => passing(name, "installed")),
    passing("hooksPath", "core.hooksPath is .githooks"),
    passing("prepare", NO_PACKAGE_JSON),
    passing("commit prefixes", "none installed, so the gate allows its default set"),
    passing("workflows", "none installed, so install writes the gates' workflows"),
    passing("node", `node ${systemNode()} is on PATH`),
    passing("no-comments languages", "javascript, shell, yaml, as the tracked files need"),
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
    passing("workflows", "none installed, so install writes the gates' workflows"),
    passing("node", `node ${systemNode()} is on PATH`),
    {
      name: "no-comments languages",
      state: "warn",
      detail:
        "shell reads 5 tracked files, but no-comments-shell is not installed; python reads 1 tracked file, but no-comments-python is not installed; yaml reads 1 tracked file, but no-comments-yaml is not installed; no-comments-rust is installed, but the project tracks no file rust reads",
      fix: "agent-gates install no-comments; delete .githooks/no-comments/rust.cjs",
    },
    passing("no-comments backlog", "the tracked files hold no comment"),
  ]);
});

test("AC-13 counts the comments tracked files hold and no pattern keeps, through the installed adapters alone", () => {
  const dir = checkout({
    "a.ts": "export const a = 1; // a\n",
    "k.ts": "// agent-gate:no-comments:1\nexport const k = 1;\n",
    ".no-comments-keep": "javascript // agent-gate:[a-z-]+:[0-9]+\n",
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

  install(dir, ["no-comments-javascript"]);
  writeFiles(dir, { ".no-comments-keep": "javascript // agent-gate:[a-z-]+:[0-9]+\njavascript (\n" });
  git(dir, ["add", ".no-comments-keep"]);
  expect(check(dir, "no-comments backlog")).toEqual({
    name: "no-comments backlog",
    state: "fail",
    detail: ".no-comments-keep line 2 holds a regex that does not compile: javascript (",
    fix: "write each line of .no-comments-keep as a language (javascript, dart, sql, shell, rust, python, yaml, swift), one space and a regex that compiles, blank lines aside",
  });
});

test("AC-29 installs the gate of each tracked language and of the files it writes, and refuses when none is tracked", () => {
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
    gates: ["no-comments-javascript", "no-comments-shell", "no-comments-python", "no-comments-yaml"],
    files: each("missing", [
      ...NO_COMMENTS_FILES,
      ".githooks/no-comments/javascript.cjs",
      ".githooks/no-comments/shell.cjs",
      ".githooks/no-comments/python.cjs",
      ".githooks/no-comments/yaml.cjs",
      ".no-comments-keep",
    ]),
    prepare: "absent",
  });
  git(dir, ["add", "-A"]);
  expect(check(dir, "no-comments languages")).toEqual(
    passing("no-comments languages", "javascript, shell, python, yaml, as the tracked files need"),
  );

  const untyped = checkout({ "notes.txt": "a note\n" });
  git(untyped, ["add", "-A"]);
  refuses(untyped, ["no-comments"], {
    kind: "refusal",
    code: "no_language_tracked",
    message: `${untyped} tracks no file a no-comments gate reads, so there is no language to install`,
    meta: { root: untyped },
    resolve: `stop and ask the owner which gates the project runs, then ${INSTALL_USAGE}`,
  });
  expect(readdirSync(untyped).toSorted()).toEqual([".git", "notes.txt"]);
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

test("AC-59 counts the secrets tracked files hold that the allow file does not name", () => {
  const dir = checkout({ "src/aws.ts": `const key = "${AWS_KEY}";\n` });
  install(dir, ["no-secrets"]);
  git(dir, ["add", "-A"]);
  expect(check(dir, "no-secrets backlog")).toEqual({
    name: "no-secrets backlog",
    state: "warn",
    detail: "the tracked files hold 1 secret",
    fix: "node .githooks/no-secrets/scan.cjs --all lists each one",
  });

  writeFiles(dir, { ".no-secrets-allow": `${fingerprint("aws-access-token", "src/aws.ts", AWS_KEY)}\n` });
  git(dir, ["add", "-A"]);
  expect(check(dir, "no-secrets backlog")).toEqual(
    passing("no-secrets backlog", "the tracked files hold no secret"),
  );

  writeFiles(dir, { ".githooks/no-secrets/scan.cjs": "// agent-gate:no-secrets:1\n" });
  expect(check(dir, "no-secrets backlog")).toEqual({
    name: "no-secrets backlog",
    state: "warn",
    detail:
      "not counted while this differs from this agent-gates, since the count runs it: .githooks/no-secrets/scan.cjs",
    fix: "agent-gates install",
  });
});

test("AC-74 fails its node check while node is missing, cannot report its version or is older than 20, and has none without a gate that runs node", () => {
  const dir = checkout();
  install(dir, ["no-secrets"]);
  git(dir, ["add", "-A"]);
  const node18 = doctor(dir, { PATH: pathWithNode18(["git", "sh"]) });
  expect(node18.status).toBe(1);
  expect(node18.checks.find(({ name }) => name === "node")).toEqual({
    name: "node",
    state: "fail",
    detail: "node --version prints v18.20.4, not 20 or later, so no-secrets judges nothing",
    fix: "install Node.js 20 or later",
  });

  const withoutNode = doctor(dir, { PATH: pathOf(["git", "sh"]) });
  expect(withoutNode.status).toBe(1);
  expect(withoutNode.checks.find(({ name }) => name === "node")).toEqual({
    name: "node",
    state: "fail",
    detail: "node is not on PATH, so no-secrets judges nothing",
    fix: "install Node.js 20 or later",
  });

  const failingNode = pathOf(["git", "sh"]);
  writeFiles(failingNode, { node: "#!/bin/sh\necho 'no version is set' >&2\nexit 126\n" });
  chmodSync(join(failingNode, "node"), 0o755);
  const failing = doctor(dir, { PATH: failingNode });
  expect(failing.status).toBe(1);
  expect(failing.checks.find(({ name }) => name === "node")).toEqual({
    name: "node",
    state: "fail",
    detail: "node --version exits 126, so no-secrets judges nothing",
    fix: "install Node.js 20 or later",
  });

  const unrunnableNode = pathOf(["git", "sh"]);
  writeFiles(unrunnableNode, { node: "#!/nonexistent/sh\n" });
  chmodSync(join(unrunnableNode, "node"), 0o755);
  const unrunnable = doctor(dir, { PATH: unrunnableNode });
  expect(unrunnable.status).toBe(1);
  expect(unrunnable.checks.find(({ name }) => name === "node")).toEqual({
    name: "node",
    state: "fail",
    detail: "node --version cannot run: ENOENT, so no-secrets judges nothing",
    fix: "install Node.js 20 or later",
  });

  expect(check(dir, "node")).toEqual(passing("node", `node ${systemNode()} is on PATH`));

  const unscanned = checkout();
  install(unscanned, ["commit-subject"]);
  expect(check(unscanned, "node")).toBeUndefined();
});
