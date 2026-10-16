import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { removeScratchDirs, repo, scratchDir } from "./repo.test-support";

const CLI = resolve(import.meta.dir, "cli.ts");
const dir = repo();

afterAll(removeScratchDirs);

function cliIn(cwd: string, ...args: string[]) {
  const run = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

function cli(...args: string[]) {
  return cliIn(dir, ...args);
}

describe("the cli", () => {
  test("prints one JSON line naming the command and its result", () => {
    expect(cli("doctor")).toEqual({
      status: 0,
      stdout:
        '{"command":"doctor","ok":true,"result":{"checks":[{"name":"gates","state":"warn","detail":"no gate is installed","fix":"agent-gates install <gate>, once per gate, choosing from commit-subject, format, no-comments-javascript, no-comments-dart, no-comments-sql, no-comments-shell, no-comments-rust, no-comments-python, no-secrets, pinned-actions, no-comments (each language the tracked files hold)"}],"failing":0}}\n',
      stderr: "",
    });
    const installed = cli("install", "commit-subject");
    expect(installed.status).toBe(0);
    expect(JSON.parse(installed.stdout)).toMatchObject({ command: "install", ok: true });
  });

  test("exits 1 when the doctor finds a failing check, still printing the report", () => {
    cli("install", "commit-subject");
    execFileSync("git", ["-C", dir, "config", "--unset", "core.hooksPath"]);
    const run = cli("doctor");
    expect(run.status).toBe(1);
    expect(JSON.parse(run.stdout)).toMatchObject({ command: "doctor", ok: true, result: { failing: 1 } });
    cli("install");
  });

  test("exits 2 on an unknown command", () => {
    const run = cli("uninstall");
    expect([run.status, run.stdout, JSON.parse(run.stderr).error.kind]).toEqual([2, "", "usage"]);
  });

  test("exits 3 with a fault when git cannot run, so nothing was judged", () => {
    const run = spawnSync(process.execPath, [CLI, "doctor"], {
      cwd: dir,
      encoding: "utf8",
      env: { PATH: scratchDir() },
    });
    expect([run.status, run.stdout]).toEqual([3, ""]);
    expect(JSON.parse(run.stderr)).toMatchObject({
      command: "doctor",
      ok: false,
      error: {
        kind: "fault",
        code: "git_unavailable",
        resolve: "stop and hand this error to the owner: git must be installed and on PATH",
      },
    });
  });

  test("install no-comments installs the gate for each language the tracked files hold", () => {
    const tracked = repo({ "a.ts": "export {};\n", "db/a.sql": "select 1;\n", "b.py": "", "notes.txt": "" });
    execFileSync("git", ["-C", tracked, "add", "a.ts", "db/a.sql", "notes.txt"]);
    const run = cliIn(tracked, "install", "no-comments");
    expect([run.status, run.stderr]).toEqual([0, ""]);
    expect(JSON.parse(run.stdout).result.gates).toEqual(["no-comments-javascript", "no-comments-sql"]);
    expect(existsSync(join(tracked, ".githooks/no-comments/python.cjs"))).toBe(false);
  });

  test("install no-comments refuses when the tracked files hold no language, and writes nothing", () => {
    const bare = repo({ "notes.txt": "" });
    execFileSync("git", ["-C", bare, "add", "-A"]);
    const run = cliIn(bare, "install", "no-comments");
    expect([run.status, run.stdout]).toEqual([1, ""]);
    expect(JSON.parse(run.stderr).error).toMatchObject({
      kind: "refusal",
      code: "no_language_tracked",
      message: `${realpathSync(bare)} tracks no file a no-comments gate reads, so there is no language to install`,
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
      expect([args, run.status, JSON.parse(run.stderr).error.code]).toEqual([args, 2, "flag_misplaced"]);
    }
    for (const flag of ["--fix", "--setup"]) {
      const unknown = cliIn(bare, "install", "format", "--command", "x", flag, "pnpm install");
      expect([unknown.status, JSON.parse(unknown.stderr).error.meta.names]).toEqual([2, [flag]]);
    }
    expect(existsSync(join(bare, ".githooks"))).toBe(false);
    const set = cliIn(bare, "install", "format", "--command", "cargo fmt");
    expect([set.status, JSON.parse(set.stdout).result.fills]).toEqual([
      0,
      { command: "cargo fmt", prefixes: null },
    ]);
  });

  test("exits 2 on an unknown gate, printing the usage on stderr and writing nothing", () => {
    const before = cli("doctor").stdout;
    const run = cli("install", "lint-free");
    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(JSON.parse(run.stderr)).toEqual({
      command: "install",
      ok: false,
      error: {
        kind: "usage",
        code: "unknown_gate",
        message: "agent-gates install has no gate named lint-free",
        meta: {
          names: ["lint-free"],
          usage:
            "agent-gates install [<gate>] [--command <format command>] [--prefixes <a,b,c>], choosing from commit-subject, format, no-comments-javascript, no-comments-dart, no-comments-sql, no-comments-shell, no-comments-rust, no-comments-python, no-secrets, pinned-actions, no-comments (each language the tracked files hold)",
        },
        resolve:
          "agent-gates install [<gate>] [--command <format command>] [--prefixes <a,b,c>], choosing from commit-subject, format, no-comments-javascript, no-comments-dart, no-comments-sql, no-comments-shell, no-comments-rust, no-comments-python, no-secrets, pinned-actions, no-comments (each language the tracked files hold)",
      },
    });
    expect(cli("doctor").stdout).toBe(before);
  });
});
