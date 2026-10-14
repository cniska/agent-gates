import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import {
  checkout,
  type Env,
  git,
  pathOf,
  readText,
  removeScratch,
  scratchDir,
  shell,
  writeFiles,
} from "./cli";
import { commentReply, gated, KEPT_JAVASCRIPT } from "./no-comments";

afterEach(removeScratch);

const PLUGIN = join(import.meta.dir, "..", "plugin");

const QUIET = { status: 0, stdout: "", stderr: "" };

const COMMAND = `"\${CLAUDE_PLUGIN_ROOT}"/hooks/no-comments.sh`;

function hookRan(input: string, env: Env = {}) {
  return shell(scratchDir(), COMMAND, { CLAUDE_PLUGIN_ROOT: PLUGIN, ...env }, input);
}

function edited(cwd: string, file: string, env: Env = {}) {
  return hookRan(
    JSON.stringify({
      cwd,
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: file },
    }),
    env,
  );
}

function told(context: string) {
  return {
    status: 0,
    stdout: `${JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context } })}\n`,
    stderr: "",
  };
}

function bare(tools: readonly string[]): Env {
  return { PATH: pathOf(["sh", ...tools]) };
}

function note(why: string): string {
  return `cniska-gates: ${why}, so the edit's comments were not judged\n`;
}

test("AC-36 hands the agent the scanner's reply after an edit adding a comment, and says nothing otherwise", () => {
  expect(JSON.parse(readText(PLUGIN, ".claude-plugin/plugin.json"))).toMatchObject({ name: "cniska-gates" });
  expect(JSON.parse(readText(PLUGIN, "hooks/hooks.json"))).toEqual({
    hooks: {
      PostToolUse: [{ matcher: "Edit|Write|MultiEdit", hooks: [{ type: "command", command: COMMAND }] }],
    },
  });
  const dir = gated(["no-comments-javascript"], { "src/a.ts": "export const a = 1;\n" });
  const tools = bare(["bash", "git", "node", "jq"]);
  const text = "export const a = 2; // why\n";
  writeFiles(dir, { "src/a.ts": text });

  const reply = told(commentReply([KEPT_JAVASCRIPT], [["src/a.ts", ["1  // why"]]]).trimEnd());
  expect(edited(dir, join(dir, "src/a.ts"), tools)).toEqual(reply);
  expect(edited(join(dir, "src"), "a.ts", tools)).toEqual(reply);
  expect([readText(dir, "src/a.ts"), git(dir, ["status", "--porcelain"])]).toEqual([text, "M src/a.ts"]);

  writeFiles(dir, { "src/a.ts": "export const a = 2;\n" });
  expect(edited(dir, join(dir, "src/a.ts"), tools)).toEqual(QUIET);

  const ungated = checkout({ "a.ts": "export const a = 1; // why\n" });
  expect(edited(ungated, join(ungated, "a.ts"), tools)).toEqual(QUIET);
  const loose = scratchDir();
  writeFiles(loose, { "a.ts": "export const a = 1; // why\n" });
  expect(edited(loose, join(loose, "a.ts"), tools)).toEqual(QUIET);
  expect(edited(loose, join(loose, "gone", "a.ts"), tools)).toEqual(QUIET);
  expect(hookRan(JSON.stringify({ cwd: dir, tool_input: {} }), tools)).toEqual(QUIET);
});

test("AC-37 leaves only a note when it cannot judge the edit", () => {
  const dir = gated(["no-comments-javascript"], { "a.ts": "export const a = 1;\n" });
  writeFiles(dir, { "a.ts": "export const a = 2; // why\n" });
  const file = join(dir, "a.ts");

  expect(edited(dir, file, bare(["bash", "git", "node"]))).toEqual({
    ...QUIET,
    stderr: note("jq is not on PATH"),
  });
  expect(edited(dir, file, bare(["bash", "git", "jq"]))).toEqual({
    ...QUIET,
    stderr: note("node is not on PATH"),
  });
  expect(hookRan("not json")).toEqual({ ...QUIET, stderr: note("the hook input did not parse as JSON") });

  writeFiles(dir, {
    ".githooks/no-comments/scan.cjs":
      "process.stderr.write('no-comments: too old');\nprocess.exitCode = 2;\n",
  });
  expect(edited(dir, file)).toEqual({
    ...QUIET,
    stderr:
      "cniska-gates: the no-comments scanner exited 2, so the edit's comments were not judged: no-comments: too old\n",
  });
});
