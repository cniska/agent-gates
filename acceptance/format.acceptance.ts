import { afterEach, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  agentGates,
  bypassing,
  check,
  checkout,
  commitAs,
  committing,
  doctor,
  field,
  git,
  githubStep,
  gitRan,
  jsonLine,
  readText,
  removeScratch,
  stepScript,
  writeFiles,
} from "./cli";

afterEach(removeScratch);

const UPPERCASE = 'for f in *.txt; do tr a-z A-Z < "$f" > "$f.tmp" && mv "$f.tmp" "$f"; done\n';

const HOOK = ".githooks/pre-commit.d/format";

const WORKFLOW = ".github/workflows/format.yml";

const SETUP = ".githooks/ci-setup";

const FILES = [HOOK, WORKFLOW, SETUP, ".githooks/.gitattributes", ".githooks/pre-commit"];

const NAME_THE_COMMAND =
  'agent-gates install format --command "<command>", such as --command "npm run lint:fix"';

const NAME_THE_SETUP =
  'agent-gates install format --setup "<command>", such as --setup "mise install && pnpm install --frozen-lockfile"';

const SETUP_STEP = "Set up the project as agent-gates install --setup named";

const CHECK_STEP = "Run the format command the hook installs, and refuse what it changes";

function each(state: string) {
  return FILES.map((target) => ({ target, state, backup: null }));
}

function installed(dir: string, args: readonly string[]): unknown {
  const ran = agentGates(dir, ["install", ...args]);
  expect([ran.status, ran.stderr]).toEqual([0, ""]);
  return field(jsonLine(ran.stdout), "result");
}

function usageCode(dir: string, args: readonly string[]): readonly unknown[] {
  const ran = agentGates(dir, ["install", ...args]);
  return [args, ran.status, field(field(jsonLine(ran.stderr), "error"), "code")];
}

function formatted(files: Readonly<Record<string, string>> = {}): string {
  const dir = checkout({ "fmt.sh": UPPERCASE, ...files });
  installed(dir, ["format", "--command", "sh fmt.sh"]);
  git(dir, ["add", "-A"]);
  commitAs(dir, "chore: start");
  return dir;
}

function commitStaged(dir: string) {
  return committing(dir, ["-q", "-m", "feat: change"]);
}

function stepRun(dir: string, name: string): string {
  return stepScript(readText(dir, WORKFLOW), name);
}

test("AC-30 refuses format without --command, which then installs a working gate", () => {
  const declared = checkout({
    Makefile: "format:\n\ttrue\n",
    "package.json": '{ "scripts": { "format": "true" } }\n',
    "bun.lock": "",
  });
  const refused = agentGates(declared, ["install", "format"]);
  expect([refused.status, refused.stdout]).toEqual([1, ""]);
  expect(jsonLine(refused.stderr)).toEqual({
    command: "install",
    ok: false,
    error: {
      kind: "refusal",
      code: "fill_missing",
      message: `${declared}'s format gate runs the project's own format command, and none was given with --command`,
      meta: { root: declared, fill: "command" },
      resolve: NAME_THE_COMMAND,
    },
  });
  expect(readdirSync(declared).sort()).toEqual([".git", "Makefile", "bun.lock", "package.json"]);

  const dir = checkout({ "fmt.sh": UPPERCASE, Makefile: "fmt:\n\t@sh fmt.sh\n" });
  const before = git(dir, ["status", "--porcelain", "--untracked-files=all"]);
  expect(installed(dir, ["format", "--command", "make fmt"])).toEqual({
    gates: ["format"],
    files: each("missing"),
    prepare: "absent",
    fills: { command: "make fmt", setup: null },
  });
  expect(git(dir, ["status", "--porcelain", "--untracked-files=all", "--", ":!.githooks", ":!.github"])).toBe(
    before,
  );
  git(dir, ["add", "-A"]);
  commitAs(dir, "chore: start");
  writeFiles(dir, { "a.txt": "hello\n" });
  git(dir, ["add", "a.txt"]);
  expect(commitStaged(dir)).toEqual({ status: 0, stderr: "", made: true });
  expect(git(dir, ["show", "HEAD:a.txt"])).toBe("HELLO");
});

