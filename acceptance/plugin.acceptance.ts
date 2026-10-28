import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import {
  checkout,
  type Env,
  gated,
  git,
  install,
  lines,
  pathOf,
  readText,
  removeScratchDirs,
  scratchDir,
  shell,
  writeFiles,
} from "./cli";
import { commentReply, KEPT_JAVASCRIPT } from "./no-comments";

afterEach(removeScratchDirs);

const PLUGIN = join(import.meta.dir, "..", "plugin");

const QUIET = { status: 0, stdout: "", stderr: "" };

const COMMAND = `"\${CLAUDE_PLUGIN_ROOT}"/hooks/after-edit.sh`;

const SKIP_COMMAND = `"\${CLAUDE_PLUGIN_ROOT}"/hooks/no-skip.sh`;

const SESSION_COMMAND = `"\${CLAUDE_PLUGIN_ROOT}"/hooks/session-start.sh`;

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

function unjudged(why: string): string {
  return `cniska-gates: ${why}, so the edit was neither formatted nor judged\n`;
}

test("AC-36 hands the agent the scanner's reply after an edit adding a comment, and says nothing otherwise", () => {
  expect(JSON.parse(readText(PLUGIN, ".claude-plugin/plugin.json"))).toMatchObject({ name: "cniska-gates" });
  expect(JSON.parse(readText(PLUGIN, "hooks/hooks.json"))).toEqual({
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: SKIP_COMMAND }] }],
      PostToolUse: [
        { matcher: "Edit|Write|MultiEdit", hooks: [{ type: "command", command: COMMAND, timeout: 60 }] },
      ],
      SessionStart: [{ hooks: [{ type: "command", command: SESSION_COMMAND }] }],
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
    stderr: unjudged("jq is not on PATH"),
  });
  expect(edited(dir, file, bare(["bash", "git", "jq"]))).toEqual({
    ...QUIET,
    stderr: note("node is not on PATH"),
  });
  expect(hookRan("not json")).toEqual({ ...QUIET, stderr: unjudged("the hook input did not parse as JSON") });

  writeFiles(dir, {
    ".githooks/no-comments/scan.cjs":
      "// agent-gate:no-comments:29\nprocess.stderr.write('no-comments: broken');\nprocess.exitCode = 2;\n",
  });
  expect(edited(dir, file)).toEqual({
    ...QUIET,
    stderr:
      "cniska-gates: the no-comments scanner exited 2, so the edit's comments were not judged: no-comments: broken\n",
  });

  writeFiles(dir, {
    ".githooks/no-comments/scan.cjs":
      "// agent-gate:no-comments:28\nprocess.stderr.write('no-comments: ran');\nprocess.exitCode = 1;\n",
  });
  expect(edited(dir, file)).toEqual({
    ...QUIET,
    stderr:
      "cniska-gates: .githooks/no-comments/scan.cjs has no --file before agent-gate:no-comments:29, so the edit's comments were not judged; agent-gates install updates it\n",
  });
});

const STRIP_WHY = lines([
  'const fs = require("node:fs");',
  'for (const file of fs.readdirSync(".").filter((name) => name.endsWith(".ts")))',
  '  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replaceAll(" // why", ""));',
]);

const FORMAT_HOOK = ".githooks/pre-commit.d/format";

const FORMAT_HOOK_V2 = readText(join(import.meta.dir, "fixtures"), "format-pre-commit-v2");

const FORMAT_TOOLS = ["bash", "git", "node", "jq", "sleep"];

function formatGated(files: Readonly<Record<string, string>> = {}): string {
  const dir = gated(["no-comments-javascript"], {
    "fmt.cjs": STRIP_WHY,
    "a.ts": "export const a = 1;\n",
    "b.ts": "export const b = 1;\n",
    ...files,
  });
  install(dir, ["format", "--command", "node fmt.cjs"]);
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "chore: format"]);
  return dir;
}

