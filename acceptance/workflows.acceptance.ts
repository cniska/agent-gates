import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  agentGates,
  COMMIT_SUBJECT_FILES,
  check,
  checkout,
  doctor,
  each,
  ghCalls,
  git,
  install,
  installed,
  installs,
  pathOf,
  readText,
  removeScratchDirs,
  toonOf,
  usageCode,
  writeFiles,
} from "./cli";

afterEach(removeScratchDirs);

const COMMITS = ".github/workflows/commits.yml";

const NO_SECRETS = ".github/workflows/no-secrets.yml";

const JUDGE_PUSH = ".githooks/judge-push";

const OWN_STEP = ".githooks/pre-push.d/own";

const HOOKS_ONLY = COMMIT_SUBJECT_FILES.filter((target) => target !== COMMITS);

type Listed = { readonly target: string; readonly state: string; readonly backup: string | null };

function filesOf(result: unknown): readonly Listed[] {
  if (typeof result !== "object" || result === null || !("files" in result) || !Array.isArray(result.files))
    throw new Error(`install printed no files: ${JSON.stringify(result)}`);
  return result.files;
}

function stateOf(result: unknown, target: string): Listed | undefined {
  return filesOf(result).find((file) => file.target === target);
}

function workflowsIn(dir: string): readonly string[] {
  const at = join(dir, ".github/workflows");
  return existsSync(at) ? readdirSync(at).toSorted() : [];
}

test("AC-69 installs the hooks without their workflows, keeps the choice, and turns the workflows back on", () => {
  const dir = checkout({ "a.ts": "export const a = 1;\n" });
  installs(dir, ["commit-subject", "--workflows", "off"], {
    gates: ["commit-subject"],
    files: each("missing", HOOKS_ONLY),
    prepare: "absent",
    fills: { command: null, prefixes: null, workflows: "off" },
    workflows: { choice: "off", reason: "flag" },
  });
  expect(workflowsIn(dir)).toEqual([]);
  expect(readText(dir, JUDGE_PUSH)).toContain("\nworkflows='off'\n");
  git(dir, ["add", "-A"]);
  expect(doctor(dir).status).toBe(0);
  expect(check(dir, COMMITS)).toBeUndefined();
  expect(check(dir, "workflows")).toEqual({ name: "workflows", state: "ok", detail: "`off`", fix: null });

  installs(dir, [], {
    gates: ["commit-subject"],
    files: each("installed", HOOKS_ONLY),
    prepare: "absent",
    fills: { command: null, prefixes: null, workflows: "off" },
    workflows: { choice: "off", reason: "recorded" },
  });
  install(dir, ["no-secrets"]);
  install(dir, ["no-comments"]);
  const gates = installed(dir, []);
  expect(gates).toMatchObject({
    gates: ["commit-subject", "no-comments-javascript", "no-comments-shell", "no-secrets"],
    fills: { workflows: "off" },
  });
  expect(filesOf(gates).every((file) => file.state === "installed")).toBe(true);
  expect(workflowsIn(dir)).toEqual([]);
  writeFiles(dir, { [OWN_STEP]: "#!/bin/sh\nexit 0\n" });
  chmodSync(join(dir, OWN_STEP), 0o755);
  git(dir, ["add", "-A"]);
  expect(doctor(dir).status).toBe(0);
  expect(check(dir, "hook steps")).toBeUndefined();

  const on = installed(dir, ["--workflows", "on"]);
  expect(on).toMatchObject({ fills: { workflows: "on" } });
  expect(stateOf(on, JUDGE_PUSH)?.state).toBe("reconfigured");
  expect(stateOf(on, COMMITS)?.state).toBe("missing");
  expect(stateOf(on, NO_SECRETS)?.state).toBe("missing");
  expect(stateOf(on, ".github/workflows/no-comments.yml")?.state).toBe("missing");
  expect(workflowsIn(dir)).toEqual(["commits.yml", "no-comments.yml", "no-secrets.yml"]);
  expect(readText(dir, JUDGE_PUSH)).toContain("\nworkflows='on'\n");
});