test("AC-31 keeps the commands a reinstall is not given, and rewrites one it is", () => {
  const dir = checkout();
  installed(dir, ["format", "--command", "sh fmt.sh", "--setup", "pnpm install"]);
  expect(installed(dir, [])).toMatchObject({
    files: each("installed"),
    fills: { command: "sh fmt.sh", setup: "pnpm install" },
  });
  expect(installed(dir, ["format", "--command", "cargo fmt"])).toMatchObject({
    files: [{ target: HOOK, state: "reconfigured", backup: null }, ...each("installed").slice(1)],
    fills: { command: "cargo fmt", setup: "pnpm install" },
  });
  expect(readText(dir, HOOK)).toContain("\ncommand='cargo fmt'\n");
  expect(readdirSync(join(dir, ".githooks/pre-commit.d"))).toEqual(["format"]);

  const bare = checkout();
  for (const args of [
    ["--command", "cargo fmt"],
    ["commit-subject", "--setup", "pnpm install"],
    ["format", "--command"],
    ["format", "--setup"],
    ["format", "--command", "x", "--command", "y"],
    ["format", "--command", "x", "--setup", "a", "--setup", "b"],
  ])
    expect(usageCode(bare, args)).toEqual([args, 2, "flag_misplaced"]);
  expect(existsSync(join(bare, ".githooks"))).toBe(false);
});

test("AC-32 formats the commit, refusing a partly staged file the command changes", () => {
  const dir = formatted({ "b.txt": "B\n", "c.txt": "C\n" });
  writeFiles(dir, { "a.txt": "hello\n" });
  git(dir, ["add", "a.txt"]);
  expect(commitStaged(dir)).toEqual({ status: 0, stderr: "", made: true });
  expect(git(dir, ["show", "HEAD:a.txt"])).toBe("HELLO");

  writeFiles(dir, { "b.txt": "Bc\n" });
  git(dir, ["add", "b.txt"]);
  writeFiles(dir, { "b.txt": "Bc\nD\n" });
  expect(commitStaged(dir)).toEqual({
    status: 1,
    stderr:
      "format: `sh fmt.sh` changes these partly staged files, so the commit would not be formatted; stage each whole or not at all, then commit again:\n  b.txt\n",
    made: false,
  });
  expect(git(dir, ["show", ":b.txt"])).toBe("Bc");

  writeFiles(dir, { "b.txt": "BC\n" });
  git(dir, ["add", "b.txt"]);
  writeFiles(dir, { "b.txt": "BC\nD\n" });
  expect(commitStaged(dir)).toEqual({ status: 0, stderr: "", made: true });
  expect(git(dir, ["show", "HEAD:b.txt"])).toBe("BC");
  bypassing(dir, ["commit", "-qam", "chore: settle"]);

  writeFiles(dir, { "a.txt": "HELLO\nTHERE\n", "c.txt": "cc\n" });
  git(dir, ["add", "a.txt"]);
  expect(commitStaged(dir)).toEqual({
    status: 0,
    stderr:
      "format: `sh fmt.sh` also changed these files the commit leaves out; they stay in the worktree:\n  c.txt\n",
    made: true,
  });
  expect([git(dir, ["show", "HEAD:c.txt"]), readText(dir, "c.txt")]).toEqual(["C", "CC\n"]);
  git(dir, ["checkout", "--", "c.txt"]);

  writeFiles(dir, { "fmt.sh": "echo broken >&2\nexit 3\n", "d.txt": "D\n" });
  git(dir, ["add", "d.txt"]);
  expect(commitStaged(dir)).toEqual({
    status: 1,
    stderr: "format: `sh fmt.sh` failed:\nbroken\n",
    made: false,
  });
  git(dir, ["reset", "-q"]);
  git(dir, ["checkout", "--", "fmt.sh"]);
  git(dir, ["clean", "-qf"]);

  git(dir, ["checkout", "-qb", "side"]);
  writeFiles(dir, { "a.txt": "SIDE\n" });
  bypassing(dir, ["commit", "-qam", "chore: side"]);
  git(dir, ["checkout", "-q", "main"]);
  writeFiles(dir, { "a.txt": "MAIN\n" });
  bypassing(dir, ["commit", "-qam", "chore: main"]);
  expect(gitRan(dir, ["merge", "-q", "side"]).status).toBe(1);
  writeFiles(dir, { "a.txt": "merged\n" });
  git(dir, ["add", "a.txt"]);
  expect(committing(dir, ["-q", "--no-edit"])).toEqual({ status: 0, stderr: "", made: true });
  expect(git(dir, ["show", "HEAD:a.txt"])).toBe("merged");
});

