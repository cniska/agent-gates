import { afterEach, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  bypassing,
  checkout,
  cloneOf,
  commitAs,
  committing,
  git,
  githubStep,
  gitRan,
  install,
  NO_COMMIT,
  type Outcome,
  readText,
  removeScratch,
  scratchDir,
  shell,
  stepScript,
  writeFiles,
} from "./cli";

afterEach(removeScratch);

const TYPES = ["feat", "fix", "refactor", "docs", "test", "chore", "style", "perf", "build", "ci"];

const NOT_CONVENTIONAL = "subject is not a Conventional Commit (type(scope): what changed).";

const SCISSORS = "# ------------------------ >8 ------------------------";

function gated(): string {
  const dir = checkout();
  install(dir, ["commit-subject"]);
  commitAs(dir, "chore: start");
  return dir;
}

function commitMessage(dir: string, message: string, cleanup = "strip"): Outcome {
  const file = join(scratchDir(), "message");
  writeFileSync(file, message);
  return committing(dir, [
    "-q",
    "--allow-empty",
    "--allow-empty-message",
    `--cleanup=${cleanup}`,
    "-F",
    file,
  ]);
}

function passes(dir: string, message: string, cleanup?: string): void {
  expect(commitMessage(dir, message, cleanup)).toEqual({ status: 0, stderr: "", made: true });
}

function refused(dir: string, message: string, reason: string, subject: string, cleanup?: string): void {
  expect(commitMessage(dir, message, cleanup)).toEqual({
    status: 1,
    stderr: `commit-msg: ${reason}\n  got: ${subject}\n`,
    made: false,
  });
}

test("AC-14 runs each executable pre-commit step in name order, stopping at the first failure", () => {
  const dir = checkout();
  install(dir, ["no-comments-javascript"]);
  const logs = scratchDir();
  const log = join(logs, "log");
  const steps: Record<string, string> = {};
  for (const [name, status] of [
    ["30-second", 0],
    ["10-first", 0],
    ["20-not-executable", 0],
    ["40-fails", 7],
    ["50-after", 0],
  ] as const)
    steps[`.githooks/pre-commit.d/${name}`] = `#!/bin/sh\necho ${name} >> '${log}'\nexit ${status}\n`;
  writeFiles(dir, steps);
  for (const path of Object.keys(steps))
    if (!path.endsWith("not-executable")) chmodSync(join(dir, path), 0o755);

  expect(shell(dir, ".githooks/pre-commit")).toEqual({ status: 7, stdout: "", stderr: "" });
  expect(readText(logs, "log")).toBe("10-first\n30-second\n40-fails\n");
});

test("AC-15 refuses a subject that breaks a rule, naming the reason", () => {
  const dir = gated();
  for (const type of TYPES) passes(dir, `${type}: change a thing\n`);
  passes(dir, "fix(cli-2): change a thing\n");
  passes(dir, "feat!: drop a thing\n");
  passes(dir, "refactor(api)!: drop a thing\n");
  passes(dir, `feat: ${"a".repeat(44)}\n`);

  refused(dir, "Add a thing\n", NOT_CONVENTIONAL, "Add a thing");
  refused(dir, "fix(CLI): change a thing\n", NOT_CONVENTIONAL, "fix(CLI): change a thing");
  refused(dir, "fix:  change a thing\n", NOT_CONVENTIONAL, "fix:  change a thing");
  refused(dir, "wip: change a thing\n", NOT_CONVENTIONAL, "wip: change a thing");
  refused(
    dir,
    `feat: ${"a".repeat(45)}\n`,
    "subject is 51 characters, over the 50 allowed.",
    `feat: ${"a".repeat(45)}`,
  );
  refused(dir, "feat: add a café\n", "subject is not ASCII.", "feat: add a café");
  refused(dir, "feat: add a\ttab\n", "subject is not ASCII.", "feat: add a\ttab");
  refused(
    dir,
    "feat: add a thing\n\nBecause it was missing.\n",
    "commit has a body. The subject is the whole message.",
    "feat: add a thing",
  );
  refused(dir, "", "subject is empty.", "");
  refused(dir, "   \n", "subject is empty.", "   ", "verbatim");
});

