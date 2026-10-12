import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
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

function rangeOf(dir: string, push: { base: string; head: string; ref: string }): string {
  const output = join(dir, "output");
  writeFileSync(output, "");
  const env = {
    BASE_SHA: push.base,
    HEAD_SHA: push.head,
    PUSHED_REF: push.ref,
    DEFAULT_BRANCH: "main",
    GITHUB_OUTPUT: output,
  };
  expect(bash(dir, RESOLVE, env).status).toBe(0);
  return readFileSync(output, "utf8")
    .replace(/^range=/, "")
    .trim();
}

function setOriginMain(dir: string, sha: string): void {
  execFileSync("git", ["-C", dir, "update-ref", "refs/remotes/origin/main", sha]);
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
    const range = rangeOf(dir, { base, head, ref: "refs/heads/main" });
    expect(range).toBe(`${base}..${head}`);
    expect(judged(dir, range).stderr).toContain("got: Add a bad subject");
  });

  test("judges a new branch from the default branch, not its tip alone", () => {
    const dir = hookedRepo();
    const main = commitPastHooks(dir, "feat: start");
    setOriginMain(dir, main);
    commitPastHooks(dir, "Add a bad subject");
    const head = commitPastHooks(dir, "fix: follow up");
    const range = rangeOf(dir, { base: NO_COMMIT, head, ref: "refs/heads/topic" });
    expect(range).toBe(`origin/main..${head}`);
    expect(judged(dir, range).stderr).toContain("got: Add a bad subject");
  });

  test("judges every commit when the default branch is pushed for the first time", () => {
    const dir = hookedRepo();
    commitPastHooks(dir, "Start badly");
    const head = commitPastHooks(dir, "feat: carry on");
    setOriginMain(dir, head);
    const range = rangeOf(dir, { base: NO_COMMIT, head, ref: "refs/heads/main" });
    expect(range).toBe(head);
    expect(judged(dir, range).stderr).toContain("got: Start badly");
  });

  test("judges every commit when a new branch reaches a remote with no default branch", () => {
    const dir = hookedRepo();
    commitPastHooks(dir, "Start badly");
    const head = commitPastHooks(dir, "feat: carry on");
    const range = rangeOf(dir, { base: NO_COMMIT, head, ref: "refs/heads/topic" });
    expect(range).toBe(head);
    expect(judged(dir, range).stderr).toContain("got: Start badly");
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