function stagedThenEdited(dir: string) {
  writeFiles(dir, { "b.ts": "export const b = 2; // why\n" });
  git(dir, ["add", "b.ts"]);
  writeFiles(dir, { "a.ts": "export const a = 2; // why\n" });
  return git(dir, ["diff", "--cached"]);
}

function sleeps(seconds: number): number {
  const listed = spawnSync("ps", ["-A", "-o", "command="], { encoding: "utf8" }).stdout;
  return listed.split("\n").filter((line) => line.trim() === `sleep ${seconds}`).length;
}

function timed<T>(act: () => T): { readonly took: number; readonly result: T } {
  const started = performance.now();
  const result = act();
  return { took: performance.now() - started, result };
}

test("AC-48 formats the edited file through the gate's own command before the scan reads it", () => {
  const dir = formatGated();
  const index = stagedThenEdited(dir);
  const watchdogs = sleeps(30);
  const { took, result } = timed(() => edited(dir, join(dir, "a.ts"), bare(FORMAT_TOOLS)));
  expect(result).toEqual(QUIET);
  expect(took).toBeLessThan(5000);
  expect(sleeps(30)).toBe(watchdogs);
  expect([readText(dir, "a.ts"), readText(dir, "b.ts")]).toEqual([
    "export const a = 2;\n",
    "export const b = 2;\n",
  ]);
  expect(git(dir, ["diff", "--cached"])).toBe(index);

  const sleepless = formatGated({ "late.cjs": 'setTimeout(() => require("./fmt.cjs"), 1000);\n' });
  install(sleepless, ["format", "--command", "node late.cjs"]);
  writeFiles(sleepless, { "a.ts": "export const a = 2; // why\n" });
  expect(edited(sleepless, join(sleepless, "a.ts"), bare(["bash", "git", "node", "jq"]))).toEqual(QUIET);
  expect(readText(sleepless, "a.ts")).toBe("export const a = 2;\n");
});

test("AC-49 tells the agent in one line when the format command fails or runs past its bound, and still scans", () => {
  const reply = commentReply([KEPT_JAVASCRIPT], [["a.ts", ["1  // why"]]]).trimEnd();
  const failing = formatGated({ "fmt.cjs": 'process.stderr.write("broken\\n");\nprocess.exitCode = 3;\n' });
  install(failing, ["format", "--command", "node 'fmt.cjs'"]);
  const failingIndex = stagedThenEdited(failing);
  expect(edited(failing, join(failing, "a.ts"), bare(FORMAT_TOOLS))).toEqual(
    told(`format: \`node 'fmt.cjs'\` exited 3, so the edited file was not formatted\n${reply}`),
  );
  expect(git(failing, ["diff", "--cached"])).toBe(failingIndex);

  const slow = formatGated({
    "late.cjs": 'setTimeout(() => require("./fmt.cjs"), 33000);\n',
    "slow.sh": "node late.cjs\nexit 0\n",
  });
  install(slow, ["format", "--command", "sh slow.sh"]);
  const slowIndex = stagedThenEdited(slow);
  const { took, result } = timed(() => edited(slow, join(slow, "a.ts"), bare(FORMAT_TOOLS)));
  expect(result).toEqual(
    told(
      `format: \`sh slow.sh\` ran past 30 s and was stopped, so the edited file was not formatted\n${reply}`,
    ),
  );
  expect(took).toBeLessThan(33000);
  Bun.sleepSync(Math.max(0, 36000 - took));
  expect([readText(slow, "a.ts"), git(slow, ["diff", "--cached"])]).toEqual([
    "export const a = 2; // why\n",
    slowIndex,
  ]);
}, 60000);

