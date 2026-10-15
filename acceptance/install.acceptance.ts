import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  agentGates,
  COMMIT_SUBJECT_FILES,
  check,
  checkout,
  commitAs,
  doctor,
  each,
  git,
  hooksPath,
  type InstallResult,
  install,
  installs,
  jsonLine,
  modeOf,
  readText,
  refuses,
  removeScratch,
  scratchDir,
  shell,
  writeFiles,
} from "./cli";
import { ALL_LANGUAGES, LANGUAGES } from "./no-comments";

afterEach(removeScratch);

const PREPARE = "! git rev-parse --git-dir >/dev/null 2>&1 || git config core.hooksPath .githooks";

const EARLIER_PREPARE = "git config core.hooksPath .githooks";

const GITATTRIBUTES_V1 = "# agent-gate:githooks:1\n* linguist-generated\n";

const OWN_HOOK = "#!/bin/sh\nexit 0\n";

const PUSH_FILES = [".githooks/pre-push", ".githooks/judge-push"];

const NO_COMMENTS_FILES = [
  ".githooks/pre-commit",
  ".githooks/pre-push",
  ".githooks/pre-commit.d/no-comments",
  ".githooks/pre-push.d/no-comments",
  ".githooks/no-comments/scan.cjs",
  ".github/workflows/no-comments.yml",
  ".githooks/judge-push",
];

const NO_COMMENTS_AFTER_COMMIT_SUBJECT = NO_COMMENTS_FILES.filter((path) => !PUSH_FILES.includes(path));

function currentBytes(gates: readonly string[], path: string): string {
  const reference = checkout();
  install(reference, gates);
  return readText(reference, path);
}

