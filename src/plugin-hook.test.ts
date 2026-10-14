import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installGates } from "./gates";
import { NO_FILLS } from "./gates-contract";
import { commitPastHooks, removeScratchDirs, repo, scratchDir, writeFiles } from "./repo.test-support";

const PLUGIN = join(import.meta.dir, "..", "plugin");

const HOOK = join(PLUGIN, "hooks", "no-comments.sh");

const BASH = execFileSync("sh", ["-c", "command -v bash"], { encoding: "utf8" }).trim();

const REFUSAL =
  "no-comments: this change adds 1 comment. Remove each comment; a why belongs in a name, a test or the docs.\nkept in JavaScript and TypeScript: the first-line shebang, with no `#` word or `\\c` after `#!`; a leading `/// <reference …/>` holding only its attributes; a gate marker on a line of its own\nsrc/a.ts\n  1  // why";

afterEach(removeScratchDirs);

function ran(input: string, env: Record<string, string> = {}) {
  const run = spawnSync(BASH, [HOOK], { input, env: { ...process.env, ...env }, encoding: "utf8" });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

function edited(cwd: string, filePath: string, env: Record<string, string> = {}) {
  return ran(JSON.stringify({ cwd, tool_name: "Edit", tool_input: { file_path: filePath } }), env);
}

function gated(): string {
  const dir = repo({ "src/a.ts": "export const a = 1;\n" });
  installGates(dir, ["no-comments-javascript"], NO_FILLS);
  commitPastHooks(dir, "feat: start");
  return dir;
}

function binWith(tools: readonly string[]): string {
  const bin = scratchDir();
  for (const tool of tools)
    symlinkSync(
      execFileSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).trim(),
      join(bin, tool),
    );
  return bin;
}

describe("the plugin's no-comments hook", () => {
  test("tells the agent, in the scanner's words, which comments the edit added, and changes nothing", () => {
    const dir = gated();
    const text = "export const a = 2; // why\n";
    writeFiles(dir, { "src/a.ts": text });
    const run = edited(dir, join(dir, "src/a.ts"));
    expect(run).toEqual({ status: 0, stdout: expect.any(String), stderr: "" });
    expect(JSON.parse(run.stdout)).toEqual({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: REFUSAL },
    });
    expect(edited(join(dir, "src"), "a.ts").stdout).toBe(run.stdout);
    expect(readFileSync(join(dir, "src/a.ts"), "utf8")).toBe(text);
    expect(execFileSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8" })).toBe(
      " M src/a.ts\n",
    );
  });

  test("says nothing for an edit that adds no comment", () => {
    const dir = gated();
    writeFiles(dir, { "src/a.ts": "export const a = 2;\n" });
    expect(edited(dir, join(dir, "src/a.ts"))).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  test("does nothing in a repo without the gate, outside a repo, or for input naming no file", () => {
    const ungated = repo({ "a.ts": "// why\n" });
    expect(edited(ungated, join(ungated, "a.ts"))).toEqual({ status: 0, stdout: "", stderr: "" });
    const loose = scratchDir();
    writeFileSync(join(loose, "a.ts"), "// why\n");
    expect(edited(loose, join(loose, "a.ts"))).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(edited(loose, join(loose, "gone", "a.ts"))).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(ran(JSON.stringify({ cwd: loose, tool_input: {} }))).toEqual({
      status: 0,
      stdout: "",
      stderr: "",
    });
  });

  test("never blocks: a scanner without --file, a missing node or jq, or bad input only leave a note", () => {
    const dir = gated();
    writeFiles(dir, { "src/a.ts": "export const a = 2; // why\n" });
    const file = join(dir, "src/a.ts");
    expect(edited(dir, file, { PATH: binWith(["git", "jq"]) })).toEqual({
      status: 0,
      stdout: "",
      stderr: "cniska-gates: node is not on PATH, so the edit's comments were not judged\n",
    });
    expect(edited(dir, file, { PATH: binWith(["git", "node"]) })).toEqual({
      status: 0,
      stdout: "",
      stderr: "cniska-gates: jq is not on PATH, so the edit's comments were not judged\n",
    });
    expect(ran("not json")).toEqual({
      status: 0,
      stdout: "",
      stderr: expect.stringContaining(
        "cniska-gates: the hook input did not parse as JSON, so the edit's comments were not judged\n",
      ),
    });
    writeFileSync(
      join(dir, ".githooks/no-comments/scan.cjs"),
      "process.stderr.write('no-comments: scan.cjs takes no arguments');\nprocess.exitCode = 2;\n",
    );
    expect(edited(dir, file)).toEqual({
      status: 0,
      stdout: "",
      stderr:
        "cniska-gates: the no-comments scanner exited 2, so the edit's comments were not judged: no-comments: scan.cjs takes no arguments\n",
    });
  });

  test("runs after each edit tool, from the plugin's own root", () => {
    const hooks: unknown = JSON.parse(readFileSync(join(PLUGIN, "hooks", "hooks.json"), "utf8"));
    expect(hooks).toEqual({
      hooks: {
        PostToolUse: [
          {
            matcher: "Edit|Write|MultiEdit",
            hooks: [{ type: "command", command: `"\${CLAUDE_PLUGIN_ROOT}"/hooks/no-comments.sh` }],
          },
        ],
      },
    });
    accessSync(HOOK, constants.X_OK);
    const manifest: unknown = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8"));
    expect(manifest).toMatchObject({ name: "cniska-gates" });
  });
});