test("AC-50 leaves an earlier format hook and a checkout without the gate alone", () => {
  const dir = formatGated();
  writeFiles(dir, { [FORMAT_HOOK]: FORMAT_HOOK_V2.replace("command=''", "command='node fmt.cjs'") });
  const index = stagedThenEdited(dir);
  writeFiles(dir, { "a.ts": "export const a = 2;\n" });
  expect(edited(dir, join(dir, "a.ts"))).toEqual({
    ...QUIET,
    stderr:
      "cniska-gates: .githooks/pre-commit.d/format has no --run before agent-gate:format:3, so the edit was not formatted; agent-gates install updates it\n",
  });
  expect([readText(dir, "b.ts"), git(dir, ["diff", "--cached"])]).toEqual([
    "export const b = 2; // why\n",
    index,
  ]);

  const ungated = checkout({ "fmt.cjs": STRIP_WHY, "a.ts": "export const a = 2; // why\n" });
  expect(edited(ungated, join(ungated, "a.ts"), bare(FORMAT_TOOLS))).toEqual(QUIET);
  expect(readText(ungated, "a.ts")).toBe("export const a = 2; // why\n");
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
        permissionDecisionReason: `cniska-gates: ${reason} Fix what the refusing gate names instead.`,
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
  const spaced = join(scratchDir(), "sp ace");
  symlinkSync(dir, spaced);

  for (const command of [
    `mkdir -p ${fresh}; cd ${fresh}; git init -q; git commit -qm x --allow-empty --no-verify`,
    `cd ${ungated} && git commit --no-verify -m x`,
    `git -C ${ungated} commit --no-verify -m x`,
    "cat > notes.md <<'EOF'\ngit commit --no-verify -m x\nEOF",
    "cat > notes.md <<-EOF\n\tgit commit --no-verify -m x\n\tEOF",
    "mkdir -p docs && tee docs/notes.md <<'EOF'\ngit commit --no-verify -m x\nEOF",
    "{ cat > notes.md <<'EOF'\ngit commit --no-verify -m x\nEOF\n}",
    "git commit -m \"$(cat <<'EOF'\nfix: the owner's notes\nEOF\n)\"",
  ])
    expect(ranCommand(dir, command, tools)).toEqual(QUIET);

  for (const command of [
    `cd ${dir} && git commit --no-verify -m x`,
    `cd -P ${dir} && git commit --no-verify -m x`,
    `cd "${spaced}" && git commit --no-verify -m x`,
    `git -C ${dir} commit --no-verify -m x`,
    `cd ~ && git -C ${dir} commit --no-verify -m x`,
    `(cd ${dir} && git commit --no-verify -m x)`,
    `{ cd ${dir}; git commit --no-verify -m x; }`,
  ])
    expect(ranCommand(ungated, command, tools)).toEqual(skipped);
  for (const command of [
    `cd ${ungated}/missing; git commit --no-verify -m x`,
    `cd ${ungated} & git commit --no-verify -m x`,
    `cd ${ungated} | cat; git commit --no-verify -m x`,
    `cd ${ungated} && cd - && git commit --no-verify -m x`,
    `(cd ${ungated}); git commit --no-verify -m x`,
    `$(cd ${ungated} && true); git commit --no-verify -m x`,
    `\`cd ${ungated} && true\`; git commit --no-verify -m x`,
  ])
    expect(ranCommand(dir, command, tools)).toEqual(skipped);
  for (const command of [
    "cat > notes.md <<'EOF'\nthe owner's notes\nEOF\ngit commit --no-verify -m 'x'",
    'git commit -m "fix: read << markers"\ngit commit --no-verify -m x',
    "echo $((1<<2))\ngit commit --no-verify -m x",
    "bash <<EOF\ngit commit --no-verify -m x\nEOF",
    "cat > notes.md <<'A'; bash <<'B'\nnotes\nA\ngit commit --no-verify -m x\nB",
    "source /dev/stdin <<'EOF'\ngit commit --no-verify -m x\nEOF",
    "eval \"$(cat)\" <<'EOF'\ngit commit --no-verify -m x\nEOF",
    "cat <<'EOF' | sh\ngit commit --no-verify -m x\nEOF",
    "cat > notes.md <<EOF\n$(git commit --no-verify -m x)\nEOF",
    'cat > notes.md <<"E F"\nnotes\nE F\ngit commit --no-verify -m x',
  ])
    expect(ranCommand(dir, command, tools)).toEqual(skipped);
});

