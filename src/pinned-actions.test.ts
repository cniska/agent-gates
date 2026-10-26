import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { gatesDoctor } from "./doctor";
import { installGates } from "./gates";
import { NO_FILLS } from "./gates-contract";
import { unpinnedIn } from "./pinned-actions-judge";
import { type Use, usesIn } from "./pinned-actions-read";
import { annotations, countsOf, reply } from "./pinned-actions-report";
import { commitPastHooks, repo, writeFiles } from "./repo.test-support";

const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

const DIGEST = "f".repeat(64);

const HEADER =
  "pinned-actions: this change holds 2 unpinned actions. Pin each to the commit SHA of its release, with the version as a trailing comment (owner/repo@<40 hex> # vX.Y.Z), or a docker:// image by its @sha256: digest.";

function workflow(steps: readonly string[]): string {
  return `${["jobs:", "  ci:", "    steps:", ...steps.map((step) => `      - ${step}`)].join("\n")}\n`;
}

describe("reading uses", () => {
  test("reads a bare, double-quoted and single-quoted value, ignoring what follows it", () => {
    expect(
      usesIn(
        workflow([
          `uses: actions/checkout@${SHA} # v7.0.1`,
          `uses: "actions/checkout@${SHA}"`,
          `uses: 'actions/checkout@${SHA}' # v7.0.1`,
          "uses:   actions/cache@v4   ",
        ]),
      ),
    ).toEqual([
      { line: 4, ref: `actions/checkout@${SHA}` },
      { line: 5, ref: `actions/checkout@${SHA}` },
      { line: 6, ref: `actions/checkout@${SHA}` },
      { line: 7, ref: "actions/cache@v4" },
    ]);
  });

  test("reads each uses of a flow mapping and a reusable workflow's", () => {
    expect(
      usesIn(
        [
          "jobs:",
          "  shared:",
          "    uses: octo/shared/.github/workflows/check.yml@main",
          "  ci:",
          "    steps:",
          "      - { name: Check out, uses: actions/checkout@v4, with: { fetch-depth: 0 } }",
          "      - {uses: actions/cache@v4,uses: actions/setup-node@v4}",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      { line: 3, ref: "octo/shared/.github/workflows/check.yml@main" },
      { line: 6, ref: "actions/checkout@v4" },
      { line: 7, ref: "actions/cache@v4" },
      { line: 7, ref: "actions/setup-node@v4" },
    ]);
  });

  test("skips a comment line, a block scalar's lines and a uses that is not a key", () => {
    expect(
      usesIn(
        workflow([
          "# uses: actions/checkout@v4",
          "run: |",
          "  uses: actions/checkout@v4",
          "",
          "  echo uses: actions/cache@v4",
          "uses: actions/setup-node@v4",
          "run: >-",
          "  uses: actions/attest@v4",
          "with:",
          "  reuses: actions/attest@v4",
          "  text: uses: actions/attest@v4",
          "  script: |",
          "    uses: actions/attest@v4",
          "uses: actions/upload-artifact@v4",
        ]),
      ),
    ).toEqual([
      { line: 9, ref: "actions/setup-node@v4" },
      { line: 17, ref: "actions/upload-artifact@v4" },
    ]);
  });
});

const PINNED = [
  `actions/checkout@${SHA}`,
  `octo/shared/.github/workflows/check.yml@${SHA}`,
  "./.github/actions/build",
  "./",
  "$/.github/actions/build",
  `docker://alpine@sha256:${DIGEST}`,
  `docker://ghcr.io/octo/tool:1.2@sha256:${DIGEST}`,
];

const UNPINNED = [
  "actions/checkout@v4",
  "actions/checkout@main",
  "actions/checkout@3d3c42e",
  `actions/checkout@${SHA.toUpperCase()}`,
  `actions/checkout@${SHA}a`,
  "actions/checkout",
  "docker://alpine:3.20",
  "docker://alpine@sha256:abc",
  `docker://alpine@sha256:${DIGEST}:latest`,
];

const ACTION_FILE = "runs:\n  steps:\n    - uses: oven-sh/setup-bun@v2\n";

const JUDGED_PATHS = [
  ".github/workflows/ci.yaml",
  "action.yml",
  "action.yaml",
  ".github/actions/build/action.yml",
  "tools/release/action.yaml",
];

const UNJUDGED_PATHS = [
  ".github/workflows/shared/ci.yml",
  ".github/workflows/ci.yml.bak",
  ".github/ci.yml",
  "workflows/ci.yml",
  "action.json",
  "my-action.yml",
  "docs/action.md",
];

describe("judging", () => {
  test("lists each unpinned reference of each changed workflow or action file, by path and line", () => {
    const dir = repo({
      ".github/workflows/ci.yml": workflow([...PINNED, ...UNPINNED].map((ref) => `uses: ${ref}`)),
      ...Object.fromEntries(JUDGED_PATHS.map((path) => [path, ACTION_FILE])),
      ...Object.fromEntries(UNJUDGED_PATHS.map((path) => [path, "uses: actions/checkout@v4\n"])),
    });
    execFileSync("git", ["-C", dir, "add", "-A"]);
    const setupBun: readonly [Use] = [{ line: 3, ref: "oven-sh/setup-bun@v2" }];
    expect(unpinnedIn(dir, { kind: "staged" })).toEqual([
      { path: ".github/actions/build/action.yml", unpinned: setupBun },
      { path: ".github/workflows/ci.yaml", unpinned: setupBun },
      {
        path: ".github/workflows/ci.yml",
        unpinned: [
          { line: 11, ref: "actions/checkout@v4" },
          { line: 12, ref: "actions/checkout@main" },
          { line: 13, ref: "actions/checkout@3d3c42e" },
          { line: 14, ref: `actions/checkout@${SHA.toUpperCase()}` },
          { line: 15, ref: `actions/checkout@${SHA}a` },
          { line: 16, ref: "actions/checkout" },
          { line: 17, ref: "docker://alpine:3.20" },
          { line: 18, ref: "docker://alpine@sha256:abc" },
          { line: 19, ref: `docker://alpine@sha256:${DIGEST}:latest` },
        ],
      },
      { path: "action.yaml", unpinned: setupBun },
      { path: "action.yml", unpinned: setupBun },
      { path: "tools/release/action.yaml", unpinned: setupBun },
    ]);
    commitPastHooks(dir, "ci: start");
    writeFiles(dir, { "docs/action.md": "uses: actions/setup-node@v4\n" });
    execFileSync("git", ["-C", dir, "add", "-A"]);
    expect(unpinnedIn(dir, { kind: "staged" })).toEqual([]);
    expect(unpinnedIn(dir, { kind: "all" })).toHaveLength(6);
  });
});

describe("the reply", () => {
  const found = [
    { path: ".github/workflows/ci.yml", unpinned: [{ line: 4, ref: "actions/checkout@v4" }] },
    { path: "action.yml", unpinned: [{ line: 3, ref: "docker://alpine:3.20" }] },
  ] as const;

  test("counts the unpinned actions under the scope's subject", () => {
    expect(countsOf([], "change")).toBe("this change holds no unpinned action");
    expect(countsOf(found.slice(0, 1), "tracked")).toBe("the tracked files hold 1 unpinned action");
    expect(countsOf(found, "change")).toBe("this change holds 2 unpinned actions");
  });

  test("prints the header, then each file with its line and reference", () => {
    expect(reply(found, "change", null)).toBe(
      [
        HEADER,
        ".github/workflows/ci.yml",
        "  4  actions/checkout@v4",
        "action.yml",
        "  3  docker://alpine:3.20",
        "",
      ].join("\n"),
    );
    expect(reply([], "change", null)).toBe("");
    expect(reply(found, "change", Buffer.byteLength(HEADER) + 1).split("\n")).toEqual([
      HEADER,
      "… 2 more findings in 2 files",
      "",
    ]);
  });

  test("annotates each finding for GitHub", () => {
    expect(annotations(found)).toBe(
      "::error file=.github/workflows/ci.yml,line=4::actions/checkout@v4\n::error file=action.yml,line=3::docker://alpine:3.20\n",
    );
  });
});

describe("the doctor", () => {
  test("counts the unpinned actions the tracked files hold, once the gate is installed", () => {
    const dir = repo({ ".github/workflows/ci.yml": workflow(["uses: actions/checkout@v4"]) });
    execFileSync("git", ["-C", dir, "add", "-A"]);
    const check = () => gatesDoctor(dir).checks.find(({ name }) => name === "pinned-actions backlog");
    expect(check()).toBeUndefined();
    installGates(dir, ["pinned-actions"], NO_FILLS);
    expect(check()).toEqual({
      name: "pinned-actions backlog",
      state: "warn",
      detail: "the tracked files hold 1 unpinned action",
      fix: "node .githooks/pinned-actions/scan.cjs --all lists each one",
    });
    writeFiles(dir, { ".github/workflows/ci.yml": workflow([`uses: actions/checkout@${SHA}`]) });
    execFileSync("git", ["-C", dir, "add", "-A"]);
    expect(check()).toEqual({
      name: "pinned-actions backlog",
      state: "ok",
      detail: "the tracked files hold no unpinned action",
    });
  });
});
