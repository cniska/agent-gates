import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dir, "cli.ts");
const repo = mkdtempSync(join(tmpdir(), "agent-gates-cli-"));
execFileSync("git", ["init", "-q", repo]);

afterAll(() => rmSync(repo, { recursive: true, force: true }));

function cli(...args: string[]) {
  const run = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, encoding: "utf8" });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

describe("the cli", () => {
  test("prints one JSON line naming the command and its result", () => {
    expect(cli("doctor")).toEqual({
      status: 0,
      stdout:
        '{"command":"doctor","ok":true,"result":{"checks":[{"name":"gates","state":"warn","detail":"no gate is installed","fix":"agent-gates install <gate>..., choosing from commit-subject, no-comments-javascript, no-comments-dart, no-comments-sql, no-comments-shell"}],"failing":0}}\n',
      stderr: "",
    });
    const installed = cli("install", "commit-subject");
    expect(installed.status).toBe(0);
    expect(JSON.parse(installed.stdout)).toMatchObject({ command: "install", ok: true });
  });

  test("exits 1 when the doctor finds a failing check, still printing the report", () => {
    cli("install", "commit-subject");
    execFileSync("git", ["-C", repo, "config", "--unset", "core.hooksPath"]);
    const run = cli("doctor");
    expect(run.status).toBe(1);
    expect(JSON.parse(run.stdout)).toMatchObject({ command: "doctor", ok: true, result: { failing: 1 } });
    cli("install");
  });

  test("refuses an unknown gate on stderr with the usage, and writes nothing", () => {
    const before = cli("doctor").stdout;
    const run = cli("install", "lint-free");
    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    expect(JSON.parse(run.stderr)).toEqual({
      command: "install",
      ok: false,
      error: {
        code: "usage",
        message: "agent-gates install has no gate named lint-free",
        meta: {},
        resolve:
          "agent-gates install [<gate>...], choosing from commit-subject, no-comments-javascript, no-comments-dart, no-comments-sql, no-comments-shell",
      },
    });
    expect(cli("doctor").stdout).toBe(before);
  });
});