test("AC-16 judges the message git keeps, and an autosquash by the subject it carries", () => {
  const dir = gated();
  passes(dir, "feat: add a thing\n# Please enter the commit message\n\n#\tmodified: a.ts\n");
  passes(dir, `feat: add a thing\n${SCISSORS}\ndiff --git a/a.ts b/a.ts\n+const a = 1;\n`, "scissors");
  passes(dir, "feat: add a thing\r\n\r\n", "verbatim");

  passes(dir, "fixup! feat: add a thing\n");
  passes(dir, "squash! fixup! feat: add a thing\n");
  refused(dir, "fixup! Add a thing\n", NOT_CONVENTIONAL, "fixup! Add a thing");
  refused(dir, "squash! Add a thing\n", NOT_CONVENTIONAL, "squash! Add a thing");

  passes(dir, "amend! Add a thing\n\nfeat: add a thing\n");
  refused(dir, "amend! feat: add a thing\n\nAdd a thing\n", NOT_CONVENTIONAL, "Add a thing");
});

test("AC-17 lets a merge commit through", () => {
  const dir = checkout({ "a.ts": "export const a = 1;\n" });
  install(dir, ["commit-subject", "no-comments-javascript"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "chore: start"]);
  git(dir, ["checkout", "-q", "-b", "side"]);
  writeFiles(dir, { "a.ts": "export const a = 2;\n" });
  git(dir, ["commit", "-q", "-am", "fix: set a to two"]);
  git(dir, ["checkout", "-q", "main"]);
  writeFiles(dir, { "a.ts": "export const a = 3;\n" });
  git(dir, ["commit", "-q", "-am", "fix: set a to three"]);
  expect(gitRan(dir, ["merge", "-q", "side"]).status).toBe(1);
  writeFiles(dir, { "a.ts": "export const a = 3; // two was wrong\n" });
  git(dir, ["add", "a.ts"]);

  const ran = gitRan(dir, ["commit", "-q", "--no-edit"]);
  expect([ran.status, ran.stderr]).toEqual([0, ""]);
  expect(git(dir, ["log", "-1", "--format=%P %s"])).toMatch(/^\w{40} \w{40} Merge branch 'side'$/);
});

type Push = {
  readonly base: string;
  readonly head: string;
  readonly ref: string;
};

type Judged = { readonly range: string; readonly status: number | null; readonly stderr: string };

function runWorkflow(dir: string, push: Push): Judged {
  const workflow = readText(dir, ".github/workflows/commits.yml");
  const resolve = stepScript(
    workflow,
    "Resolve the pushed range, from the default branch when the push opens a branch",
  );
  const judge = stepScript(workflow, "Judge each subject");
  const runner = scratchDir();
  const output = join(runner, "output");
  writeFileSync(output, "");
  const github = { GITHUB_OUTPUT: output, RUNNER_TEMP: runner };
  const resolved = githubStep(dir, resolve, {
    ...github,
    BASE_SHA: push.base,
    HEAD_SHA: push.head,
    PUSHED_REF: push.ref,
    DEFAULT_BRANCH: "main",
  });
  if (resolved.status !== 0) throw new Error(`the range step failed: ${resolved.stderr}`);
  const range = readText(runner, "output")
    .replace(/^range=/, "")
    .trimEnd();
  const judged = githubStep(dir, judge, { ...github, RANGE: range });
  return { range, status: judged.status, stderr: judged.stderr };
}

function upstream(): string {
  const dir = checkout();
  install(dir, ["commit-subject"]);
  git(dir, ["add", "-A"]);
  commitAs(dir, "chore: start");
  commitAs(dir, "Add an old thing");
  return dir;
}