function sessionStarted(cwd: string, env: Env = {}) {
  const input = JSON.stringify({
    session_id: "made-up",
    cwd,
    hook_event_name: "SessionStart",
    source: "startup",
  });
  return shell(scratchDir(), SESSION_COMMAND, { CLAUDE_PLUGIN_ROOT: PLUGIN, ...env }, input);
}

const WIRED =
  "Each refusal names what to fix. The plugin denies a git command that skips the gates, such as `git commit --no-verify`.";

const UNWIRED =
  "They do not run in this clone until `core.hooksPath` is `.githooks`, so none refuses a commit or a push: `git config core.hooksPath .githooks` sets it. The plugin denies a git command that skips the gates, such as `git commit --no-verify`.";

function noted(lines: readonly string[], closing = WIRED) {
  return {
    status: 0,
    stdout: `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: ["cniska-gates: the gates installed in this checkout:", ...lines, closing].join(
          "\n",
        ),
      },
    })}\n`,
    stderr: "",
  };
}

const AT_COMMIT_FORMATS =
  "At commit the gate stages what it changed in each file the commit stages whole, and refuses the commit when the command fails, showing its output, or when it changes a partly staged file: stage that file whole or not at all.";

const FORMAT_INSTALL = "`agent-gates install` updates the hook so the plugin runs it after each edit.";

const EDIT_TOOLS_SCANNED =
  "- Edit files with the Edit or Write tool, never through Bash: only those edits are formatted and scanned for comments after the edit.";

const EDIT_TOOLS =
  "- Edit files with the Edit or Write tool, never through Bash: only those edits are formatted after the edit.";

const NO_COMMENTS_GATES =
  "- no-comments-javascript, no-comments-shell: after each edit the plugin names the comments the edit added.";

const REMOVE_COMMENTS = "remove each comment; a why belongs in a name, a test or the docs.";

const SUBJECT_AT_COMMIT =
  "at commit it refuses a subject that is not a Conventional Commit `type(scope): description` of an allowed type, is over 50 characters or is not ASCII, and a message with a body.";

const SUBJECT_AT_PUSH =
  "At push it judges the pushed commits the same way and also refuses a fixup!, squash! or amend! commit: squash it into the commit it names.";

const PUSH_UNJUDGED = "As installed, a push is not judged until `agent-gates install` adds its step.";

const SECRETS_AT_COMMIT =
  "at commit it refuses a change that adds a secret: a key, token or private key one of gitleaks' rules matches, or a literal value assigned to a `*_TOKEN` or `*_SECRET` name. Remove it, rotate it if it was ever pushed, or allow a reviewed false positive in `.no-secrets-allow`.";

const SECRETS_AT_PUSH = "At push it judges the pushed commits the same way.";

const ACTIONS_AT_COMMIT =
  "at commit it refuses a workflow or `action.yml` whose `uses:` names an action, reusable workflow or `docker://` image by anything but a full commit SHA or image digest. Pin each to the commit SHA of its release, with the version as a trailing comment (`owner/repo@<40 hex> # vX.Y.Z`); a `./` or `$/` path to the repository's own action passes.";

const ACTIONS_AT_PUSH = "At push it judges the pushed commits the same way.";

