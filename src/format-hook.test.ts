import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CodedError } from "./coded-error";
import { gatesDoctor } from "./doctor";
import { installGates } from "./gates";
import { NO_FILLS } from "./gates-contract";
import {
  commit,
  commitPastHooks,
  NOT_ON_GITHUB,
  refusalOf,
  removeScratchDirs,
  repo,
} from "./repo.test-support";

const UPPERCASE = 'for f in *.txt; do tr a-z A-Z < "$f" > "$f.tmp" && mv "$f.tmp" "$f"; done\n';

const FORMAT = { command: "sh fmt.sh", prefixes: null, workflows: null };

const HOOK = ".githooks/pre-commit.d/format";

afterEach(removeScratchDirs);

function formatted(files: Record<string, string> = {}): string {
  const dir = repo({ "fmt.sh": UPPERCASE, ...files });
  installGates(dir, { kind: "gates", gates: ["format"] }, FORMAT, NOT_ON_GITHUB);
  commitPastHooks(dir, "feat: start");
  return dir;
}

function read(dir: string, path: string): string {
  return readFileSync(join(dir, path), "utf8");
}

function git(dir: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
}

function sh(dir: string, args: readonly string[]) {
  const run = spawnSync("sh", args, { cwd: dir, encoding: "utf8" });
  return { status: run.status, stderr: run.stderr };
}

function run(cwd: string, hook: string) {
  return sh(cwd, [hook, "--run"]);
}

function resolveOf(act: () => unknown) {
  try {
    act();
  } catch (error) {
    if (error instanceof CodedError) return { code: error.code, resolve: error.resolve };
    throw error;
  }
  throw new Error("expected a refusal");
}

function doctorCheck(dir: string, name: string) {
  return gatesDoctor(dir).checks.find((found) => found.name === name);
}

function notOk(dir: string) {
  return gatesDoctor(dir).checks.filter(({ state }) => state !== "ok");
}

