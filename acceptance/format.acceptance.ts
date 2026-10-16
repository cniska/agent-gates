import { afterEach, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  bypassing,
  check,
  checkout,
  commitAs,
  commitStaged,
  committing,
  doctor,
  each,
  git,
  gitRan,
  install,
  installed,
  installs,
  readText,
  refuses,
  removeScratch,
  shell,
  usageCode,
  writeFiles,
} from "./cli";

afterEach(removeScratch);

const UPPERCASE = 'for f in *.txt; do tr a-z A-Z < "$f" > "$f.tmp" && mv "$f.tmp" "$f"; done\n';

const HOOK = ".githooks/pre-commit.d/format";

const QUOTED = 'say "hi"\\\tnow.txt';

const FILES = [HOOK, ".githooks/.gitattributes", ".githooks/pre-commit"];

const NAME_THE_COMMAND =
  'agent-gates install format --command "<command>", such as --command "npm run lint:fix"';

function formatted(files: Readonly<Record<string, string>> = {}): string {
  const dir = checkout({ "fmt.sh": UPPERCASE, ...files });
  install(dir, ["format", "--command", "sh fmt.sh"]);
  git(dir, ["add", "-A"]);
  commitAs(dir, "chore: start");
  return dir;
}

test("AC-30 refuses format without --command, which then installs a working gate", () => {
  const declared = checkout({
    Makefile: "format:\n\ttrue\n",
    "package.json": '{ "scripts": { "format": "true" } }\n',
    "bun.lock": "",
  });
  refuses(declared, ["format"], {
    kind: "refusal",
    code: "fill_missing",
    message: `${declared}'s format gate runs the project's own format command, and none was given with --command`,
    meta: { root: declared, fill: "command" },
    resolve: NAME_THE_COMMAND,
  });
  expect(readdirSync(declared).sort()).toEqual([".git", "Makefile", "bun.lock", "package.json"]);

  const dir = checkout({ "fmt.sh": UPPERCASE, Makefile: "fmt:\n\t@sh fmt.sh\n" });
  const before = git(dir, ["status", "--porcelain", "--untracked-files=all"]);
  installs(dir, ["format", "--command", "make fmt"], {
    gates: ["format"],
    files: each("missing", FILES),
    prepare: "absent",
    fills: { command: "make fmt", prefixes: null },
  });
  expect([existsSync(join(dir, ".github")), existsSync(join(dir, ".githooks/ci-setup"))]).toEqual([
    false,
    false,
  ]);
  expect(git(dir, ["status", "--porcelain", "--untracked-files=all", "--", ":!.githooks", ":!.github"])).toBe(
    before,
  );
  git(dir, ["add", "-A"]);
  commitAs(dir, "chore: start");
  writeFiles(dir, { "a.txt": "hello\n" });
  git(dir, ["add", "a.txt"]);
  expect(commitStaged(dir)).toEqual({ status: 0, stderr: "", made: true });
  expect(git(dir, ["show", "HEAD:a.txt"])).toBe("HELLO");
});

test("AC-31 keeps the command a reinstall is not given, and rewrites one it is", () => {
  const dir = checkout();
  install(dir, ["format", "--command", "sh fmt.sh"]);
  expect(installed(dir, [])).toMatchObject({
    files: each("installed", FILES),
    fills: { command: "sh fmt.sh" },
  });
  expect(installed(dir, ["format", "--command", "cargo fmt"])).toMatchObject({
    files: [{ target: HOOK, state: "reconfigured", backup: null }, ...each("installed", FILES).slice(1)],
    fills: { command: "cargo fmt" },
  });
  expect(readText(dir, HOOK)).toContain("\ncommand='cargo fmt'\n");
  expect(readdirSync(join(dir, ".githooks/pre-commit.d"))).toEqual(["format"]);

  const bare = checkout();
  for (const args of [
    ["--command", "cargo fmt"],
    ["commit-subject", "--command", "cargo fmt"],
    ["format", "--command"],
    ["format", "--command", "x", "--command", "y"],
  ])
    expect(usageCode(bare, args)).toEqual([args, 2, "flag_misplaced"]);
  const setup = ["format", "--command", "x", "--setup", "pnpm install"];
  expect(usageCode(bare, setup)).toEqual([setup, 2, "unknown_gate"]);
  expect(existsSync(join(bare, ".githooks"))).toBe(false);
});

