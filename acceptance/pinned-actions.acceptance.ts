import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import {
  COMMIT_SUBJECT_FILES,
  check,
  checkout,
  commitAs,
  commitFiles,
  each,
  gated,
  git,
  githubStep,
  gitRan,
  install,
  installs,
  lines,
  modeOf,
  PASSED,
  pathOf,
  readText,
  refusedWith,
  removeScratchDirs,
  restart,
  scratchDir,
  shell,
  stepScript,
  writeFiles,
} from "./cli";

afterEach(removeScratchDirs);

const PINNED_ACTIONS_FILES = [
  ".githooks/.gitattributes",
  ".githooks/pre-commit",
  ".githooks/pre-push",
  ".githooks/pre-commit.d/pinned-actions",
  ".githooks/pre-push.d/pinned-actions",
  ".githooks/pinned-actions/scan.cjs",
  ".github/workflows/pinned-actions.yml",
  ".githooks/judge-push",
];

const FIX =
  "Pin each to the commit SHA of its release, with the version as a trailing comment (owner/repo@<40 hex> # vX.Y.Z), or a docker:// image by its @sha256: digest.";

const CHECKOUT_SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

const PINNED_CHECKOUT = `actions/checkout@${CHECKOUT_SHA} # v7.0.1`;

const DIGEST = "a".repeat(64);

const WORKFLOW = ".github/workflows/ci.yml";

function workflow(steps: readonly string[]): string {
  return lines([
    "name: CI",
    "on: push",
    "jobs:",
    "  ci:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    ...steps.map((step) => `      - ${step}`),
  ]);
}

function reply(findings: readonly (readonly [string, readonly (readonly [number, string])[]])[]): string {
  const count = findings.reduce((total, [, found]) => total + found.length, 0);
  return lines([
    `pinned-actions: this change holds ${count} unpinned ${count === 1 ? "action" : "actions"}. ${FIX}`,
    ...findings.flatMap(([path, found]) => [path, ...found.map(([line, ref]) => `  ${line}  ${ref}`)]),
  ]);
}

test("AC-60 installs pinned-actions, its files marked, the workflow running judge-push", () => {
  const dir = checkout();
  installs(dir, ["pinned-actions"], {
    gates: ["pinned-actions"],
    files: each("missing", PINNED_ACTIONS_FILES),
    prepare: "absent",
  });
  expect(PINNED_ACTIONS_FILES.map((path) => modeOf(dir, path))).toEqual([
    0o644, 0o755, 0o755, 0o755, 0o755, 0o644, 0o644, 0o644,
  ]);
  expect(readText(dir, ".githooks/pinned-actions/scan.cjs")).toMatch(/^\/\/ agent-gate:pinned-actions:\d+$/m);
  expect(readText(dir, ".github/workflows/pinned-actions.yml")).toContain(
    "sh .githooks/judge-push pinned-actions ",
  );

  install(dir, ["commit-subject"]);
  installs(dir, [], {
    gates: ["commit-subject", "pinned-actions"],
    files: each("installed", [
      ...COMMIT_SUBJECT_FILES,
      ".githooks/pre-commit",
      ".githooks/pre-commit.d/pinned-actions",
      ".githooks/pre-push.d/pinned-actions",
      ".githooks/pinned-actions/scan.cjs",
      ".github/workflows/pinned-actions.yml",
    ]),
    prepare: "absent",
  });
});

test("AC-61 refuses a workflow or action file holding a tag, branch or short SHA, naming each line", () => {
  const dir = gated(["pinned-actions"]);
  expect(
    commitFiles(dir, {
      [WORKFLOW]: workflow([
        "uses: actions/checkout@v4",
        "uses: actions/setup-node@main",
        "uses: actions/cache@3d3c42e",
        "# uses: actions/upload-artifact@v4",
        "run: |",
        "  echo 'uses: actions/download-artifact@v4'",
        "  uses: actions/attest@v4",
      ]),
      ".github/actions/build/action.yml": lines([
        "name: Build",
        "runs:",
        "  using: composite",
        "  steps:",
        "    - uses: oven-sh/setup-bun@v2",
      ]),
      ".github/workflows/shared/notes.yml": "uses: actions/checkout@v4\n",
      "docs/ci.md": "A step is `uses: actions/checkout@v4`.\n",
    }),
  ).toEqual(
    refusedWith(
      reply([
        [".github/actions/build/action.yml", [[5, "oven-sh/setup-bun@v2"]]],
        [
          WORKFLOW,
          [
            [7, "actions/checkout@v4"],
            [8, "actions/setup-node@main"],
            [9, "actions/cache@3d3c42e"],
          ],
        ],
      ]),
    ),
  );
});

