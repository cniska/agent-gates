import { afterEach, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { agentGates, checkout, jsonLine, packageVersion, removeScratch, scratchDir } from "./cli";

afterEach(removeScratch);

const INSTALL_USAGE =
  "agent-gates install [<gate>...] [--command <format command>] [--setup <CI setup command>] [--prefixes <a,b,c>], choosing from commit-subject, format, no-comments-javascript, no-comments-dart, no-comments-sql, no-comments-shell, no-comments-rust, no-comments-python, no-comments (each language the tracked files hold)";

test("AC-1 lists the commands, and refuses a bad call with its usage and writes nothing", () => {
  const dir = checkout();
  const listing = agentGates(dir, []);
  expect([listing.status, listing.stderr]).toEqual([0, ""]);
  expect(jsonLine(listing.stdout)).toEqual({
    command: "agent-gates",
    ok: true,
    result: {
      commands: [
        {
          name: "install",
          usage: INSTALL_USAGE,
          summary: "install the named gates, and bring the installed ones up to date",
        },
        {
          name: "doctor",
          usage: "agent-gates doctor",
          summary: "judge each installed gate file and the hook wiring, naming the fix for each problem",
        },
      ],
    },
  });

  const unknown = agentGates(dir, ["uninstall"]);
  expect([unknown.status, unknown.stdout]).toEqual([2, ""]);
  expect(jsonLine(unknown.stderr)).toEqual({
    command: "agent-gates",
    ok: false,
    error: {
      kind: "usage",
      code: "unknown_command",
      message: "uninstall is not an agent-gates command; agent-gates with no command lists them",
      meta: { name: "uninstall", usage: "agent-gates install|doctor" },
      resolve: "agent-gates install|doctor",
    },
  });

  const arity = agentGates(dir, ["doctor", "now"]);
  expect([arity.status, arity.stdout]).toEqual([2, ""]);
  expect(jsonLine(arity.stderr)).toEqual({
    command: "doctor",
    ok: false,
    error: {
      kind: "usage",
      code: "wrong_arity",
      message: "agent-gates doctor takes 0 argument(s), and got 1: now",
      meta: { command: "doctor", min: 0, max: 0, got: ["now"], usage: "agent-gates doctor" },
      resolve: "agent-gates doctor",
    },
  });

  const gate = agentGates(dir, ["install", "commit-subject", "lint-free"]);
  expect([gate.status, gate.stdout]).toEqual([2, ""]);
  expect(jsonLine(gate.stderr)).toEqual({
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
    expect(jsonLine(ran.stderr)).toEqual({
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
  expect(jsonLine(noGit.stderr)).toEqual({
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
  expect(jsonLine(extra.stderr)).toMatchObject({
    command: "agent-gates",
    ok: false,
    error: { kind: "usage", code: "wrong_arity", resolve: "agent-gates --version" },
  });
});