test("AC-70 removes the gates' workflows a project turns off, keeping an edited one aside and its own", () => {
  const dir = checkout();
  install(dir, ["commit-subject"]);
  install(dir, ["no-secrets"]);
  const edited = `${readText(dir, NO_SECRETS)}\n`;
  writeFiles(dir, { [NO_SECRETS]: edited });
  const off = installed(dir, ["--workflows", "off"]);
  expect(off).toMatchObject({
    counts: { unwanted: 2 },
    fills: { workflows: "off" },
  });
  expect(stateOf(off, COMMITS)).toEqual({ target: COMMITS, state: "unwanted", backup: null });
  expect(stateOf(off, NO_SECRETS)).toEqual({
    target: NO_SECRETS,
    state: "unwanted",
    backup: `${NO_SECRETS}.agent-gates-backup`,
  });
  expect(workflowsIn(dir)).toEqual(["no-secrets.yml.agent-gates-backup"]);
  expect(readText(dir, `${NO_SECRETS}.agent-gates-backup`)).toBe(edited);

  const reference = checkout();
  install(reference, ["commit-subject"]);
  writeFiles(dir, { [COMMITS]: readText(reference, COMMITS) });
  expect(check(dir, COMMITS)).toEqual({
    name: COMMITS,
    state: "warn",
    detail: "a gate's workflow while the project's workflows are off, so CI still runs it",
    fix: "agent-gates install",
  });
  install(dir, []);
  expect(existsSync(join(dir, COMMITS))).toBe(false);

  const own = "name: commits\non: push\njobs: {}\n";
  writeFiles(dir, { [COMMITS]: own });
  expect(stateOf(installed(dir, []), COMMITS)).toBeUndefined();
  expect(readText(dir, COMMITS)).toBe(own);
  expect(check(dir, COMMITS)).toBeUndefined();

  const bare = checkout();
  for (const args of [
    ["commit-subject", "--workflows", "maybe"],
    ["commit-subject", "--workflows", "OFF"],
  ])
    expect(usageCode(bare, args)).toEqual([args, 2, "fill_malformed"]);
  for (const args of [
    ["format", "--command", "true", "--workflows", "off"],
    ["--workflows", "off"],
    ["commit-subject", "--workflows", "off", "--workflows", "on"],
    ["commit-subject", "--workflows"],
  ])
    expect(usageCode(bare, args)).toEqual([args, 2, "flag_misplaced"]);
  expect(existsSync(join(bare, ".githooks"))).toBe(false);
});

function onGitHub(repo: string): string {
  const dir = checkout({ "a.ts": "export const a = 1;\n" });
  git(dir, ["remote", "add", "origin", `https://github.com/acme/${repo}.git`]);
  return dir;
}

test("AC-71 install writes the workflows by default whatever origin is, reading no visibility, a recorded off holds, and a flag wins", () => {
  for (const dir of [onGitHub("private"), onGitHub("public"), onGitHub("gone"), checkout()]) {
    installs(dir, ["commit-subject"], {
      gates: ["commit-subject"],
      files: each("missing", COMMIT_SUBJECT_FILES),
      prepare: "absent",
      fills: { command: null, prefixes: null, workflows: null },
      workflows: { choice: "on", reason: "default" },
    });
    expect(workflowsIn(dir)).toEqual(["commits.yml"]);
    expect(readText(dir, JUDGE_PUSH)).toContain("\nworkflows=''\n");
    expect(installed(dir, [])).toMatchObject({ workflows: { choice: "on", reason: "default" } });
  }
  const noGh = onGitHub("private");
  const ran = agentGates(noGh, ["install", "commit-subject"], { PATH: pathOf(["git"]) });
  expect([ran.status, ran.stderr]).toEqual([0, ""]);
  expect(toonOf(ran.stdout)).toMatchObject({ result: { workflows: { choice: "on", reason: "default" } } });
  expect(workflowsIn(noGh)).toEqual(["commits.yml"]);
  expect(ghCalls()).toBe("");

  const declined = onGitHub("public");
  installs(declined, ["commit-subject", "--workflows", "off"], {
    gates: ["commit-subject"],
    files: each("missing", HOOKS_ONLY),
    prepare: "absent",
    fills: { command: null, prefixes: null, workflows: "off" },
    workflows: { choice: "off", reason: "flag" },
  });
  expect(installed(declined, [])).toMatchObject({
    fills: { workflows: "off" },
    workflows: { choice: "off", reason: "recorded" },
  });
  expect(workflowsIn(declined)).toEqual([]);
  expect(installed(declined, ["--workflows", "on"])).toMatchObject({
    fills: { workflows: "on" },
    workflows: { choice: "on", reason: "flag" },
  });
  expect(workflowsIn(declined)).toEqual(["commits.yml"]);
});