test("AC-32 formats the commit, refusing a partly staged file the command changes", () => {
  const dir = formatted({ "b.txt": "B\n", "c.txt": "C\n" });
  writeFiles(dir, { "a.txt": "hello\n" });
  git(dir, ["add", "a.txt"]);
  expect(commitStaged(dir)).toEqual({ status: 0, stderr: "", made: true });
  expect(git(dir, ["show", "HEAD:a.txt"])).toBe("HELLO");

  writeFiles(dir, { "b.txt": "Bc\n" });
  git(dir, ["add", "b.txt"]);
  writeFiles(dir, { "b.txt": "Bc\nD\n" });
  expect(commitStaged(dir)).toEqual({
    status: 1,
    stderr:
      "format: `sh fmt.sh` changes these partly staged files, so the commit would not be formatted; stage each whole or not at all, then commit again:\n  b.txt\n",
    made: false,
  });
  expect(git(dir, ["show", ":b.txt"])).toBe("Bc");

  writeFiles(dir, { "b.txt": "BC\n" });
  git(dir, ["add", "b.txt"]);
  writeFiles(dir, { "b.txt": "BC\nD\n" });
  expect(commitStaged(dir)).toEqual({ status: 0, stderr: "", made: true });
  expect(git(dir, ["show", "HEAD:b.txt"])).toBe("BC");
  bypassing(dir, ["commit", "-qam", "chore: settle"]);

  writeFiles(dir, { "a.txt": "HELLO\nTHERE\n", "c.txt": "cc\n" });
  git(dir, ["add", "a.txt"]);
  expect(commitStaged(dir)).toEqual({
    status: 0,
    stderr:
      "format: `sh fmt.sh` also changed these files the commit leaves out; they stay in the worktree:\n  c.txt\n",
    made: true,
  });
  expect([git(dir, ["show", "HEAD:c.txt"]), readText(dir, "c.txt")]).toEqual(["C", "CC\n"]);
  git(dir, ["checkout", "--", "c.txt"]);

  writeFiles(dir, { [QUOTED]: "q\n" });
  git(dir, ["add", QUOTED]);
  writeFiles(dir, { [QUOTED]: "q\nr\n" });
  expect(commitStaged(dir)).toEqual({
    status: 1,
    stderr: `format: \`sh fmt.sh\` changes these partly staged files, so the commit would not be formatted; stage each whole or not at all, then commit again:\n  ${QUOTED}\n`,
    made: false,
  });
  expect(git(dir, ["show", `:${QUOTED}`])).toBe("q");
  writeFiles(dir, { [QUOTED]: "q\n" });
  expect(commitStaged(dir)).toEqual({ status: 0, stderr: "", made: true });
  expect(git(dir, ["show", `HEAD:${QUOTED}`])).toBe("Q");

  writeFiles(dir, { "fmt.sh": "echo broken >&2\nexit 3\n", "d.txt": "D\n" });
  git(dir, ["add", "d.txt"]);
  expect(commitStaged(dir)).toEqual({
    status: 1,
    stderr: "format: `sh fmt.sh` failed:\nbroken\n",
    made: false,
  });
  git(dir, ["reset", "-q"]);
  git(dir, ["checkout", "--", "fmt.sh"]);
  git(dir, ["clean", "-qf"]);

  git(dir, ["checkout", "-qb", "side"]);
  writeFiles(dir, { "a.txt": "SIDE\n" });
  bypassing(dir, ["commit", "-qam", "chore: side"]);
  git(dir, ["checkout", "-q", "main"]);
  writeFiles(dir, { "a.txt": "MAIN\n" });
  bypassing(dir, ["commit", "-qam", "chore: main"]);
  expect(gitRan(dir, ["merge", "-q", "side"]).status).toBe(1);
  writeFiles(dir, { "a.txt": "merged\n" });
  git(dir, ["add", "a.txt"]);
  expect(committing(dir, ["-q", "--no-edit"])).toEqual({ status: 0, stderr: "", made: true });
  expect(git(dir, ["show", "HEAD:a.txt"])).toBe("merged");
});

test("AC-33 runs the command from the checkout root in --run, staging nothing", () => {
  const dir = formatted({ "a.txt": "A\n", "sub/keep.txt": "keep\n" });
  writeFiles(dir, { "b.txt": "b\n" });
  git(dir, ["add", "b.txt"]);
  writeFiles(dir, { "b.txt": "bc\n" });
  expect(shell(join(dir, "sub"), `sh ../${HOOK} --run`)).toEqual({ status: 0, stdout: "", stderr: "" });
  expect([readText(dir, "b.txt"), readText(dir, "sub/keep.txt")]).toEqual(["BC\n", "keep\n"]);
  expect([git(dir, ["status", "--porcelain"]), git(dir, ["show", ":b.txt"])]).toEqual(["AM b.txt", "b"]);

  writeFiles(dir, { "fmt.sh": "echo broken >&2\nexit 3\n" });
  expect(shell(dir, `sh ${HOOK} --run`)).toEqual({ status: 3, stdout: "", stderr: "broken\n" });
});

test("AC-34 checks the command's program is on PATH, and fails a hook with no command", () => {
  const dir = checkout();
  install(dir, ["format", "--command", "no-such-formatter --write"]);
  expect(doctor(dir).status).toBe(1);
  expect(check(dir, "format command")).toEqual({
    name: "format command",
    state: "fail",
    detail:
      "`no-such-formatter --write`, but no-such-formatter is not on PATH, so the format hook refuses every commit",
    fix: `install no-such-formatter, or ${NAME_THE_COMMAND}`,
  });
  install(dir, ["format", "--command", "sh fmt.sh"]);
  expect(check(dir, "format command")?.state).toBe("ok");
  expect(doctor(dir).checks.filter(({ state }) => state !== "ok")).toEqual([]);
  writeFiles(dir, { [HOOK]: readText(dir, HOOK).replace("command='sh fmt.sh'", "command=''") });
  expect(check(dir, HOOK)).toEqual({
    name: HOOK,
    state: "fail",
    detail: `${dir}'s format gate runs the project's own format command, and none was given with --command`,
    fix: NAME_THE_COMMAND,
  });
  expect(check(dir, "format command")).toBeUndefined();
  expect(check(dir, "commit prefixes")).toBeUndefined();

  const subjects = checkout();
  install(subjects, ["commit-subject"]);
  expect(check(subjects, "commit prefixes")).toEqual({
    name: "commit prefixes",
    state: "ok",
    detail: "none installed, so the gate allows its default set",
    fix: null,
  });
  install(subjects, ["commit-subject", "--prefixes", "nosuchtool,feat"]);
  expect(check(subjects, "commit prefixes")).toEqual({
    name: "commit prefixes",
    state: "ok",
    detail: "`nosuchtool,feat`",
    fix: null,
  });
});
