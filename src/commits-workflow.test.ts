import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installGates } from "./gates";
import { NO_FILLS } from "./gates-contract";
import { SOURCE_DIR } from "./gates-sources";
import { commitPastHooks, NO_COMMIT, NOT_ON_GITHUB, removeScratchDirs, repo } from "./repo.test-support";

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

const workflow: unknown = Bun.YAML.parse(readFileSync(join(SOURCE_DIR, "commits.yml"), "utf8"));
const steps = field(field(field(workflow, "jobs"), "commits"), "steps");
const judgeStep = Array.isArray(steps)
  ? steps.find((step) => typeof field(step, "run") === "string")
  : undefined;
const JUDGE = field(judgeStep, "run");

const AUTOSQUASH = {
  "fixup! ": "fixup! feat: start",
  "squash! ": "squash! feat: start",
  "amend! ": "amend! feat: start\n\nfeat: start over",
};

function gated(): string {
  const dir = repo();
  installGates(dir, { kind: "gates", gates: ["commit-subject"] }, NO_FILLS, NOT_ON_GITHUB);
  return dir;
}

function judged(dir: string, push: { base: string; head: string; ref: string }) {
  if (typeof JUDGE !== "string") throw new Error("commits.yml has no step that runs a command");
  const ran = spawnSync("bash", ["-e", "-c", JUDGE], {
    cwd: dir,
    env: {
      ...process.env,
      BASE_SHA: push.base,
      HEAD_SHA: push.head,
      PUSHED_REF: push.ref,
      DEFAULT_BRANCH: "main",
    },
    encoding: "utf8",
  });
  return { status: ran.status, stderr: ran.stderr };
}

function setOriginMain(dir: string, sha: string): void {
  execFileSync("git", ["-C", dir, "update-ref", "refs/remotes/origin/main", sha]);
}

afterEach(removeScratchDirs);

describe("the commits workflow", () => {
  test("judges every commit after the pushed base, and none before it", () => {
    const dir = gated();
    commitPastHooks(dir, "Start badly");
    const base = commitPastHooks(dir, "feat: start");
    commitPastHooks(dir, "Add a bad subject");
    const head = commitPastHooks(dir, "fix: follow up");
    expect(judged(dir, { base, head, ref: "refs/heads/main" }).stderr).toContain("got: Add a bad subject");
    expect(judged(dir, { base: head, head, ref: "refs/heads/main" })).toEqual({ status: 0, stderr: "" });
  });

  test("judges a new branch from the default branch, not its tip alone", () => {
    const dir = gated();
    commitPastHooks(dir, "Start badly");
    setOriginMain(dir, commitPastHooks(dir, "feat: start"));
    commitPastHooks(dir, "Add a bad subject");
    const head = commitPastHooks(dir, "fix: follow up");
    const ran = judged(dir, { base: NO_COMMIT, head, ref: "refs/heads/topic" });
    expect(ran.stderr).toContain("got: Add a bad subject");
    expect(ran.stderr).not.toContain("Start badly");
  });

  test("judges every commit when the default branch is pushed for the first time", () => {
    const dir = gated();
    commitPastHooks(dir, "Start badly");
    const head = commitPastHooks(dir, "feat: carry on");
    setOriginMain(dir, head);
    expect(judged(dir, { base: NO_COMMIT, head, ref: "refs/heads/main" }).stderr).toContain(
      "got: Start badly",
    );
  });

  test("judges every commit when a new branch reaches a remote with no default branch", () => {
    const dir = gated();
    commitPastHooks(dir, "Start badly");
    const head = commitPastHooks(dir, "feat: carry on");
    expect(judged(dir, { base: NO_COMMIT, head, ref: "refs/heads/topic" }).stderr).toContain(
      "got: Start badly",
    );
  });

  test("fails when the head names no commit, rather than judging nothing", () => {
    const dir = gated();
    const base = commitPastHooks(dir, "feat: start");
    expect(judged(dir, { base, head: NO_COMMIT, ref: "refs/heads/main" }).status).not.toBe(0);
  });

  test("refuses each autosquash commit left in the range that the hook lets through locally", () => {
    for (const [prefix, message] of Object.entries(AUTOSQUASH)) {
      const dir = gated();
      const base = commitPastHooks(dir, "feat: start");
      const head = commitPastHooks(dir, message);
      const ran = spawnSync("sh", [".githooks/commit-msg", "/dev/stdin"], {
        cwd: dir,
        input: `${message}\n`,
      });
      expect([prefix, ran.status]).toEqual([prefix, 0]);
      expect(judged(dir, { base, head, ref: "refs/heads/main" }).stderr).toContain(
        "is an autosquash commit left in the range",
      );
    }
  });
});