test("AC-33 runs the CI setup, then refuses unformatted files", () => {
  const dir = formatted({ "a.txt": "A\n" });
  const setup = stepRun(dir, SETUP_STEP);
  expect(setup).toBe(`sh ${SETUP}`);
  expect(githubStep(dir, setup, {})).toEqual({ status: 0, stdout: "", stderr: "" });
  expect(existsSync(join(dir, "out.log"))).toBe(false);
  installed(dir, ["format", "--setup", "echo set up > out.log"]);
  expect(githubStep(dir, setup, {})).toEqual({ status: 0, stdout: "", stderr: "" });
  expect(readText(dir, "out.log")).toBe("set up\n");
  git(dir, ["add", "-A"]);
  bypassing(dir, ["commit", "-qm", "chore: set up"]);

  const formatCheck = stepRun(dir, CHECK_STEP);
  expect(githubStep(dir, formatCheck, {})).toEqual({ status: 0, stdout: "", stderr: "" });
  writeFiles(dir, { "b.txt": "b\n" });
  git(dir, ["add", "b.txt"]);
  bypassing(dir, ["commit", "-qm", "chore: add b"]);
  expect(githubStep(dir, formatCheck, {})).toEqual({
    status: 1,
    stdout: "",
    stderr: "format: `sh fmt.sh` changes these files; run it and commit the result:\n  b.txt\n",
  });
});

test("AC-34 checks the commands' programs are on PATH, and fails a hook with no command", () => {
  const dir = checkout();
  installed(dir, ["format", "--command", "no-such-formatter --write"]);
  expect(doctor(dir).status).toBe(1);
  expect(check(dir, "format command")).toEqual({
    name: "format command",
    state: "fail",
    detail:
      "`no-such-formatter --write`, but no-such-formatter is not on PATH, so the format hook refuses every commit",
    fix: `install no-such-formatter, or ${NAME_THE_COMMAND}`,
  });
  expect(check(dir, "CI setup")).toEqual({
    name: "CI setup",
    state: "warn",
    detail: "no setup command is installed, so the format workflow runs on a bare checkout",
    fix: NAME_THE_SETUP,
  });
  installed(dir, ["format", "--command", "sh fmt.sh", "--setup", "no-such-tool install"]);
  expect(check(dir, "format command")?.state).toBe("ok");
  expect(check(dir, "CI setup")).toEqual({
    name: "CI setup",
    state: "warn",
    detail: "`no-such-tool install`, but no-such-tool is not on PATH here, so CI may not find it either",
    fix: `install no-such-tool, or ${NAME_THE_SETUP}`,
  });
  writeFiles(dir, { [HOOK]: readText(dir, HOOK).replace("command='sh fmt.sh'", "command=''") });
  expect(check(dir, HOOK)).toEqual({
    name: HOOK,
    state: "fail",
    detail: `${dir}'s format gate runs the project's own format command, and none was given with --command`,
    fix: NAME_THE_COMMAND,
  });
  expect(check(dir, "format command")).toBeUndefined();
});