test("AC-3 installs commit-subject at the checkout's root and wires the hooks", () => {
  const dir = checkout();
  mkdirSync(join(dir, "sub"));
  installs(join(dir, "sub"), ["commit-subject"], {
    gates: ["commit-subject"],
    files: each("missing", COMMIT_SUBJECT_FILES),
    prepare: "absent",
  });
  expect(readdirSync(join(dir, "sub"))).toEqual([]);
  expect(COMMIT_SUBJECT_FILES.map((path) => modeOf(dir, path))).toEqual([
    0o755, 0o644, 0o644, 0o755, 0o755, 0o644,
  ]);
  expect(readText(dir, ".githooks/commit-msg")).toMatch(/^# agent-gate:commit-subject:\d+$/m);
  expect(readText(dir, ".github/workflows/commits.yml")).toMatch(/^# agent-gate:commit-subject:\d+$/m);
  expect(readText(dir, ".githooks/.gitattributes")).toMatch(
    /^# agent-gate:githooks:\d+\n\* linguist-generated eol=lf\n$/,
  );
  expect(hooksPath(dir)).toBe(".githooks");
});

test("AC-4 installs each no-comments language, and reads the gates back from their markers", () => {
  for (const language of LANGUAGES) {
    const dir = checkout();
    const adapter = `.githooks/no-comments/${language}.cjs`;
    const files = [".githooks/.gitattributes", ...NO_COMMENTS_FILES, adapter];
    installs(dir, [`no-comments-${language}`], {
      gates: [`no-comments-${language}`],
      files: each("missing", files),
      prepare: "absent",
    });
    expect(files.map((path) => modeOf(dir, path))).toEqual([
      0o644, 0o755, 0o755, 0o755, 0o755, 0o644, 0o644, 0o644, 0o644,
    ]);
    expect(readText(dir, adapter)).toMatch(new RegExp(`^// agent-gate:no-comments-${language}:\\d+$`, "m"));
  }

  const dir = checkout();
  const gates = ["commit-subject", ...ALL_LANGUAGES];
  for (const gate of gates) install(dir, [gate]);
  installs(dir, [], {
    gates,
    files: each("installed", [
      ...COMMIT_SUBJECT_FILES,
      ...NO_COMMENTS_AFTER_COMMIT_SUBJECT,
      ...LANGUAGES.map((language) => `.githooks/no-comments/${language}.cjs`),
    ]),
    prepare: "absent",
  });
  rmSync(join(dir, ".githooks/no-comments/rust.cjs"));
  expect(check(dir, "gates")).toEqual({
    name: "gates",
    state: "ok",
    detail:
      "commit-subject, no-comments-javascript, no-comments-dart, no-comments-sql, no-comments-shell, no-comments-python",
    fix: null,
  });
});

test("AC-5 refuses an install that names no gate where none is installed", () => {
  const dir = checkout();
  refuses(dir, [], {
    kind: "refusal",
    code: "no_gates_chosen",
    message: `${dir} has no gates installed and none were named, so there is nothing to install`,
    meta: { root: dir },
    resolve:
      "stop and ask the owner which gates the project runs, then agent-gates install <gate>..., choosing from commit-subject, format, no-comments-javascript, no-comments-dart, no-comments-sql, no-comments-shell, no-comments-rust, no-comments-python, no-comments (each language the tracked files hold)",
  });
  expect(readdirSync(dir)).toEqual([".git"]);
  expect(hooksPath(dir)).toBe("");
});

test("AC-6 acts on each file's state, keeping a backup of each hand edit", () => {
  const gates = ["commit-subject", "no-comments-javascript"];
  const dir = checkout();
  install(dir, gates);
  const ahead = readText(dir, ".githooks/commit-msg").replace(
    /agent-gate:commit-subject:\d+/,
    "agent-gate:commit-subject:999",
  );
  const workflow = currentBytes(gates, ".github/workflows/commits.yml");
  writeFiles(dir, {
    ".githooks/.gitattributes": GITATTRIBUTES_V1,
    ".github/workflows/commits.yml": `${workflow}# local\n`,
    ".githooks/commit-msg": ahead,
  });
  chmodSync(join(dir, ".githooks/pre-commit"), 0o644);

  const judged = doctor(dir);
  expect(judged.status).toBe(1);
  const named = (name: string) => judged.checks.find((found) => found.name === name);
  expect([
    named(".githooks/.gitattributes"),
    named(".github/workflows/commits.yml"),
    named(".githooks/commit-msg"),
    named(".githooks/pre-commit"),
  ]).toEqual([
    {
      name: ".githooks/.gitattributes",
      state: "warn",
      detail: "an earlier version of this gate file",
      fix: "agent-gates install",
    },
    {
      name: ".github/workflows/commits.yml",
      state: "warn",
      detail: "differs from every version of this gate file; install sets it aside before replacing it",
      fix: "agent-gates install",
    },
    {
      name: ".githooks/commit-msg",
      state: "warn",
      detail: "written by a newer agent-gates than this one",
      fix: "update agent-gates, then agent-gates install",
    },
    {
      name: ".githooks/pre-commit",
      state: "fail",
      detail: "not executable, so git skips the hook",
      fix: "agent-gates install",
    },
  ]);

  const pushFiles = COMMIT_SUBJECT_FILES.slice(3);
  const untouched = [...NO_COMMENTS_AFTER_COMMIT_SUBJECT.slice(1), ".githooks/no-comments/javascript.cjs"];
  installs(dir, [], {
    gates,
    files: [
      { target: ".githooks/commit-msg", state: "ahead", backup: null },
      {
        target: ".github/workflows/commits.yml",
        state: "changed",
        backup: ".github/workflows/commits.yml.agent-gates-backup",
      },
      { target: ".githooks/.gitattributes", state: "behind", backup: null },
      ...each("installed", pushFiles),
      { target: ".githooks/pre-commit", state: "not-executable", backup: null },
      ...each("installed", untouched),
    ],
    prepare: "absent",
  });
  expect(readText(dir, ".githooks/commit-msg")).toBe(ahead);
  expect(readText(dir, ".githooks/.gitattributes")).toBe(currentBytes(gates, ".githooks/.gitattributes"));
  expect(modeOf(dir, ".githooks/pre-commit")).toBe(0o755);
  expect(readText(dir, ".github/workflows/commits.yml")).toBe(workflow);
  expect(readText(dir, ".github/workflows/commits.yml.agent-gates-backup")).toBe(`${workflow}# local\n`);
  expect(readdirSync(join(dir, ".githooks")).filter((name) => name.includes("backup"))).toEqual([]);

  writeFiles(dir, { ".github/workflows/commits.yml": `${workflow}# again\n` });
  installs(dir, [], {
    gates,
    files: [
      { target: ".githooks/commit-msg", state: "ahead", backup: null },
      {
        target: ".github/workflows/commits.yml",
        state: "changed",
        backup: ".github/workflows/commits.yml.agent-gates-backup-2",
      },
      ...each("installed", [".githooks/.gitattributes", ...pushFiles, ".githooks/pre-commit", ...untouched]),
    ],
    prepare: "absent",
  });
  expect([
    readText(dir, ".github/workflows/commits.yml.agent-gates-backup"),
    readText(dir, ".github/workflows/commits.yml.agent-gates-backup-2"),
  ]).toEqual([`${workflow}# local\n`, `${workflow}# again\n`]);
});

test("AC-7 refuses a project's own hook, and sets aside its own workflow", () => {
  for (const [gate, target] of [
    ["commit-subject", ".githooks/commit-msg"],
    ["no-comments-javascript", ".githooks/pre-commit.d/no-comments"],
  ] as const) {
    const dir = checkout({ [target]: OWN_HOOK });
    chmodSync(join(dir, target), 0o755);
    const message = `${dir} has its own ${target}, which a gate would replace`;
    const resolve = `stop and hand this error to the owner: ${dir}'s ${target} must move out before the gates install; a step that runs before each commit belongs in .githooks/pre-commit.d/<name>, one that runs before each push in .githooks/pre-push.d/<name>, and commit-subject owns .githooks/commit-msg`;
    refuses(dir, [gate], {
      kind: "refusal",
      code: "hook_occupied",
      message,
      meta: { root: dir, target },
      resolve,
    });
    expect([git(dir, ["ls-files", "--others"]), readText(dir, target), hooksPath(dir)]).toEqual([
      target,
      OWN_HOOK,
      "",
    ]);

    rmSync(join(dir, target));
    install(dir, [gate]);
    writeFiles(dir, { [target]: OWN_HOOK });
    chmodSync(join(dir, target), 0o755);
    const judged = doctor(dir);
    expect(judged.status).toBe(1);
    expect(judged.checks.find((found) => found.name === target)).toEqual({
      name: target,
      state: "fail",
      detail: message,
      fix: resolve,
    });
  }

  const dir = checkout({ ".github/workflows/commits.yml": "name: ours\n" });
  installs(dir, ["commit-subject"], {
    gates: ["commit-subject"],
    files: [
      { target: ".githooks/commit-msg", state: "missing", backup: null },
      {
        target: ".github/workflows/commits.yml",
        state: "changed",
        backup: ".github/workflows/commits.yml.agent-gates-backup",
      },
      ...each("missing", COMMIT_SUBJECT_FILES.slice(2)),
    ],
    prepare: "absent",
  });
  expect([
    readText(dir, ".github/workflows/commits.yml.agent-gates-backup"),
    readText(dir, ".github/workflows/commits.yml"),
  ]).toEqual(["name: ours\n", currentBytes(["commit-subject"], ".github/workflows/commits.yml")]);
});

test("AC-8 accepts the hooks path however it is spelled, and refuses another", () => {
  const spelled = checkout();
  git(spelled, ["config", "core.hooksPath", "./.githooks/"]);
  install(spelled, ["commit-subject"]);
  expect(hooksPath(spelled)).toBe("./.githooks/");
  expect(check(spelled, "hooksPath")).toEqual({
    name: "hooksPath",
    state: "ok",
    detail: "core.hooksPath is .githooks",
    fix: null,
  });

  const husky = checkout();
  git(husky, ["config", "core.hooksPath", ".husky"]);
  const message = `${husky} runs its git hooks from .husky, so the gates in .githooks would never run`;
  const resolve = `stop and hand this error to the owner: ${husky}'s hooks must move to .githooks before the gates install`;
  refuses(husky, ["commit-subject"], {
    kind: "refusal",
    code: "hooks_path_occupied",
    message,
    meta: { root: husky, hooksPath: ".husky" },
    resolve,
  });
  expect(readdirSync(husky)).toEqual([".git"]);
  git(husky, ["config", "--unset", "core.hooksPath"]);
  install(husky, ["commit-subject"]);
  git(husky, ["config", "core.hooksPath", ".husky"]);
  expect(check(husky, "hooksPath")).toEqual({
    name: "hooksPath",
    state: "fail",
    detail: message,
    fix: resolve,
  });

  const unset = checkout();
  install(unset, ["commit-subject"]);
  git(unset, ["config", "--unset", "core.hooksPath"]);
  const ran = agentGates(unset, ["doctor"]);
  expect([ran.status, ran.stderr]).toEqual([1, ""]);
  expect(jsonLine(ran.stdout)).toEqual({
    command: "doctor",
    ok: true,
    result: {
      checks: [
        { name: "gates", state: "ok", detail: "commit-subject", fix: null },
        ...COMMIT_SUBJECT_FILES.map((name) => ({ name, state: "ok", detail: "installed", fix: null })),
        {
          name: "hooksPath",
          state: "fail",
          detail: "core.hooksPath is unset, so git never runs the gates in .githooks",
          fix: "agent-gates install",
        },
        {
          name: "prepare",
          state: "ok",
          detail: "no package.json, so each contributor runs git config core.hooksPath .githooks once",
          fix: null,
        },
        {
          name: "commit prefixes",
          state: "ok",
          detail: "none installed, so the gate allows its default set",
          fix: null,
        },
      ],
      failing: 1,
    },
  });
});

test("AC-9 wires the prepare script, keeping the manifest's shape, and refuses another", () => {
  const commitSubject = (prepare: string): InstallResult => ({
    gates: ["commit-subject"],
    files: each("missing", COMMIT_SUBJECT_FILES),
    prepare,
  });
  const manifest = { name: "app", scripts: { test: "bun test" }, private: true };
  const fresh = checkout({ "package.json": `${JSON.stringify(manifest, null, 4)}\n` });
  installs(fresh, ["commit-subject"], commitSubject("missing"));
  const wired = `${JSON.stringify({ ...manifest, scripts: { test: "bun test", prepare: PREPARE } }, null, 4)}\n`;
  expect(readText(fresh, "package.json")).toBe(wired);

  const earlier = checkout({
    "package.json": `${JSON.stringify({ scripts: { prepare: EARLIER_PREPARE }, name: "app" }, null, "\t")}\n`,
  });
  installs(earlier, ["commit-subject"], commitSubject("behind"));
  expect(readText(earlier, "package.json")).toBe(
    `${JSON.stringify({ scripts: { prepare: PREPARE }, name: "app" }, null, "\t")}\n`,
  );

  const occupiedText = '{ "scripts": { "prepare": "husky" } }\n';
  const occupied = checkout({ "package.json": occupiedText });
  const occupiedPath = join(occupied, "package.json");
  const occupiedError = (path: string) => ({
    message: `${path} runs \`husky\` as its prepare script, so a fresh clone would not wire the hooks`,
    resolve: `stop and hand this error to the owner: ${path}'s prepare script must become \`${PREPARE}\` before the gates install`,
  });
  refuses(occupied, ["commit-subject"], {
    kind: "refusal",
    code: "prepare_occupied",
    ...occupiedError(occupiedPath),
    meta: { path: occupiedPath, prepare: "husky", wanted: PREPARE },
  });
  expect([readdirSync(occupied).sort(), readText(occupied, "package.json"), hooksPath(occupied)]).toEqual([
    [".git", "package.json"],
    occupiedText,
    "",
  ]);

  const broken = checkout({ "package.json": "{ nope\n" });
  const brokenPath = join(broken, "package.json");
  const brokenRun = agentGates(broken, ["install", "commit-subject"]);
  expect([brokenRun.status, brokenRun.stdout]).toEqual([1, ""]);
  expect(jsonLine(brokenRun.stderr)).toEqual({
    command: "install",
    ok: false,
    error: {
      kind: "refusal",
      code: "manifest_unparseable",
      message: expect.stringMatching(
        new RegExp(`^${brokenPath} does not parse, so what the project declares is unknown: `),
      ),
      meta: { path: brokenPath, detail: expect.any(String) },
      resolve: `stop and hand this error to the owner: ${brokenPath} must parse`,
    },
  });
  expect([readdirSync(broken).sort(), hooksPath(broken)]).toEqual([[".git", "package.json"], ""]);

  const judged = checkout();
  install(judged, ["commit-subject"]);
  expect(check(judged, "prepare")).toEqual({
    name: "prepare",
    state: "ok",
    detail: "no package.json, so each contributor runs git config core.hooksPath .githooks once",
    fix: null,
  });
  for (const [text, state, detail] of [
    ["{}\n", "warn", "package.json has no prepare script, so a fresh clone runs no gate"],
    [
      `{ "scripts": { "prepare": "${EARLIER_PREPARE}" } }\n`,
      "warn",
      "package.json's prepare is an earlier wiring",
    ],
    [wired, "ok", "package.json's prepare wires the hooks on install"],
  ] as const) {
    writeFiles(judged, { "package.json": text });
    expect(check(judged, "prepare")).toEqual({
      name: "prepare",
      state,
      detail,
      fix: state === "ok" ? null : "agent-gates install",
    });
  }
  writeFiles(judged, { "package.json": occupiedText });
  const judgedError = occupiedError(join(judged, "package.json"));
  expect(check(judged, "prepare")).toEqual({
    name: "prepare",
    state: "fail",
    detail: judgedError.message,
    fix: judgedError.resolve,
  });
  writeFiles(judged, { "package.json": "[]\n" });
  expect(check(judged, "prepare")).toEqual({
    name: "prepare",
    state: "fail",
    detail: `${join(judged, "package.json")} does not parse, so what the project declares is unknown: the manifest is not an object`,
    fix: `stop and hand this error to the owner: ${join(judged, "package.json")} must parse`,
  });

  git(fresh, ["add", "-A"]);
  commitAs(fresh, "chore: start");
  const clone = join(scratchDir(), "clone");
  git(fresh, ["clone", "-q", fresh, clone]);
  expect(hooksPath(clone)).toBe("");
  expect(shell(clone, PREPARE).status).toBe(0);
  expect(hooksPath(clone)).toBe(".githooks");
  const outside = scratchDir();
  expect(shell(outside, PREPARE)).toEqual({ status: 0, stdout: "", stderr: "" });
  expect(readdirSync(outside)).toEqual([]);
});

test("AC-10 refuses a file it cannot write", () => {
  const dir = checkout({ ".github": "not a directory\n" });
  const path = join(dir, ".github/workflows/commits.yml");
  refuses(dir, ["commit-subject"], {
    kind: "refusal",
    code: "write_failed",
    message: expect.stringMatching(new RegExp(`^${path} could not be written: `)),
    meta: { path, detail: expect.any(String) },
    resolve: `stop and hand this error to the owner: ${path} must be writable`,
  });
});