function mergeSide(dir: string): void {
  git(dir, ["checkout", "-q", "-b", "side"]);
  commitAs(dir, "feat: add a side thing");
  git(dir, ["checkout", "-q", "-"]);
  bypassing(dir, ["merge", "-q", "--no-ff", "-m", "Merge the side thing", "side"]);
  git(dir, ["branch", "-q", "-D", "side"]);
}

function autosquashRefusal(sha: string): string {
  return `${sha} is an autosquash commit left in the range; squash it into the commit it names.\n`;
}

test("AC-18 judges every commit the pushed range holds in CI", () => {
  const origin = upstream();
  const clone = cloneOf(origin);
  const before = git(clone, ["rev-parse", "HEAD"]);
  commitAs(clone, "feat: add a new thing");
  mergeSide(clone);
  const head = git(clone, ["rev-parse", "HEAD"]);
  const toDefault = { base: before, head, ref: "refs/heads/main" };
  expect(runWorkflow(clone, toDefault)).toEqual({ range: `${before}..${head}`, status: 0, stderr: "" });
  const fixup = commitAs(clone, "fixup! feat: add a new thing");
  expect(runWorkflow(clone, { ...toDefault, head: fixup })).toEqual({
    range: `${before}..${fixup}`,
    status: 1,
    stderr: autosquashRefusal(fixup),
  });
  git(clone, ["reset", "-q", "--hard", head]);
  const badHead = commitAs(clone, "Add a new thing");
  expect(runWorkflow(clone, { ...toDefault, head: badHead })).toEqual({
    range: `${before}..${badHead}`,
    status: 1,
    stderr: `commit-msg: ${NOT_CONVENTIONAL}\n  got: Add a new thing\n`,
  });

  const branch = cloneOf(origin);
  git(branch, ["checkout", "-q", "-b", "feature"]);
  commitAs(branch, "feat: add a branch thing");
  mergeSide(branch);
  const branchHead = git(branch, ["rev-parse", "HEAD"]);
  const opening = { base: NO_COMMIT, head: branchHead, ref: "refs/heads/feature" };
  expect(runWorkflow(branch, opening)).toEqual({
    range: `origin/main..${branchHead}`,
    status: 0,
    stderr: "",
  });
  for (const squash of ["squash! feat: add a branch thing", "amend! feat: add a branch thing"]) {
    git(branch, ["reset", "-q", "--hard", branchHead]);
    const sha = commitAs(branch, `${squash}\n\nfeat: add a branch thing`);
    expect(runWorkflow(branch, { ...opening, head: sha })).toEqual({
      range: `origin/main..${sha}`,
      status: 1,
      stderr: autosquashRefusal(sha),
    });
  }

  const pullRequest = {
    base: git(branch, ["rev-parse", "origin/main"]),
    head: branchHead,
    ref: "refs/pull/1/merge",
  };
  expect(runWorkflow(branch, pullRequest)).toEqual({
    range: `${pullRequest.base}..${branchHead}`,
    status: 0,
    stderr: "",
  });

  const firstPush = { base: NO_COMMIT, head: git(origin, ["rev-parse", "HEAD"]), ref: "refs/heads/main" };
  expect(runWorkflow(origin, firstPush)).toEqual({
    range: firstPush.head,
    status: 1,
    stderr: `commit-msg: ${NOT_CONVENTIONAL}\n  got: Add an old thing\n`,
  });

  const lone = upstream();
  git(lone, ["checkout", "-q", "-b", "feature"]);
  const loneHead = commitAs(lone, "feat: add a branch thing");
  expect(runWorkflow(lone, { base: NO_COMMIT, head: loneHead, ref: "refs/heads/feature" })).toEqual({
    range: loneHead,
    status: 1,
    stderr: `commit-msg: ${NOT_CONVENTIONAL}\n  got: Add an old thing\n`,
  });
});