test("AC-51 tells the agent at session start which gates the checkout installs and how each refuses", () => {
  const dir = checkout({ "src/a.ts": "export const a = 1;\n", "run.sh": "echo hi\n" });
  install(dir, ["no-comments-javascript"]);
  install(dir, ["no-comments-shell"]);
  install(dir, ["format", "--command", "node 'fmt.cjs'"]);
  install(dir, ["commit-subject", "--prefixes", "feat,fix"]);
  install(dir, ["no-secrets"]);
  install(dir, ["pinned-actions"]);
  const tools = bare(["bash", "git", "jq"]);

  expect(sessionStarted(join(dir, "src"), tools)).toEqual(
    noted([
      `- format: \`node 'fmt.cjs'\` runs after each edit and again at commit, so never run it yourself. ${AT_COMMIT_FORMATS}`,
      EDIT_TOOLS_SCANNED,
      `${NO_COMMENTS_GATES} At commit and at push, a change that adds a comment is refused: ${REMOVE_COMMENTS}`,
      `- commit-subject, allowing the types feat, fix: ${SUBJECT_AT_COMMIT} ${SUBJECT_AT_PUSH}`,
      `- no-secrets: ${SECRETS_AT_COMMIT} ${SECRETS_AT_PUSH}`,
      `- pinned-actions: ${ACTIONS_AT_COMMIT} ${ACTIONS_AT_PUSH}`,
    ]),
  );

  const formatOnly = checkout({ "src/a.ts": "export const a = 1;\n" });
  install(formatOnly, ["format", "--command", "make fmt"]);
  expect(sessionStarted(formatOnly, tools)).toEqual(
    noted([
      `- format: \`make fmt\` runs after each edit and again at commit, so never run it yourself. ${AT_COMMIT_FORMATS}`,
      EDIT_TOOLS,
    ]),
  );

  writeFiles(dir, { [FORMAT_HOOK]: FORMAT_HOOK_V2.replace("command=''", "command='make fmt'") });
  writeFiles(dir, { ".githooks/commit-msg": "#!/bin/sh\nexit 0\n" });
  rmSync(join(dir, ".githooks/pre-push.d/no-comments"));
  rmSync(join(dir, ".githooks/pre-push.d/no-secrets"));
  rmSync(join(dir, ".githooks/pre-push.d/pinned-actions"));
  expect(sessionStarted(dir, tools)).toEqual(
    noted([
      `- format: \`make fmt\` runs at commit only, so never run it yourself before committing. ${FORMAT_INSTALL} ${AT_COMMIT_FORMATS}`,
      `${NO_COMMENTS_GATES} At commit, a change that adds a comment is refused: ${REMOVE_COMMENTS} ${PUSH_UNJUDGED}`,
      `- no-secrets: ${SECRETS_AT_COMMIT} ${PUSH_UNJUDGED}`,
      `- pinned-actions: ${ACTIONS_AT_COMMIT} ${PUSH_UNJUDGED}`,
    ]),
  );

  writeFiles(dir, { ".githooks/no-comments/scan.cjs": "// agent-gate:no-comments:28\n" });
  writeFiles(dir, { ".githooks/no-secrets/scan.cjs": "module.exports = {};\n" });
  writeFiles(dir, { ".githooks/pinned-actions/scan.cjs": "module.exports = {};\n" });
  expect(sessionStarted(dir, tools)).toEqual(
    noted([
      `- format: \`make fmt\` runs at commit only, so never run it yourself before committing. ${FORMAT_INSTALL} ${AT_COMMIT_FORMATS}`,
      `- no-comments-javascript, no-comments-shell: the plugin does not name the comments an edit added until \`agent-gates install\` updates the scanner. At commit, a change that adds a comment is refused: ${REMOVE_COMMENTS} ${PUSH_UNJUDGED}`,
    ]),
  );

  const subjectOnly = gated(["commit-subject"]);
  expect(sessionStarted(subjectOnly, tools)).toEqual(
    noted([`- commit-subject: ${SUBJECT_AT_COMMIT} ${SUBJECT_AT_PUSH}`]),
  );
  rmSync(join(subjectOnly, ".githooks/pre-push.d/commit-subject"));
  expect(sessionStarted(subjectOnly, tools)).toEqual(
    noted([`- commit-subject: ${SUBJECT_AT_COMMIT} ${PUSH_UNJUDGED}`]),
  );
});