test("AC-62 passes a reference pinned to 40 hex characters, however the line spells it", () => {
  const dir = gated(["pinned-actions"], { "README.md": "# A project\n" });
  expect(
    commitFiles(dir, {
      [WORKFLOW]: lines([
        "name: CI",
        "on: push",
        "jobs:",
        "  shared:",
        `    uses: octo/shared/.github/workflows/check.yml@${CHECKOUT_SHA} # v1.2.0`,
        "  ci:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        `      - uses: ${PINNED_CHECKOUT}`,
        `      - uses: "actions/checkout@${CHECKOUT_SHA}"`,
        `      - uses: 'actions/checkout@${CHECKOUT_SHA}' # v7.0.1`,
        `      - { name: Check out, uses: actions/checkout@${CHECKOUT_SHA}, with: { fetch-depth: 0 } }`,
        "      - uses: $/.github/actions/build",
        "      - run: |",
        "          uses: actions/checkout@v4",
        "      - run: echo done",
      ]),
    }),
  ).toEqual(PASSED);

  expect(commitFiles(dir, { "README.md": "# A project\n\nuses: actions/checkout@v4\n" })).toEqual(PASSED);
});

test("AC-63 passes a local action", () => {
  const dir = gated(["pinned-actions"]);
  expect(
    commitFiles(dir, {
      [WORKFLOW]: workflow(["uses: ./.github/actions/build", "uses: ./"]),
      ".github/actions/build/action.yml": lines([
        "name: Build",
        "runs:",
        "  using: node20",
        "  main: index.js",
      ]),
    }),
  ).toEqual(PASSED);
});

test("AC-64 passes a docker:// image only with its @sha256: digest", () => {
  const dir = gated(["pinned-actions"]);
  expect(
    commitFiles(dir, {
      [WORKFLOW]: workflow(["uses: docker://alpine:3.20", "uses: docker://ghcr.io/octo/tool@sha256:abc"]),
    }),
  ).toEqual(
    refusedWith(
      reply([
        [
          WORKFLOW,
          [
            [7, "docker://alpine:3.20"],
            [8, "docker://ghcr.io/octo/tool@sha256:abc"],
          ],
        ],
      ]),
    ),
  );

  restart(dir);
  expect(
    commitFiles(dir, {
      [WORKFLOW]: workflow([
        `uses: docker://alpine@sha256:${DIGEST}`,
        `uses: docker://ghcr.io/octo/tool:1.2@sha256:${DIGEST}`,
      ]),
    }),
  ).toEqual(PASSED);
});