describe("install format", () => {
  test("refuses without --command, naming it with an example, and writes nothing", () => {
    const dir = repo({ Makefile: "format:\n\ttrue\n", "package.json": '{ "scripts": { "format": "x" } }\n' });
    expect(
      resolveOf(() => installGates(dir, { kind: "gates", gates: ["format"] }, NO_FILLS, NOT_ON_GITHUB)),
    ).toEqual({
      code: "fill_missing",
      resolve: 'agent-gates install format --command "<command>", such as --command "npm run lint:fix"',
    });
    expect(existsSync(join(dir, ".githooks"))).toBe(false);
  });

  test("writes the command into the hook and reports it, installing no workflow, and doctor passes", () => {
    const dir = repo();
    const installed = installGates(dir, { kind: "gates", gates: ["format"] }, FORMAT, NOT_ON_GITHUB);
    expect(installed.fills).toEqual({ command: "sh fmt.sh", prefixes: null, workflows: null });
    expect(installed.files.map(({ target }) => target)).toEqual([
      HOOK,
      ".githooks/.gitattributes",
      ".githooks/pre-commit",
    ]);
    expect(existsSync(join(dir, ".github"))).toBe(false);
    expect(existsSync(join(dir, ".githooks/ci-setup"))).toBe(false);
    expect(read(dir, HOOK)).toContain("\ncommand='sh fmt.sh'\n");
    expect(doctorCheck(dir, "format command")).toEqual({
      name: "format command",
      state: "ok",
      detail: "`sh fmt.sh`; sh is on PATH",
    });
    expect(notOk(dir)).toEqual([]);
  });

  test("reaches a working gate in one more command where the task has another name, changing no project file", () => {
    const dir = repo({ "fmt.sh": UPPERCASE, Makefile: "fmt:\n\t@sh fmt.sh\n" });
    expect(
      refusalOf(() => installGates(dir, { kind: "gates", gates: ["format"] }, NO_FILLS, NOT_ON_GITHUB)),
    ).toBe("fill_missing");
    const before = git(dir, ["status", "--porcelain", "--untracked-files=all"]);
    installGates(
      dir,
      { kind: "gates", gates: ["format"] },
      { command: "make fmt", prefixes: null, workflows: null },
      NOT_ON_GITHUB,
    );
    expect(
      git(dir, ["status", "--porcelain", "--untracked-files=all", "--", ":!.githooks", ":!.github"]),
    ).toBe(before);
    expect(notOk(dir)).toEqual([]);
    commitPastHooks(dir, "feat: start");
    writeFileSync(join(dir, "a.txt"), "hello\n");
    expect(commit(dir, { add: ["a.txt"] })).toEqual({ status: 0, stderr: "" });
    expect(git(dir, ["show", "HEAD:a.txt"])).toBe("HELLO\n");
  });

  test("keeps the command a reinstall is not given, and rewrites one it is given without a backup", () => {
    const dir = repo();
    installGates(
      dir,
      { kind: "gates", gates: ["format"] },
      { command: `printf '%s' "it's"`, prefixes: null, workflows: null },
      NOT_ON_GITHUB,
    );
    expect(installGates(dir, { kind: "none" }, NO_FILLS, NOT_ON_GITHUB).fills).toEqual({
      command: `printf '%s' "it's"`,
      prefixes: null,
      workflows: null,
    });
    expect(
      installGates(dir, { kind: "none" }, NO_FILLS, NOT_ON_GITHUB).files.every(
        ({ state }) => state === "installed",
      ),
    ).toBe(true);
    const again = installGates(
      dir,
      { kind: "none" },
      { command: "cargo fmt", prefixes: null, workflows: null },
      NOT_ON_GITHUB,
    );
    expect(again.fills).toEqual({ command: "cargo fmt", prefixes: null, workflows: null });
    expect(again.files[0]).toEqual({ target: HOOK, state: "reconfigured" });
    expect(read(dir, HOOK)).toContain("\ncommand='cargo fmt'\n");
  });

  test("sets aside a hand-edited hook, reading past its command line", () => {
    const dir = repo();
    installGates(dir, { kind: "gates", gates: ["format"] }, FORMAT, NOT_ON_GITHUB);
    writeFileSync(join(dir, HOOK), `${read(dir, HOOK)}exit 0\n`);
    expect(installGates(dir, { kind: "none" }, NO_FILLS, NOT_ON_GITHUB).files[0]?.state).toBe("changed");
  });

  test("doctor fails a command whose program is not on PATH, and a hook whose command is gone", () => {
    const dir = repo();
    installGates(
      dir,
      { kind: "gates", gates: ["format"] },
      { command: "no-such-formatter --write", prefixes: null, workflows: null },
      NOT_ON_GITHUB,
    );
    expect(doctorCheck(dir, "format command")).toEqual({
      name: "format command",
      state: "fail",
      detail:
        "`no-such-formatter --write`, but no-such-formatter is not on PATH, so the format hook refuses every commit",
      fix: 'install no-such-formatter, or agent-gates install format --command "<command>", such as --command "npm run lint:fix"',
    });
    writeFileSync(
      join(dir, HOOK),
      read(dir, HOOK).replace("command='no-such-formatter --write'", "command=''"),
    );
    expect(doctorCheck(dir, HOOK)).toMatchObject({
      state: "fail",
      detail: `${dir}'s format gate runs the project's own format command, and none was given with --command`,
    });
    expect(doctorCheck(dir, "format command")).toBeUndefined();
  });
});