test("AC-53 names no refusal at session start while core.hooksPath does not resolve to .githooks", () => {
  const dir = checkout({ "src/a.ts": "export const a = 1;\n", "run.sh": "echo hi\n" });
  install(dir, ["no-comments-javascript"]);
  install(dir, ["no-comments-shell"]);
  install(dir, ["format", "--command", "node 'fmt.cjs'"]);
  install(dir, ["commit-subject", "--prefixes", "feat,fix"]);
  install(dir, ["no-secrets"]);
  install(dir, ["pinned-actions"]);
  const tools = bare(["bash", "git", "jq"]);
  const unwired = noted(
    [
      "- format: `node 'fmt.cjs'` runs after each edit, so never run it yourself after an edit.",
      EDIT_TOOLS_SCANNED,
      NO_COMMENTS_GATES,
      "- commit-subject, allowing the types feat, fix.",
      "- no-secrets.",
      "- pinned-actions.",
    ],
    UNWIRED,
  );

  git(dir, ["config", "--unset", "core.hooksPath"]);
  expect(sessionStarted(join(dir, "src"), tools)).toEqual(unwired);
  git(dir, ["config", "core.hooksPath", ".husky"]);
  expect(sessionStarted(join(dir, "src"), tools)).toEqual(unwired);

  git(dir, ["config", "core.hooksPath", "./.githooks/"]);
  expect(sessionStarted(join(dir, "src"), tools)).toEqual(
    noted([
      `- format: \`node 'fmt.cjs'\` runs after each edit and again at commit, so never run it yourself. ${AT_COMMIT_FORMATS}`,
      EDIT_TOOLS_SCANNED,
      `${NO_COMMENTS_GATES} At commit and at push, a change that adds a comment is refused: ${REMOVE_COMMENTS}`,
      `- commit-subject, allowing the types feat, fix: ${SUBJECT_AT_COMMIT} ${SUBJECT_AT_PUSH}`,
      `- no-secrets: ${SECRETS_AT_COMMIT} ${SECRETS_AT_PUSH}`,
      `- pinned-actions: ${ACTIONS_AT_COMMIT} ${ACTIONS_AT_PUSH}`,
    ]),
  );

  writeFiles(dir, { [FORMAT_HOOK]: FORMAT_HOOK_V2.replace("command=''", "command='make fmt'") });
  git(dir, ["config", "--unset", "core.hooksPath"]);
  expect(sessionStarted(join(dir, "src"), tools)).toEqual(
    noted(
      [
        `- format: nothing runs \`make fmt\` in this clone, so run it yourself before committing. ${FORMAT_INSTALL}`,
        NO_COMMENTS_GATES,
        "- commit-subject, allowing the types feat, fix.",
        "- no-secrets.",
        "- pinned-actions.",
      ],
      UNWIRED,
    ),
  );
});

test("AC-52 says nothing at session start without the gates, and only a note when it cannot read them", () => {
  const tools = bare(["bash", "git", "jq"]);
  const unmarked = checkout({
    "package.json": '{ "scripts": { "format": "biome format --write" } }\n',
    ".githooks/commit-msg": "#!/bin/sh\nexit 0\n",
    ".githooks/pre-commit.d/format": "#!/bin/sh\ncommand='npm run format'\n",
    ".githooks/no-comments/javascript.cjs": "module.exports = {};\n",
  });
  expect(sessionStarted(unmarked, tools)).toEqual(QUIET);
  expect(sessionStarted(scratchDir(), tools)).toEqual(QUIET);
  expect(sessionStarted(join(scratchDir(), "gone"), tools)).toEqual(QUIET);
  expect(sessionStarted("relative/dir", tools)).toEqual(QUIET);

  const dir = gated(["commit-subject"]);
  expect(sessionStarted(dir, bare(["bash", "git"]))).toEqual({
    ...QUIET,
    stderr: "cniska-gates: jq is not on PATH, so the session was not told which gates are installed\n",
  });
  expect(shell(scratchDir(), SESSION_COMMAND, { CLAUDE_PLUGIN_ROOT: PLUGIN }, "not json")).toEqual({
    ...QUIET,
    stderr:
      "cniska-gates: the hook input did not parse as JSON, so the session was not told which gates are installed\n",
  });
});
