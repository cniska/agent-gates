import { afterEach, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { agentGates, checkout, git, packageVersion, removeScratchDirs, scratchDir, toonOf } from "./cli";

afterEach(removeScratchDirs);

const INSTALL_USAGE =
  "agent-gates install [<gate>] [--command <format command>] [--prefixes <a,b,c>] [--full], choosing from commit-subject, format, no-comments-javascript, no-comments-dart, no-comments-sql, no-comments-shell, no-comments-rust, no-comments-python, no-comments-yaml, no-comments-swift, no-secrets, pinned-actions, no-comments (each language the tracked files hold)";

test("AC-1 lists the commands and --version, and refuses a bad call with its usage and writes nothing", () => {
  const dir = checkout();
  const listing = agentGates(dir, []);
  expect([listing.status, listing.stderr]).toEqual([0, ""]);
  expect(toonOf(listing.stdout)).toEqual({
    command: "agent-gates",
    ok: true,
    result: {
      commands: [
        {
          name: "install",
          usage: INSTALL_USAGE,
          summary: "install the named gate, and bring the installed ones up to date",
        },
        {
          name: "doctor",
          usage: "agent-gates doctor [--full]",
          summary: "judge each installed gate file and the hook wiring, naming the fix for each problem",
        },
      ],
      flags: [
        { name: "--version", usage: "agent-gates --version", summary: "print the version alone on one line" },
      ],
    },
  });

  const unknown = agentGates(dir, ["uninstall"]);
  expect([unknown.status, unknown.stdout]).toEqual([2, ""]);
  expect(toonOf(unknown.stderr)).toEqual({
    command: "agent-gates",
    ok: false,
    error: {
      kind: "usage",
      code: "unknown_command",
      message: "uninstall is not an agent-gates command; agent-gates with no command lists them",
      meta: { name: "uninstall", usage: "agent-gates install|doctor|--version" },
      resolve: "agent-gates install|doctor|--version",
    },
  });

  const arity = agentGates(dir, ["doctor", "now"]);
  expect([arity.status, arity.stdout]).toEqual([2, ""]);
  expect(toonOf(arity.stderr)).toEqual({
    command: "doctor",
    ok: false,
    error: {
      kind: "usage",
      code: "wrong_arity",
      message: "agent-gates doctor takes 0 argument(s), and got 1: now",
      meta: { command: "doctor", min: 0, max: 0, got: ["now"], usage: "agent-gates doctor [--full]" },
      resolve: "agent-gates doctor [--full]",
    },
  });

  const gate = agentGates(dir, ["install", "lint-free"]);
  expect([gate.status, gate.stdout]).toEqual([2, ""]);
  expect(toonOf(gate.stderr)).toEqual({
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
  expect(readdirSync(dir)).toEqual([".git"]);
});

test("AC-2 refuses to run outside a checkout, and faults when git cannot run", () => {
  const outside = scratchDir();
  for (const command of [["doctor"], ["install", "commit-subject"]]) {
    const ran = agentGates(outside, command);
    expect([ran.status, ran.stdout]).toEqual([1, ""]);
    expect(toonOf(ran.stderr)).toEqual({
      command: command[0],
      ok: false,
      error: {
        kind: "refusal",
        code: "not_a_checkout",
        message: `${outside} is not inside a git checkout, so there is no project to gate`,
        meta: { cwd: outside },
        resolve: "cd into the project's checkout and run the command again",
      },
    });
  }
  expect(readdirSync(outside)).toEqual([]);

  const dir = checkout();
  const noGit = agentGates(dir, ["doctor"], { PATH: scratchDir() });
  expect([noGit.status, noGit.stdout]).toEqual([3, ""]);
  expect(toonOf(noGit.stderr)).toEqual({
    command: "doctor",
    ok: false,
    error: {
      kind: "fault",
      code: "git_unavailable",
      message: expect.stringMatching(/^git could not run: /),
      meta: { detail: expect.any(String) },
      resolve: "stop and hand this error to the owner: git must be installed and on PATH",
    },
  });
});

test("AC-44 prints the version alone, and refuses an argument after it", () => {
  const dir = checkout();
  expect(agentGates(dir, ["--version"])).toEqual({ status: 0, stdout: `${packageVersion()}\n`, stderr: "" });

  const extra = agentGates(dir, ["--version", "now"]);
  expect([extra.status, extra.stdout]).toEqual([2, ""]);
  expect(toonOf(extra.stderr)).toMatchObject({
    command: "agent-gates",
    ok: false,
    error: { kind: "usage", code: "wrong_arity", resolve: "agent-gates --version" },
  });
});

test("AC-68 lists no null field by default, every field with --full, and leads with the count in each state", () => {
  const dir = checkout({ ".github/workflows/commits.yml": "name: Commits\n" });
  const install = agentGates(dir, ["install", "commit-subject"]);
  expect(install).toEqual({
    status: 0,
    stdout: [
      "command: install",
      "ok: true",
      "result:",
      "  counts:",
      "    installed: 0",
      "    missing: 5",
      "    behind: 0",
      "    changed: 1",
      "    ahead: 0",
      '    "not-executable": 0',
      "    reconfigured: 0",
      "  gates[1]: commit-subject",
      "  files[6]{target,state}:",
      "    .githooks/commit-msg,missing",
      "    .github/workflows/commits.yml,changed",
      "    .githooks/.gitattributes,missing",
      "    .githooks/pre-push,missing",
      "    .githooks/pre-push.d/commit-subject,missing",
      "    .githooks/judge-push,missing",
      "  backups[1]{target,backup}:",
      "    .github/workflows/commits.yml,.github/workflows/commits.yml.agent-gates-backup",
      "  prepare: absent",
      "  fills:",
      "    command: null",
      "    prefixes: null",
      "",
    ].join("\n"),
    stderr: "",
  });
  const full = agentGates(dir, ["install", "--full"]);
  expect([full.status, full.stderr]).toEqual([0, ""]);
  expect(full.stdout).toContain(
    [
      "  files[6]{target,state,backup}:",
      "    .githooks/commit-msg,installed,null",
      "    .github/workflows/commits.yml,installed,null",
    ].join("\n"),
  );
  expect(full.stdout).not.toContain("backups[");

  git(dir, ["config", "--unset", "core.hooksPath"]);
  const judged = agentGates(dir, ["doctor"]);
  expect([judged.status, judged.stderr]).toEqual([1, ""]);
  expect(judged.stdout).toContain(
    [
      "result:",
      "  counts:",
      "    ok: 9",
      "    warn: 0",
      "    fail: 1",
      "  checks[10]{name,state,detail}:",
      "    gates,ok,commit-subject",
    ].join("\n"),
  );
  expect(judged.stdout).toEndWith(
    ["  fixes[1]{name,fix}:", "    hooksPath,agent-gates install", ""].join("\n"),
  );
  expect(judged.stdout).not.toContain("null");
  const fullJudged = agentGates(dir, ["doctor", "--full"]);
  expect([fullJudged.status, fullJudged.stderr]).toEqual([1, ""]);
  expect(fullJudged.stdout).toContain(
    [
      "  checks[10]{name,state,detail,fix}:",
      "    gates,ok,commit-subject,null",
      "    .githooks/commit-msg,ok,installed,null",
    ].join("\n"),
  );
  expect(fullJudged.stdout).not.toContain("fixes[");
});
