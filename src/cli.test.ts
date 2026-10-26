import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decode } from "@toon-format/toon";
import { removeScratchDirs, repo, scratchDir } from "./repo.test-support";

const CLI = resolve(import.meta.dir, "cli.ts");
const dir = repo();

const INSTALL_USAGE =
  "agent-gates install [<gate>] [--command <format command>] [--prefixes <a,b,c>] [--full], choosing from commit-subject, format, no-comments-javascript, no-comments-dart, no-comments-sql, no-comments-shell, no-comments-rust, no-comments-python, no-comments-yaml, no-comments-swift, no-secrets, pinned-actions, no-comments (each language the tracked files hold)";

const INSTALL_GATES =
  "agent-gates install <gate>, once per gate, choosing from commit-subject, format, no-comments-javascript, no-comments-dart, no-comments-sql, no-comments-shell, no-comments-rust, no-comments-python, no-comments-yaml, no-comments-swift, no-secrets, pinned-actions, no-comments (each language the tracked files hold)";

const NO_FILE_STATES = {
  installed: 0,
  missing: 0,
  behind: 0,
  changed: 0,
  ahead: 0,
  "not-executable": 0,
  reconfigured: 0,
};

afterAll(removeScratchDirs);

function cliIn(cwd: string, ...args: string[]) {
  const run = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

function cli(...args: string[]) {
  return cliIn(dir, ...args);
}

describe("the cli", () => {
  test("prints TOON naming the command and its result, leading a list with the count in each state", () => {
    expect(cli("doctor")).toEqual({
      status: 0,
      stdout: [
        "command: doctor",
        "ok: true",
        "result:",
        "  counts:",
        "    ok: 0",
        "    warn: 1",
        "    fail: 0",
        "  checks[1]{name,state,detail}:",
        "    gates,warn,no gate is installed",
        "  fixes[1]{name,fix}:",
        `    gates,"${INSTALL_GATES}"`,
        "",
      ].join("\n"),
      stderr: "",
    });
    const installed = cli("install", "commit-subject");
    expect(installed.status).toBe(0);
    expect(decode(installed.stdout)).toMatchObject({ command: "install", ok: true });
  });

  test("lists no null field by default, and every field with --full", () => {
    const changed = repo({ ".github/workflows/commits.yml": "name: Commits\n" });
    const files = [
      ".githooks/commit-msg",
      ".github/workflows/commits.yml",
      ".githooks/.gitattributes",
      ".githooks/pre-push",
      ".githooks/pre-push.d/commit-subject",
      ".githooks/judge-push",
    ];
    const backup = ".github/workflows/commits.yml.agent-gates-backup";
    const stateOf = (target: string) => (target === ".github/workflows/commits.yml" ? "changed" : "missing");
    expect(decode(cliIn(changed, "install", "commit-subject").stdout)).toEqual({
      command: "install",
      ok: true,
      result: {
        counts: { ...NO_FILE_STATES, missing: 5, changed: 1 },
        gates: ["commit-subject"],
        files: files.map((target) => ({ target, state: stateOf(target) })),
        backups: [{ target: ".github/workflows/commits.yml", backup }],
        prepare: "absent",
        fills: { command: null, prefixes: null },
      },
    });
    writeFileSync(join(changed, ".github/workflows/commits.yml"), "name: Commits\n");
    expect(decode(cliIn(changed, "install", "--full").stdout)).toMatchObject({
      result: {
        files: files.map((target) =>
          target === ".github/workflows/commits.yml"
            ? { target, state: "changed", backup: `${backup}-2` }
            : { target, state: "installed", backup: null },
        ),
      },
    });
    expect(decode(cliIn(changed, "install").stdout)).toMatchObject({ result: { backups: [] } });
    const full = decode(cliIn(changed, "doctor", "--full").stdout);
    expect(full).toMatchObject({ result: { counts: { ok: 10, warn: 0, fail: 0 } } });
    expect(full).not.toHaveProperty("result.fixes");
    expect(full).toMatchObject({
      result: {
        checks: expect.arrayContaining([{ name: "gates", state: "ok", detail: "commit-subject", fix: null }]),
      },
    });
    expect(cliIn(changed, "--full")).toMatchObject({ status: 2, stdout: "" });
  });

  test("exits 1 when the doctor finds a failing check, still printing the report", () => {
    cli("install", "commit-subject");
    execFileSync("git", ["-C", dir, "config", "--unset", "core.hooksPath"]);
    const run = cli("doctor");
    expect(run.status).toBe(1);
    expect(decode(run.stdout)).toMatchObject({
      command: "doctor",
      ok: true,
      result: {
        counts: { fail: 1 },
        fixes: [{ name: "hooksPath", fix: "agent-gates install" }],
      },
    });
    cli("install");
  });

  test("exits 2 on an unknown command", () => {
    const run = cli("uninstall");
    expect([run.status, run.stdout]).toEqual([2, ""]);
    expect(decode(run.stderr)).toMatchObject({ error: { kind: "usage" } });
  });

  test("exits 3 with a fault when git cannot run, so nothing was judged", () => {
    const run = spawnSync(process.execPath, [CLI, "doctor"], {
      cwd: dir,
      encoding: "utf8",
      env: { PATH: scratchDir() },
    });
    expect([run.status, run.stdout]).toEqual([3, ""]);
    expect(decode(run.stderr)).toMatchObject({
      command: "doctor",
      ok: false,
      error: {
        kind: "fault",
        code: "git_unavailable",
        resolve: "stop and hand this error to the owner: git must be installed and on PATH",
      },
    });
  });

  test("install no-comments installs the gate for each language the tracked files hold, and the gates of its hooks and workflows", () => {
    const tracked = repo({ "a.ts": "export {};\n", "db/a.sql": "select 1;\n", "b.py": "", "notes.txt": "" });
    execFileSync("git", ["-C", tracked, "add", "a.ts", "db/a.sql", "notes.txt"]);
    const run = cliIn(tracked, "install", "no-comments");
    expect([run.status, run.stderr]).toEqual([0, ""]);
    expect(decode(run.stdout)).toMatchObject({
      result: {
        gates: ["no-comments-javascript", "no-comments-sql", "no-comments-shell", "no-comments-yaml"],
      },
    });
    expect(existsSync(join(tracked, ".githooks/no-comments/python.cjs"))).toBe(false);
  });

  test("install no-comments refuses when the tracked files hold no language, and writes nothing", () => {
    const bare = repo({ "notes.txt": "" });
    execFileSync("git", ["-C", bare, "add", "-A"]);
    const run = cliIn(bare, "install", "no-comments");
    expect([run.status, run.stdout]).toEqual([1, ""]);
    expect(decode(run.stderr)).toMatchObject({
      error: {
        kind: "refusal",
        code: "no_language_tracked",
        message: `${realpathSync(bare)} tracks no file a no-comments gate reads, so there is no language to install`,
      },
    });
    expect(existsSync(join(bare, ".githooks"))).toBe(false);
  });

  test("exits 2 on --command without format named, without a command, or repeated, writing nothing", () => {
    const bare = repo();
    for (const args of [
      ["--command", "cargo fmt"],
      ["format", "--command"],
      ["commit-subject", "--command", "x"],
      ["format", "--command", "x", "--command", "y"],
    ]) {
      const run = cliIn(bare, "install", ...args);
      expect([args, run.status, decode(run.stderr)]).toMatchObject([
        args,
        2,
        { error: { code: "flag_misplaced" } },
      ]);
    }
    for (const flag of ["--fix", "--setup"]) {
      const unknown = cliIn(bare, "install", "format", "--command", "x", flag, "pnpm install");
      expect([unknown.status, decode(unknown.stderr)]).toMatchObject([
        2,
        { error: { meta: { names: [flag] } } },
      ]);
    }
    expect(existsSync(join(bare, ".githooks"))).toBe(false);
    const set = cliIn(bare, "install", "format", "--command", "cargo fmt");
    expect([set.status, decode(set.stdout)]).toMatchObject([
      0,
      { result: { fills: { command: "cargo fmt", prefixes: null } } },
    ]);
  });

  test("exits 2 on an unknown gate, printing the usage on stderr and writing nothing", () => {
    const before = cli("doctor").stdout;
    const run = cli("install", "lint-free");
    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(decode(run.stderr)).toEqual({
      command: "install",
      ok: false,
      error: {
        kind: "usage",
        code: "unknown_gate",
        message: "agent-gates install has no gate named lint-free",
        meta: { names: ["lint-free"], usage: INSTALL_USAGE },
        resolve: INSTALL_USAGE,
      },
    });
    expect(cli("doctor").stdout).toBe(before);
  });
});
