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

const SKIP_COMMAND = `"\${CLAUDE_PLUGIN_ROOT}"/hooks/no-skip.sh`;

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
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: SKIP_COMMAND }] }],
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

function ranCommand(cwd: string, command: string, env: Env = {}) {
  const input = JSON.stringify({
    cwd,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  });
  return shell(scratchDir(), SKIP_COMMAND, { CLAUDE_PLUGIN_ROOT: PLUGIN, ...env }, input);
}

function denied(reason: string) {
  return {
    status: 0,
    stdout: `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `cniska-gates: ${reason} Fix what the refusing gate names instead; CI refuses what the gates refuse anyway.`,
      },
    })}\n`,
    stderr: "",
  };
}

test("AC-41 denies a git command that skips the gates, naming them, and lets every other command through", () => {
  const dir = gated(["commit-subject", "no-comments-javascript"]);
  const tools = bare(["bash", "git", "jq"]);
  const gates = "commit-subject, no-comments";
  const pointed = (how: string) =>
    denied(
      `\`git ${how}\` points git away from .githooks, which skips the gates this repo runs on commit (${gates}) and on push (${gates}).`,
    );

  for (const [command, how] of [
    ['git commit --no-verify -m "feat: add a thing"', "--no-verify"],
    ["git add -A && git commit -anm wip", "-anm"],
  ] as const)
    expect(ranCommand(dir, command, tools)).toEqual(
      denied(`\`git commit ${how}\` skips the gates this repo runs on commit: ${gates}.`),
    );
  expect(ranCommand(dir, "git push --no-verify origin main", tools)).toEqual(
    denied(`\`git push --no-verify\` skips the gates this repo runs on push: ${gates}.`),
  );
  expect(ranCommand(dir, "cd src; git -c Core.HooksPath=/dev/null push", tools)).toEqual(
    pointed("-c Core.HooksPath=/dev/null"),
  );
  expect(ranCommand(dir, "git config core.hooksPath .husky", tools)).toEqual(
    pointed("config core.hooksPath .husky"),
  );
  expect(ranCommand(dir, `git config core.hooksPath ${dir}`, tools)).toEqual(
    pointed(`config core.hooksPath ${dir}`),
  );
  expect(ranCommand(dir, "git config --unset core.hooksPath", tools)).toEqual(
    pointed("config --unset core.hooksPath"),
  );

  for (const command of [
    'git commit -am "docs: explain --no-verify"',
    "git commit -m 'feat: x; git push --no-verify'",
    "git push -n origin main",
    "git config core.hooksPath .githooks",
    "git config --get core.hooksPath",
    "git -c core.hooksPath=./.githooks/ commit -m x",
    `git config core.hooksPath ${join(dir, ".githooks")}`,
    "echo hi > .githooks/pre-push.d/commit-subject",
  ])
    expect(ranCommand(dir, command, tools)).toEqual(QUIET);

  expect(ranCommand(checkout(), "git commit --no-verify -m x", tools)).toEqual(QUIET);
  expect(ranCommand(dir, "git commit --no-verify -m x", bare(["bash", "git"]))).toEqual({
    ...QUIET,
    stderr: "cniska-gates: jq is not on PATH, so the command was not checked for skipping the gates\n",
  });
  expect(shell(scratchDir(), SKIP_COMMAND, { CLAUDE_PLUGIN_ROOT: PLUGIN }, "not json")).toEqual({
    ...QUIET,
    stderr:
      "cniska-gates: the hook input did not parse as JSON, so the command was not checked for skipping the gates\n",
  });
});

test("AC-42 judges each git command against the repo it targets, past heredoc bodies", () => {
  const dir = gated(["commit-subject", "no-comments-javascript"]);
  const tools = bare(["bash", "git", "jq"]);
  const skipped = denied(
    "`git commit --no-verify` skips the gates this repo runs on commit: commit-subject, no-comments.",
  );
  const fresh = join(scratchDir(), "state-n");
  const ungated = checkout();

  for (const command of [
    `mkdir -p ${fresh}; cd ${fresh}; git init -q; git commit -qm x --allow-empty --no-verify`,
    `cd ${ungated} && git commit --no-verify -m x`,
    `git -C ${ungated} commit --no-verify -m x`,
    "cat > notes.md <<'EOF'\ngit commit --no-verify -m x\nEOF",
  ])
    expect(ranCommand(dir, command, tools)).toEqual(QUIET);

  for (const command of [
    `cd ${dir} && git commit --no-verify -m x`,
    `cd ${dir}/missing; git commit --no-verify -m x`,
    `git -C ${dir} commit --no-verify -m x`,
    `cd ~ && git -C ${dir} commit --no-verify -m x`,
  ])
    expect(ranCommand(ungated, command, tools)).toEqual(skipped);
  expect(
    ranCommand(dir, "cat > notes.md <<'EOF'\nthe owner's notes\nEOF\ngit commit --no-verify -m 'x'", tools),
  ).toEqual(skipped);
});
