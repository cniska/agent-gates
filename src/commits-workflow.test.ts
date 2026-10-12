import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SOURCE_DIR } from "./gates";
import { commitPastHooks, NO_COMMIT, removeScratchDirs, repo } from "./repo.test-support";

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

const workflow: unknown = Bun.YAML.parse(readFileSync(join(SOURCE_DIR, "commits.yml"), "utf8"));
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

function hookedRepo(): string {
  const dir = repo();
  mkdirSync(join(dir, ".githooks"));
  copyFileSync(join(SOURCE_DIR, "commit-msg"), join(dir, ".githooks/commit-msg"));
  return dir;
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

afterEach(removeScratchDirs);

describe("the commits workflow", () => {
  test("judges every commit after the pushed base", () => {
    const dir = hookedRepo();
    const base = commitPastHooks(dir, "feat: start");
    commitPastHooks(dir, "Add a bad subject");
    const head = commitPastHooks(dir, "fix: follow up");
    const range = rangeOf(dir, base, head);
    expect(range).toBe(`${base}..${head}`);
    expect(judged(dir, range).stderr).toContain("got: Add a bad subject");
  });

  test("judges the head alone when the base names no commit, even a root commit", () => {
    const dir = hookedRepo();
    const root = commitPastHooks(dir, "Start badly");
    expect(rangeOf(dir, NO_COMMIT, root)).toBe(root);
    expect(judged(dir, root).stderr).toContain("got: Start badly");
    const head = commitPastHooks(dir, "feat: carry on");
    expect(rangeOf(dir, NO_COMMIT, head)).toBe(`${head}^..${head}`);
    expect(judged(dir, `${head}^..${head}`)).toEqual({ status: 0, stderr: "" });
  });

  test("fails when the range names no commits, rather than judging nothing", () => {
    const dir = hookedRepo();
    commitPastHooks(dir, "feat: start");
    expect(judged(dir, `${NO_COMMIT}..HEAD`).status).not.toBe(0);
  });

  test("refuses each autosquash commit left in the range that the hook lets through locally", () => {
    for (const [prefix, message] of Object.entries(AUTOSQUASH)) {
      const dir = hookedRepo();
      const base = commitPastHooks(dir, "feat: start");
      const head = commitPastHooks(dir, message);
      writeFileSync(join(dir, "MESSAGE"), `${message}\n`);
      expect([prefix, bash(dir, "sh .githooks/commit-msg MESSAGE", {}).status]).toEqual([prefix, 0]);
      expect(judged(dir, `${base}..${head}`).stderr).toContain("is an autosquash commit left in the range");
    }
  });
});
