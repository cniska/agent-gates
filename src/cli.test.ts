import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { removeScratchDirs, repo, scratchDir } from "./repo.test-support";

const CLI = resolve(import.meta.dir, "cli.ts");
const dir = repo();

afterAll(removeScratchDirs);

function cli(...args: string[]) {
  const run = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: "utf8" });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

describe("the cli", () => {
  test("prints one JSON line naming the command and its result", () => {
    expect(cli("doctor")).toEqual({
      status: 0,
      stdout:
        '{"command":"doctor","ok":true,"result":{"checks":[{"name":"gates","state":"warn","detail":"no gate is installed","fix":"agent-gates install <gate>..., choosing from commit-subject, no-comments-javascript, no-comments-dart, no-comments-sql, no-comments-shell, no-comments-rust, no-comments-go, no-comments-python"}],"failing":0}}\n',
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
            "agent-gates install [<gate>...], choosing from commit-subject, no-comments-javascript, no-comments-dart, no-comments-sql, no-comments-shell, no-comments-rust, no-comments-go, no-comments-python",
        },
        resolve:
          "agent-gates install [<gate>...], choosing from commit-subject, no-comments-javascript, no-comments-dart, no-comments-sql, no-comments-shell, no-comments-rust, no-comments-go, no-comments-python",
      },
    });
    expect(cli("doctor").stdout).toBe(before);
  });
});