describe("the format hook", () => {
  test("formats the staged files and commits the result", () => {
    const dir = formatted();
    writeFileSync(join(dir, "a.txt"), "hello\n");
    expect(commit(dir, { add: ["a.txt"] })).toEqual({ status: 0, stderr: "" });
    expect(git(dir, ["show", "HEAD:a.txt"])).toBe("HELLO\n");
    expect(git(dir, ["status", "--porcelain"])).toBe("");
  });

  test("refuses a partly staged file the task changes, staging nothing", () => {
    const dir = formatted({ "a.txt": "A\n" });
    writeFileSync(join(dir, "a.txt"), "ab\n");
    git(dir, ["add", "a.txt"]);
    writeFileSync(join(dir, "a.txt"), "ab\ncd\n");
    const head = git(dir, ["rev-parse", "HEAD"]);
    expect(commit(dir, { add: [] })).toEqual({
      status: 1,
      stderr:
        "format: `sh fmt.sh` changes these partly staged files, so the commit would not be formatted; stage each whole or not at all, then commit again:\n  a.txt\n",
    });
    expect(git(dir, ["rev-parse", "HEAD"])).toBe(head);
    expect(git(dir, ["show", ":a.txt"])).toBe("ab\n");
  });

  test("runs before every other pre-commit step, so a later step sees the formatted file", () => {
    const dir = formatted({
      ".githooks/pre-commit.d/check":
        'git show :a.txt | grep -qx HELLO || { echo "check saw an unformatted a.txt" >&2; exit 1; }\n',
    });
    chmodSync(join(dir, ".githooks/pre-commit.d/check"), 0o755);
    writeFileSync(join(dir, "a.txt"), "hello\n");
    expect(commit(dir, { add: ["a.txt"] })).toEqual({ status: 0, stderr: "" });
    expect(git(dir, ["show", "HEAD:a.txt"])).toBe("HELLO\n");
  });

  test("commits a partly staged file the task leaves alone", () => {
    const dir = formatted({ "a.txt": "A\n" });
    writeFileSync(join(dir, "a.txt"), "AB\n");
    git(dir, ["add", "a.txt"]);
    writeFileSync(join(dir, "a.txt"), "AB\nCD\n");
    expect(commit(dir, { add: [] })).toEqual({ status: 0, stderr: "" });
    expect(git(dir, ["show", "HEAD:a.txt"])).toBe("AB\n");
  });

  test("leaves another file the task changed in the worktree, and lists it", () => {
    const dir = formatted({ "b.txt": "B\n" });
    writeFileSync(join(dir, "a.txt"), "a\n");
    writeFileSync(join(dir, "b.txt"), "bc\n");
    expect(commit(dir, { add: ["a.txt"] })).toEqual({
      status: 0,
      stderr:
        "format: `sh fmt.sh` also changed these files the commit leaves out; they stay in the worktree:\n  b.txt\n",
    });
    expect(git(dir, ["show", "HEAD:b.txt"])).toBe("B\n");
    expect(read(dir, "b.txt")).toBe("BC\n");
    expect(git(dir, ["status", "--porcelain"])).toBe(" M b.txt\n");
  });

  test("refuses when the task fails, showing its output", () => {
    const dir = repo({ "broken.sh": "echo broken >&2\nexit 3\n" });
    installGates(
      dir,
      { kind: "gates", gates: ["format"] },
      { command: "sh broken.sh", prefixes: null, workflows: null },
      NOT_ON_GITHUB,
    );
    commitPastHooks(dir, "feat: start");
    writeFileSync(join(dir, "a.txt"), "a\n");
    expect(commit(dir, { add: ["a.txt"] })).toEqual({
      status: 1,
      stderr: "format: `sh broken.sh` failed:\nbroken\n",
    });
    expect(git(dir, ["rev-list", "--count", "HEAD"])).toBe("1\n");
  });

  test("in --run, runs the command from the checkout root and exits with its status, staging nothing", () => {
    const dir = formatted({ "a.txt": "A\n", "sub/keep.txt": "keep\n" });
    writeFileSync(join(dir, "b.txt"), "b\n");
    git(dir, ["add", "b.txt"]);
    writeFileSync(join(dir, "b.txt"), "bc\n");
    expect(run(join(dir, "sub"), "../.githooks/pre-commit.d/format")).toEqual({ status: 0, stderr: "" });
    expect([read(dir, "b.txt"), read(dir, "sub/keep.txt")]).toEqual(["BC\n", "keep\n"]);
    expect(git(dir, ["status", "--porcelain"])).toBe("AM b.txt\n");
    expect(git(dir, ["show", ":b.txt"])).toBe("b\n");
    writeFileSync(join(dir, "fmt.sh"), "echo broken >&2\nexit 3\n");
    expect(run(dir, HOOK)).toEqual({ status: 3, stderr: "broken\n" });
  });
});
