import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SOURCES = resolve(import.meta.dir, "..", "gates");
const NO_COMMIT = "0000000000000000000000000000000000000000";
const repos: string[] = [];

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

const workflow: unknown = Bun.YAML.parse(readFileSync(join(SOURCES, "commits.yml"), "utf8"));
const steps = field(field(field(workflow, "jobs"), "commits"), "steps");

function script(id: string): string {
  const step = Array.isArray(steps) ? steps.find((found) => field(found, "id") === id) : undefined;
  const run = field(step, "run");
  if (typeof run !== "string") throw new Error(`commits.yml has no step with id ${id}`);
  return run;
}

const RESOLVE = script("range");
const JUDGE = script("judge");
const AUTOSQUASH = {
  "fixup! ": "fixup! feat: start",
  "squash! ": "squash! feat: start",
  "amend! ": "amend! feat: start\n\nfeat: start over",
};

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-gates-workflow-"));
  repos.push(dir);
  execFileSync("git", ["init", "-q", dir]);
  mkdirSync(join(dir, ".githooks"));
  copyFileSync(join(SOURCES, "commit-msg"), join(dir, ".githooks/commit-msg"));
  return dir;
}

function commit(dir: string, subject: string): string {
  execFileSync("git", [
    "-C",
    dir,
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "user.name=T",
    "-c",
    "user.email=t@example.com",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    subject,
  ]);
  return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"]).toString().trim();
}

function bash(dir: string, run: string, env: Record<string, string>) {
  const ran = spawnSync("bash", ["-e", "-c", run], {
    cwd: dir,
    env: { ...process.env, ...env, RUNNER_TEMP: dir },
    encoding: "utf8",
  });
  return { status: ran.status, stderr: ran.stderr };
}

function rangeOf(dir: string, base: string, head: string): string {
  const output = join(dir, "output");
  writeFileSync(output, "");
  expect(bash(dir, RESOLVE, { BASE_SHA: base, HEAD_SHA: head, GITHUB_OUTPUT: output }).status).toBe(0);
  return readFileSync(output, "utf8")
    .replace(/^range=/, "")
    .trim();
}

function judged(dir: string, range: string) {
  return bash(dir, JUDGE, { RANGE: range });
}

afterEach(() => {
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the commits workflow", () => {
  test("judges every commit after the pushed base", () => {
    const dir = repo();
    const base = commit(dir, "feat: start");
    commit(dir, "Add a bad subject");
    const head = commit(dir, "fix: follow up");
    const range = rangeOf(dir, base, head);
    expect(range).toBe(`${base}..${head}`);
    expect(judged(dir, range).stderr).toContain("got: Add a bad subject");
  });

  test("judges the head alone when the base names no commit, even a root commit", () => {
    const dir = repo();
    const root = commit(dir, "Start badly");
    expect(rangeOf(dir, NO_COMMIT, root)).toBe(root);
    expect(judged(dir, root).stderr).toContain("got: Start badly");
    const head = commit(dir, "feat: carry on");
    expect(rangeOf(dir, NO_COMMIT, head)).toBe(`${head}^..${head}`);
    expect(judged(dir, `${head}^..${head}`)).toEqual({ status: 0, stderr: "" });
  });

  test("fails when the range names no commits, rather than judging nothing", () => {
    const dir = repo();
    commit(dir, "feat: start");
    expect(judged(dir, `${NO_COMMIT}..HEAD`).status).not.toBe(0);
  });

  test("refuses each autosquash commit left in the range that the hook lets through locally", () => {
    for (const [prefix, message] of Object.entries(AUTOSQUASH)) {
      const dir = repo();
      const base = commit(dir, "feat: start");
      const head = commit(dir, message);
      writeFileSync(join(dir, "MESSAGE"), `${message}\n`);
      expect([prefix, bash(dir, "sh .githooks/commit-msg MESSAGE", {}).status]).toEqual([prefix, 0]);
      expect(judged(dir, `${base}..${head}`).stderr).toContain("is an autosquash commit left in the range");
    }
  });
});