test("AC-65 judges a push before it leaves and again in CI, annotating findings for GitHub", () => {
  const work = gated(["pinned-actions"], { "old.ts": "export const old = 0;\n" });
  const origin = join(scratchDir(), "remote.git");
  git(work, ["clone", "-q", "--bare", work, origin]);
  const clone = join(scratchDir(), "clone");
  git(work, ["clone", "-q", origin, clone]);
  git(clone, ["config", "core.hooksPath", ".githooks"]);
  const before = git(clone, ["rev-parse", "HEAD"]);
  writeFiles(clone, { [WORKFLOW]: workflow(["uses: actions/checkout@v4"]) });
  git(clone, ["add", "-A"]);
  const unpinned = commitAs(clone, "ci: add a workflow");
  const refused = reply([[WORKFLOW, [[7, "actions/checkout@v4"]]]]);

  const pushed = gitRan(clone, ["push", "-q", "origin", "HEAD:main"]);
  expect([pushed.status, pushed.stderr.startsWith(refused)]).toEqual([1, true]);
  expect(git(origin, ["rev-parse", "HEAD"])).toBe(before);

  const judged = githubStep(
    clone,
    stepScript(readText(clone, ".github/workflows/pinned-actions.yml"), "Judge each file the push changes"),
    {
      BASE_SHA: before,
      HEAD_SHA: unpinned,
      PUSHED_REF: "refs/heads/main",
      DEFAULT_BRANCH: "main",
      RUNNER_TEMP: scratchDir(),
    },
  );
  expect(judged).toEqual({
    status: 1,
    stdout: `::error file=${WORKFLOW},line=7::actions/checkout@v4\n`,
    stderr: refused,
  });

  git(clone, ["reset", "-q", "--hard", before]);
  writeFiles(clone, { [WORKFLOW]: workflow([`uses: ${PINNED_CHECKOUT}`]) });
  git(clone, ["add", "-A"]);
  commitAs(clone, "ci: add a workflow");
  const clean = gitRan(clone, ["push", "-q", "origin", "HEAD:main"]);
  expect([clean.status, clean.stderr]).toEqual([0, ""]);
});

test("AC-66 sweeps the tracked files, and exits 2 or 3 when it cannot judge", () => {
  const dir = gated(["pinned-actions"], { [WORKFLOW]: workflow(["uses: actions/checkout@v4"]) });
  expect(shell(dir, "node .githooks/pinned-actions/scan.cjs --all")).toEqual({
    status: 1,
    stdout: "",
    stderr: lines([
      `pinned-actions: the tracked files hold 1 unpinned action. ${FIX}`,
      WORKFLOW,
      "  7  actions/checkout@v4",
    ]),
  });

  expect(shell(dir, `node .githooks/pinned-actions/scan.cjs --file ${WORKFLOW}`)).toEqual({
    status: 2,
    stdout: "",
    stderr: `pinned-actions: scan.cjs takes no arguments, --all, or a base and a head, each optionally after --format github, and got 2: --file ${WORKFLOW}; node scan.cjs [--format github] [--all | <base> <head>]\n`,
  });

  const withoutNode = pathOf(["git", "sh"]);
  expect(shell(dir, ".githooks/pre-commit.d/pinned-actions", { PATH: withoutNode })).toEqual({
    status: 3,
    stdout: "",
    stderr:
      "pinned-actions: node is not on PATH, so the commit's actions cannot be judged; install Node.js 20 or later\n",
  });
  const withoutNodeForPush = pathOf(["git", "sh", "dirname", "mktemp", "rm"]);
  expect(shell(dir, "sh .githooks/judge-push pinned-actions a b c d", { PATH: withoutNodeForPush })).toEqual({
    status: 3,
    stdout: "",
    stderr:
      "pinned-actions: node is not on PATH, so the push's actions cannot be judged; install Node.js 20 or later\n",
  });
});

test("AC-67 counts the unpinned actions the tracked workflow and action files hold", () => {
  const dir = checkout({ [WORKFLOW]: workflow(["uses: actions/checkout@v4"]) });
  install(dir, ["pinned-actions"]);
  git(dir, ["add", "-A"]);
  expect(check(dir, "pinned-actions backlog")).toEqual({
    name: "pinned-actions backlog",
    state: "warn",
    detail: "the tracked files hold 1 unpinned action",
    fix: "node .githooks/pinned-actions/scan.cjs --all lists each one",
  });

  writeFiles(dir, { [WORKFLOW]: workflow([`uses: ${PINNED_CHECKOUT}`]) });
  git(dir, ["add", "-A"]);
  expect(check(dir, "pinned-actions backlog")).toEqual({
    name: "pinned-actions backlog",
    state: "ok",
    detail: "the tracked files hold no unpinned action",
    fix: null,
  });

  writeFiles(dir, { ".githooks/pinned-actions/scan.cjs": "// agent-gate:pinned-actions:1\n" });
  expect(check(dir, "pinned-actions backlog")).toEqual({
    name: "pinned-actions backlog",
    state: "warn",
    detail:
      "not counted while this differs from this agent-gates, since the count runs it: .githooks/pinned-actions/scan.cjs",
    fix: "agent-gates install",
  });
});
