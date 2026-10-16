import { afterEach, expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import {
  AWS_KEY,
  COMMIT_SUBJECT_FILES,
  checkout,
  commitAs,
  commitFiles,
  commitStaged,
  each,
  fingerprint,
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
  removeScratch,
  restart,
  scratchDir,
  shell,
  stepScript,
  writeFiles,
} from "./cli";

afterEach(removeScratch);

const NO_SECRETS_FILES = [
  ".githooks/.gitattributes",
  ".githooks/pre-commit",
  ".githooks/pre-push",
  ".githooks/pre-commit.d/no-secrets",
  ".githooks/pre-push.d/no-secrets",
  ".githooks/no-secrets/scan.cjs",
  ".github/workflows/no-secrets.yml",
  ".githooks/judge-push",
];

const FIX =
  "Remove each secret, rotate it if it was ever pushed, or allow a reviewed false positive in .no-secrets-allow.";

const PRIVATE_KEY = [
  ["-----BEGIN", "RSA PRIVATE", "KEY-----"].join(" "),
  "MIIEowIBAAKCAQEAx7fake".repeat(4),
  ["-----END", "RSA PRIVATE", "KEY-----"].join(" "),
].join("\n");

const TOKEN_VALUE = ["ab", "12", "cd", "34"].join("");

const TOKEN_LINE = ["FOO_TOKEN", "=", TOKEN_VALUE].join("");

type Finding = readonly [line: number, rule: string, secret: string];

function shown(path: string, [, rule, secret]: Finding): string {
  return `${rule}: ${secret.slice(0, 4)}…  allow: ${fingerprint(rule, path, secret)}`;
}

function finding(path: string, found: Finding): string {
  return `${found[0]}  ${shown(path, found)}`;
}

function secretReply(
  findings: readonly (readonly [string, readonly Finding[]])[],
  lead = "this change adds",
): string {
  const count = findings.reduce((total, [, found]) => total + found.length, 0);
  return lines([
    `no-secrets: ${lead} ${count} ${count === 1 ? "secret" : "secrets"}. ${FIX}`,
    ...findings.flatMap(([path, found]) => [path, ...found.map((each) => `  ${finding(path, each)}`)]),
  ]);
}

function expectNoValue(stderr: string): void {
  for (const value of [AWS_KEY, PRIVATE_KEY, TOKEN_VALUE]) expect(stderr).not.toContain(value);
}

test("AC-54 installs no-secrets, its files marked, with gitleaks' MIT notice in the scanner", () => {
  const dir = checkout();
  installs(dir, ["no-secrets"], {
    gates: ["no-secrets"],
    files: each("missing", NO_SECRETS_FILES),
    prepare: "absent",
  });
  expect(NO_SECRETS_FILES.map((path) => modeOf(dir, path))).toEqual([
    0o644, 0o755, 0o755, 0o755, 0o755, 0o644, 0o644, 0o644,
  ]);
  const scanner = readText(dir, ".githooks/no-secrets/scan.cjs");
  expect(scanner).toMatch(/^\/\/ agent-gate:no-secrets:\d+$/m);
  expect(scanner).toContain(
    "The rules this file matches come from gitleaks v8.30.1 (https://github.com/gitleaks/gitleaks), used under its MIT License:",
  );
  expect(scanner).toContain("MIT License\n\nCopyright (c) 2019 Zachary Rice\n\nPermission is hereby granted");
  expect(readText(dir, ".github/workflows/no-secrets.yml")).toContain("sh .githooks/judge-push no-secrets ");

  install(dir, ["commit-subject"]);
  installs(dir, [], {
    gates: ["commit-subject", "no-secrets"],
    files: each("installed", [
      ...COMMIT_SUBJECT_FILES,
      ".githooks/pre-commit",
      ".githooks/pre-commit.d/no-secrets",
      ".githooks/pre-push.d/no-secrets",
      ".githooks/no-secrets/scan.cjs",
      ".github/workflows/no-secrets.yml",
    ]),
    prepare: "absent",
  });
});

test("AC-55 refuses a commit adding a secret, naming its file, line and rule without the value", () => {
  const dir = gated(["no-secrets"], { ".gitattributes": "generated.ts linguist-generated\n" });
  const refused = commitFiles(dir, {
    "src/aws.ts": `const region = "eu-north-1";\nconst key = "${AWS_KEY}";\n`,
    "deploy/key.yml": `key: |\n${PRIVATE_KEY}\n`,
    ".env": `${TOKEN_LINE}\n`,
    "generated.ts": `export const key = "${AWS_KEY}";\n`,
    "binary.bin": `\u0000\u0001${AWS_KEY}\n`,
  });
  expect(refused).toEqual(
    refusedWith(
      secretReply([
        [".env", [[1, "token-or-secret-assignment", TOKEN_VALUE]]],
        ["deploy/key.yml", [[2, "private-key", PRIVATE_KEY]]],
        ["generated.ts", [[1, "aws-access-token", AWS_KEY]]],
        ["src/aws.ts", [[2, "aws-access-token", AWS_KEY]]],
      ]),
    ),
  );
  expectNoValue(refused.stderr);

  restart(dir);
  expect(
    commitFiles(dir, {
      "src/aws.ts": 'const region = "eu-north-1";\n',
      "deploy/key.yml": "key: from-the-vault\n",
      ".env": ["FOO_TOKEN=$FOO", "BAR_TOKEN=", "BAZ_SECRET=<your token>", `QUX_SECRET=${"$"}{QUX}`].join(
        "\n",
      ),
      "docs/setup.md":
        "A literal `FOO_TOKEN=<value>` is refused; `BAR_SECRET=<your token>` is a placeholder.\n",
      "binary.bin": `\u0000\u0001${AWS_KEY}\n`,
    }),
  ).toEqual(PASSED);

  appendFileSync(join(dir, ".githooks/no-secrets/scan.cjs"), `\n// x = "${AWS_KEY}"\n`);
  git(dir, ["add", "-A"]);
  expect(commitStaged(dir)).toEqual(PASSED);
});

test("AC-56 lets a reviewed false positive through by its fingerprint in the staged allow file", () => {
  const dir = gated(["no-secrets"]);
  const allowed = fingerprint("aws-access-token", "src/aws.ts", AWS_KEY);
  writeFiles(dir, { "src/aws.ts": `const key = "${AWS_KEY}";\n`, ".no-secrets-allow": `${allowed}\n` });
  git(dir, ["add", "src/aws.ts"]);
  expect(commitStaged(dir)).toEqual(
    refusedWith(secretReply([["src/aws.ts", [[1, "aws-access-token", AWS_KEY]]]])),
  );
  git(dir, ["add", ".no-secrets-allow"]);
  expect(commitStaged(dir)).toEqual(PASSED);

  expect(commitFiles(dir, { "src/copy.ts": `const key = "${AWS_KEY}";\n` })).toEqual(
    refusedWith(secretReply([["src/copy.ts", [[1, "aws-access-token", AWS_KEY]]]])),
  );

  restart(dir);
  expect(commitFiles(dir, { ".no-secrets-allow": `${allowed}\nnot a fingerprint\n` })).toEqual({
    status: 1,
    made: false,
    stderr:
      "no-secrets: .no-secrets-allow line 2 is not a fingerprint: not a fingerprint; keep only fingerprints the no-secrets reply printed in .no-secrets-allow, one per line, blank lines aside\n",
  });
});

test("AC-57 judges a push before it leaves and again in CI, annotating findings for GitHub", () => {
  const work = gated(["no-secrets"], { "old.ts": "export const old = 0;\n" });
  const origin = join(scratchDir(), "remote.git");
  git(work, ["clone", "-q", "--bare", work, origin]);
  const clone = join(scratchDir(), "clone");
  git(work, ["clone", "-q", origin, clone]);
  git(clone, ["config", "core.hooksPath", ".githooks"]);
  const before = git(clone, ["rev-parse", "HEAD"]);
  writeFiles(clone, { "src/aws.ts": `const key = "${AWS_KEY}";\n` });
  git(clone, ["add", "-A"]);
  const leaking = commitAs(clone, "feat: add a key");
  const reply = secretReply([["src/aws.ts", [[1, "aws-access-token", AWS_KEY]]]]);

  const pushed = gitRan(clone, ["push", "-q", "origin", "HEAD:main"]);
  expect([pushed.status, pushed.stderr.startsWith(reply)]).toEqual([1, true]);
  expect(git(origin, ["rev-parse", "HEAD"])).toBe(before);

  const workflow = readText(clone, ".github/workflows/no-secrets.yml");
  const judged = githubStep(clone, stepScript(workflow, "Judge each file the push changes"), {
    BASE_SHA: before,
    HEAD_SHA: leaking,
    PUSHED_REF: "refs/heads/main",
    DEFAULT_BRANCH: "main",
    RUNNER_TEMP: scratchDir(),
  });
  expect(judged).toEqual({
    status: 1,
    stdout: `::error file=src/aws.ts,line=1::${shown("src/aws.ts", [1, "aws-access-token", AWS_KEY])}\n`,
    stderr: reply,
  });

  git(clone, ["reset", "-q", "--hard", before]);
  writeFiles(clone, { "src/clean.ts": "export const clean = 1;\n" });
  git(clone, ["add", "-A"]);
  commitAs(clone, "feat: add a clean file");
  const clean = gitRan(clone, ["push", "-q", "origin", "HEAD:main"]);
  expect([clean.status, clean.stderr]).toEqual([0, ""]);

  expect(shell(clone, "sh .githooks/judge-push nope a b c d")).toEqual({
    status: 2,
    stdout: "",
    stderr:
      "judge-push: nope is no gate that judges a push; name commit-subject, no-comments or no-secrets\n",
  });
});

test("AC-58 sweeps the tracked files, and exits 2 or 3 when it cannot judge", () => {
  const dir = gated(["no-secrets"], { "src/aws.ts": `const key = "${AWS_KEY}";\n` });
  const sweep = shell(dir, "node .githooks/no-secrets/scan.cjs --all");
  expect(sweep).toEqual({
    status: 1,
    stdout: "",
    stderr: secretReply([["src/aws.ts", [[1, "aws-access-token", AWS_KEY]]]], "the tracked files hold"),
  });
  expectNoValue(sweep.stderr);

  expect(shell(dir, "node .githooks/no-secrets/scan.cjs --file src/aws.ts")).toEqual({
    status: 2,
    stdout: "",
    stderr:
      "no-secrets: scan.cjs takes no arguments, --all, or a base and a head, each optionally after --format github, and got 2: --file src/aws.ts; node scan.cjs [--format github] [--all | <base> <head>]\n",
  });

  const withoutNode = pathOf(["git", "sh"]);
  expect(shell(dir, ".githooks/pre-commit.d/no-secrets", { PATH: withoutNode })).toEqual({
    status: 3,
    stdout: "",
    stderr: "no-secrets: node is not on PATH, so the commit's secrets cannot be judged; install Node.js\n",
  });
  const withoutNodeForPush = pathOf(["git", "sh", "dirname", "mktemp", "rm"]);
  expect(shell(dir, "sh .githooks/judge-push no-secrets a b c d", { PATH: withoutNodeForPush })).toEqual({
    status: 3,
    stdout: "",
    stderr: "no-secrets: node is not on PATH, so the push's secrets cannot be judged; install Node.js\n",
  });
});
