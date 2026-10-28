import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gatesDoctor } from "./doctor";
import { bundled } from "./gate-bundles";
import { installGates } from "./gates";
import { NO_FILLS, NO_SECRETS_SCANNER } from "./gates-contract";
import { ALLOW_FILE, fingerprintOf, parsedAllow } from "./no-secrets-allow";
import { judgedChange, rootRelative } from "./no-secrets-change";
import { type Found, secretsAdded } from "./no-secrets-judge";
import { compiled, secretsIn } from "./no-secrets-match";
import { allowPattern, rulePattern } from "./no-secrets-pattern";
import { annotations, reply } from "./no-secrets-report";
import { GITLEAKS, gitleaksLicense, shippedRules } from "./no-secrets-rules";
import { commitPastHooks, NO_COMMIT, refusalOf, repo, writeFiles } from "./repo.test-support";
import { judgedTextOf } from "./scanner-change";

describe("the pattern translation", () => {
  test("moves a leading (?i) into the i flag", () => {
    expect(rulePattern("(?i)abc")).toEqual({ source: "abc", flags: "i" });
    expect(rulePattern("abc")).toEqual({ source: "abc", flags: "" });
  });

  test("widens a mid-pattern (?i) and an (?i:) or (?-i:) group to the whole pattern", () => {
    expect(rulePattern("AKIA(?i)[a-z]+")).toEqual({ source: "AKIA[a-z]+", flags: "i" });
    expect(rulePattern("x(?i:abc)y")).toEqual({ source: "x(?:abc)y", flags: "i" });
    expect(rulePattern("(?i)x(?-i:A)y")).toEqual({ source: "x(?:A)y", flags: "i" });
  });

  test("rewrites the RE2 constructs Node lacks", () => {
    expect(rulePattern("a(?s:.)b")).toEqual({ source: "a[\\s\\S]b", flags: "" });
    expect(rulePattern("(?P<key>x)")).toEqual({ source: "(?<key>x)", flags: "" });
    expect(rulePattern("[[:alnum:]_-]{3}")).toEqual({ source: "[a-zA-Z0-9_-]{3}", flags: "" });
    expect(rulePattern("x\\z")).toEqual({ source: "x$", flags: "" });
    expect(rulePattern("a.b[.]")).toEqual({ source: "a[^\\n]b[.]", flags: "" });
    expect(rulePattern("\\.")).toEqual({ source: "\\.", flags: "" });
  });

  test("returns null for a pattern Node cannot compile", () => {
    expect(rulePattern("\\Qa.b\\E")).toBeNull();
    expect(rulePattern("(?P=name)")).toBeNull();
    expect(rulePattern("a[")).toBeNull();
    expect(rulePattern("\\pL")).toBeNull();
    expect(rulePattern("\\x{41}")).toBeNull();
  });

  test("drops an allowlist alternative that holds (?-i:) instead of widening it", () => {
    expect(allowPattern("(?i)(?:key|(?-i:[DdMm]onkey|[DM]ONKEY)|(?-i:A=\\n)|token)")).toEqual({
      source: "(?:key|token)",
      flags: "i",
    });
    expect(allowPattern("^(?i:a+|b+)$")).toEqual({ source: "^(?:a+|b+)$", flags: "i" });
  });
});

const ADVERSARIAL_LENGTH = 20_000;

const ADVERSARIAL_BOUND_MS = 400;

const SUPER_LINEAR_RATIO = 3;

const SUPER_LINEAR_LENGTHS = [ADVERSARIAL_LENGTH / 4, ADVERSARIAL_LENGTH / 2];

const ADVERSARIAL_TEST_TIMEOUT_MS = 60_000;

function adversarialLines(keyword: string, length: number): readonly string[] {
  const filler = (unit: string) => unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
  return ["a", "=", "-", "A1", `${keyword} `, `${keyword}="`, `${keyword}=${"a".repeat(30)} `, "\n"].map(
    (unit) => `${keyword}${filler(unit)}`,
  );
}

function scanTime(pattern: RegExp, text: string): number {
  const started = performance.now();
  Array.from(text.matchAll(pattern));
  return performance.now() - started;
}

function curlRuleSource(id: string): string {
  const toml = readFileSync(join(import.meta.dir, "..", "vendor", "gitleaks", "gitleaks.toml"), "utf8");
  const parsed: unknown = Bun.TOML.parse(toml);
  const rules = typeof parsed === "object" && parsed !== null && "rules" in parsed ? parsed.rules : null;
  const regex = Array.isArray(rules) ? rules.filter(isRule).find((each) => each.id === id)?.regex : undefined;
  const pattern = regex === undefined ? null : rulePattern(regex);
  expect(pattern).not.toBeNull();
  return pattern?.source ?? "";
}

function isRule(value: unknown): value is { readonly id: string; readonly regex: string } {
  if (typeof value !== "object" || value === null || !("id" in value) || !("regex" in value)) return false;
  return typeof value.id === "string" && typeof value.regex === "string";
}

describe("the shipped rules", () => {
  test("come from the vendored gitleaks file the pin names", () => {
    const toml = readFileSync(join(import.meta.dir, "..", "vendor", "gitleaks", "gitleaks.toml"));
    expect(createHash("sha256").update(toml).digest("hex")).toBe(GITLEAKS.sha256);
    expect(GITLEAKS.tag).toBe("v8.30.1");
    expect(shippedRules().tag).toBe("v8.30.1");
  });

  test("drop the path-only rule and the two that backtrack, and each one left compiles in Node", () => {
    const { rules, dropped, global } = shippedRules();
    expect(dropped).toEqual(["curl-auth-header", "curl-auth-user", "pkcs12-file"]);
    expect(rules.length).toBe(220);
    for (const rule of rules) {
      expect(() => new RegExp(rule.pattern.source, `g${rule.pattern.flags}`)).not.toThrow();
      for (const { regexes, paths } of [global, ...rule.allowlists])
        for (const { source, flags } of [...regexes, ...paths])
          expect(() => new RegExp(source, flags)).not.toThrow();
    }
  });

  test(
    "each finish a long adversarial line within the bound, and the dropped two do not",
    () => {
      const { rules } = shippedRules();
      for (const rule of rules) {
        const pattern = new RegExp(rule.pattern.source, `g${rule.pattern.flags}`);
        for (const line of adversarialLines(rule.keywords[0] ?? "", ADVERSARIAL_LENGTH))
          expect([rule.id, scanTime(pattern, line) < ADVERSARIAL_BOUND_MS]).toEqual([rule.id, true]);
      }
      for (const id of ["curl-auth-header", "curl-auth-user"]) {
        const pattern = new RegExp(curlRuleSource(id), "g");
        const [shorter, longer] = SUPER_LINEAR_LENGTHS.map((length) =>
          Math.max(...adversarialLines("curl", length).map((line) => scanTime(pattern, line))),
        );
        expect([id, (longer ?? 0) / (shorter ?? 1) > SUPER_LINEAR_RATIO]).toEqual([id, true]);
      }
    },
    ADVERSARIAL_TEST_TIMEOUT_MS,
  );

  test("carry the assignment shape as a rule of their own", () => {
    const rule = shippedRules().rules.find(({ id }) => id === "token-or-secret-assignment");
    expect(rule?.keywords).toEqual(["_token", "_secret"]);
    expect(rule?.entropy).toBeNull();
  });
});

const TABLE = compiled(shippedRules());

const AWS_KEY = ["AKIA", "Q7MZ", "P2XK", "V4LT", "W6RB"].join("");

const PRIVATE_KEY = [
  ["-----BEGIN", "RSA PRIVATE", "KEY-----"].join(" "),
  "MIIEowIBAAKCAQEAx7fake".repeat(4),
  ["-----END", "RSA PRIVATE", "KEY-----"].join(" "),
].join("\n");

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("the matcher", () => {
  test("finds a secret by rule, line and value, and shows only its first characters", () => {
    const text = `const region = "eu-north-1";\nconst key = "${AWS_KEY}";\n`;
    expect(secretsIn("src/aws.ts", text, TABLE)).toEqual([
      { rule: "aws-access-token", line: 2, shown: "AKIA", hash: sha256(AWS_KEY) },
    ]);
  });

  test("finds a private key block across lines, on the line it starts", () => {
    const text = `key: |\n${PRIVATE_KEY}\n`;
    const [found] = secretsIn("deploy/key.yml", text, TABLE);
    expect(found).toEqual({ rule: "private-key", line: 2, shown: "----", hash: sha256(PRIVATE_KEY) });
  });

  test("refuses a literal value assigned to a *_TOKEN or *_SECRET name, and passes a reference, an empty value and a placeholder", () => {
    const literal = ["FOO_TOKEN", "=", "ab", "12", "cd"].join("");
    expect(secretsIn(".env", `${literal}\n`, TABLE)).toEqual([
      { rule: "token-or-secret-assignment", line: 1, shown: "ab12", hash: sha256("ab12cd") },
    ]);
    expect(
      secretsIn("src/a.ts", `export const APP_SECRET = "${["xy", "9z", "8w"].join("")}";\n`, TABLE),
    ).toEqual([{ rule: "token-or-secret-assignment", line: 1, shown: "xy9z", hash: sha256("xy9z8w") }]);
    for (const trailing of [` # prod`, ` node app.js`]) {
      expect(secretsIn(".env", `${literal.replace("=", '="')}"${trailing}\n`, TABLE)).toEqual([
        { rule: "token-or-secret-assignment", line: 1, shown: "ab12", hash: sha256("ab12cd") },
      ]);
    }
    expect(secretsIn("src/a.ts", `const X_TOKEN = "${["ab", "12", "cd"].join("")}"; // x\n`, TABLE)).toEqual([
      { rule: "token-or-secret-assignment", line: 1, shown: "ab12", hash: sha256("ab12cd") },
    ]);
    for (const value of [
      "$FOO",
      ["$", "{FOO}"].join(""),
      ["$", "{{ secrets.FOO }}"].join(""),
      "",
      "<your token>",
      "...",
      "changeme",
      "xxxx",
    ])
      expect([
        value,
        secretsIn(".env", `FOO_TOKEN=${value}\nBAR_SECRET='${value}'\nconst X_TOKEN = "${value}";\n`, TABLE),
      ]).toEqual([value, []]);
    expect(secretsIn(".env", 'FOO_TOKEN=""\n', TABLE)).toEqual([]);
    expect(
      secretsIn(
        "docs/a.md",
        "a literal `FOO_TOKEN=<value>` is refused, and `BAR_SECRET=<one> or <two>` too\n",
        TABLE,
      ),
    ).toEqual([]);
  });

  test("passes a low-entropy value and a stopword, as the rule's entropy and the global allowlist say", () => {
    expect(secretsIn("src/a.ts", `const apiKey = "${"a".repeat(24)}";\n`, TABLE)).toEqual([]);
    expect(
      secretsIn("src/a.ts", `const apiKey = "${["ex", "ample", "Key", "Q7m2"].join("")}";\n`, TABLE),
    ).toEqual([]);
  });

  test("skips a file the global allowlist's paths name, and a line a rule's allowlist names", () => {
    const text = `const key = "${AWS_KEY}";\n`;
    expect(secretsIn("package-lock.json", text, TABLE)).toEqual([]);
    expect(secretsIn("node_modules/a/index.js", text, TABLE)).toEqual([]);
    const value = ["Qf", "P9vX", "2mT4", "kL8n"].join("");
    const mounted = `RUN --mount=type=secret,id=api_key,env=API_KEY=${value} build\n`;
    expect(secretsIn("Dockerfile", mounted, TABLE)).toEqual([]);
    expect(secretsIn("Dockerfile", `ENV API_KEY=${value}\n`, TABLE).map(({ rule }) => rule)).toEqual([
      "generic-api-key",
    ]);
  });

  test("drops the generic finding that a specific rule already made", () => {
    const text = `key = "${AWS_KEY}"\n`;
    expect(secretsIn("src/a.ts", text, TABLE).map(({ rule }) => rule)).toEqual(["aws-access-token"]);
  });

  test("runs a rule with a path only on a file that path names", () => {
    const text = `password = "${["q9", "w2", "e7", "r4", "t1"].join("")}"\n`;
    expect(secretsIn("main.tf", text, TABLE).map(({ rule }) => rule)).toEqual(["hashicorp-tf-password"]);
    expect(secretsIn("main.ts", text, TABLE)).toEqual([]);
  });

  test("takes the rule's secret group, else the first group that captured", () => {
    const sonar = ["squ_", "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"].join("");
    expect(secretsIn("a.properties", `sonar.login=${sonar}\n`, TABLE)).toEqual([
      { rule: "sonar-api-token", line: 1, shown: "squ_", hash: sha256(sonar) },
    ]);
  });
});

describe("the allow file", () => {
  test("names each allowed finding by rule, path and the start of the secret's hash", () => {
    expect(fingerprintOf("aws-access-token", "src/aws.ts", sha256(AWS_KEY))).toBe(
      `aws-access-token:src/aws.ts:${sha256(AWS_KEY).slice(0, 16)}`,
    );
    expect(ALLOW_FILE).toBe(".no-secrets-allow");
  });

  test("reads one fingerprint per line, skips blank lines, and is empty when there is no file", () => {
    const first = fingerprintOf("aws-access-token", "src/aws.ts", sha256(AWS_KEY));
    const second = fingerprintOf("private-key", "deploy/key.yml", sha256(PRIVATE_KEY));
    expect(parsedAllow(`${first}\n\n${second}\n`)).toEqual(new Set([first, second]));
    expect(parsedAllow(null)).toEqual(new Set());
  });

  test("refuses a line that is not a fingerprint, naming it", () => {
    expect(
      refusalOf(() => parsedAllow(`${fingerprintOf("a", "b", "c".repeat(64))}\nnot a fingerprint\n`)),
    ).toBe("malformed_allow_line");
  });
});

function stagedRepo(files: Record<string, string>): string {
  const dir = repo(files);
  execFileSync("git", ["-C", dir, "add", "-A"]);
  return dir;
}

describe("the judged change", () => {
  test("reads each staged text file's head and base, and skips a binary file", () => {
    const dir = repo({ "a.txt": "old\n", "b.bin": "\u0000\u0001" });
    commitPastHooks(dir, "chore: start");
    writeFiles(dir, { "a.txt": "new\n", "b.bin": "\u0000\u0002", "c.txt": "added\n" });
    execFileSync("git", ["-C", dir, "add", "-A"]);
    expect(judgedChange(dir, { kind: "staged" })).toEqual({
      heads: [
        { path: "a.txt", text: "new\n" },
        { path: "c.txt", text: "added\n" },
      ],
      bases: [{ path: "a.txt", text: "old\n" }],
    });
  });

  test("reads a pushed range against its merge base, and every tracked file under --all", () => {
    const dir = repo({ "a.txt": "one\n" });
    const base = commitPastHooks(dir, "chore: one");
    writeFiles(dir, { "a.txt": "two\n" });
    const head = commitPastHooks(dir, "chore: two");
    expect(judgedChange(dir, { kind: "pushed", base, head })).toEqual({
      heads: [{ path: "a.txt", text: "two\n" }],
      bases: [{ path: "a.txt", text: "one\n" }],
    });
    expect(judgedChange(dir, { kind: "all" })).toEqual({
      heads: [{ path: "a.txt", text: "two\n" }],
      bases: [],
    });
  });

  test("reads the allow file from the index for a commit and from the head for a push", () => {
    const dir = stagedRepo({ [ALLOW_FILE]: "staged\n" });
    expect(judgedTextOf(dir, { kind: "staged" }, ALLOW_FILE)).toBe("staged\n");
    const head = commitPastHooks(dir, "chore: allow");
    writeFiles(dir, { [ALLOW_FILE]: "unstaged\n" });
    expect(judgedTextOf(dir, { kind: "staged" }, ALLOW_FILE)).toBe("staged\n");
    expect(judgedTextOf(dir, { kind: "pushed", base: NO_COMMIT, head }, ALLOW_FILE)).toBe("staged\n");
    expect(judgedTextOf(repo(), { kind: "staged" }, ALLOW_FILE)).toBeNull();
  });

  test("names a path inside the root relative to it, and nothing for one outside", () => {
    const dir = repo({ "a/b.txt": "" });
    expect(rootRelative(dir, join(dir, "a", "b.txt"))).toEqual({ inRoot: join("a", "b.txt") });
    expect(rootRelative(dir, dir)).toEqual({ inRoot: "" });
    expect(rootRelative(dir, dirname(dir))).toBeNull();
  });
});

const awsFound = (path: string, line: number): Found => ({
  rule: "aws-access-token",
  line,
  shown: "AKIA",
  hash: sha256(AWS_KEY),
  fingerprint: fingerprintOf("aws-access-token", path, sha256(AWS_KEY)),
});

describe("the judgment", () => {
  test("reports a secret a head adds and not one a base of the change already held, in any file", () => {
    const dir = repo({ "src/old.ts": `key = "${PRIVATE_KEY}"\n` });
    commitPastHooks(dir, "chore: start");
    writeFiles(dir, {
      "src/aws.ts": `const key = "${AWS_KEY}";\n`,
      "src/old.ts": `const key = "${PRIVATE_KEY}";\n`,
      "src/copy.ts": `key: |\n${PRIVATE_KEY}\n`,
    });
    execFileSync("git", ["-C", dir, "add", "-A"]);
    expect(secretsAdded(dir, { kind: "staged" }, [])).toEqual([
      { path: "src/aws.ts", secrets: [awsFound("src/aws.ts", 1)] },
    ]);
  });

  test("skips a path the skipped list names or contains and a finding the allow file names, in code unit order", () => {
    const text = `const key = "${AWS_KEY}";\n`;
    const dir = stagedRepo({
      ".githooks/no-secrets/scan.cjs": text,
      "src/aws.ts": text,
      "src/b.ts": text,
      "src/Z.ts": text,
      [ALLOW_FILE]: `${fingerprintOf("aws-access-token", "src/b.ts", sha256(AWS_KEY))}\n`,
    });
    expect(secretsAdded(dir, { kind: "staged" }, [{ inRoot: ".githooks/no-secrets" }])).toEqual([
      { path: "src/Z.ts", secrets: [awsFound("src/Z.ts", 1)] },
      { path: "src/aws.ts", secrets: [awsFound("src/aws.ts", 1)] },
    ]);
  });

  test("judges a staged change against the index's allow file and skips its own gate files", () => {
    const dir = stagedRepo({
      ".githooks/no-secrets/scan.cjs": `x="${AWS_KEY}"\n`,
      "src/aws.ts": `const key = "${AWS_KEY}";\n`,
    });
    expect(secretsAdded(dir, { kind: "staged" }, [{ inRoot: ".githooks/no-secrets" }])).toEqual([
      { path: "src/aws.ts", secrets: [awsFound("src/aws.ts", 1)] },
    ]);
    writeFiles(dir, {
      [ALLOW_FILE]: `${fingerprintOf("aws-access-token", "src/aws.ts", sha256(AWS_KEY))}\n`,
    });
    const own = [{ inRoot: ".githooks/no-secrets" }];
    expect(secretsAdded(dir, { kind: "staged" }, own)).toHaveLength(1);
    execFileSync("git", ["-C", dir, "add", ALLOW_FILE]);
    expect(secretsAdded(dir, { kind: "staged" }, own)).toEqual([]);
  });
});

describe("the reply", () => {
  const found = [
    { path: "src/aws.ts", secrets: [awsFound("src/aws.ts", 2)] satisfies [Found, ...Found[]] },
    {
      path: "src/b.ts",
      secrets: [awsFound("src/b.ts", 1), awsFound("src/b.ts", 3)] satisfies [Found, ...Found[]],
    },
  ];

  test("names each secret by file, line and rule with its first characters and fingerprint", () => {
    const fingerprint = awsFound("src/aws.ts", 2).fingerprint;
    expect(reply(found, "change", null)).toBe(
      [
        "no-secrets: this change adds 3 secrets. Remove each secret, rotate it if it was ever pushed, or allow a reviewed false positive in .no-secrets-allow.",
        "src/aws.ts",
        `  2  aws-access-token: AKIA…  allow: ${fingerprint}`,
        "src/b.ts",
        `  1  aws-access-token: AKIA…  allow: ${awsFound("src/b.ts", 1).fingerprint}`,
        `  3  aws-access-token: AKIA…  allow: ${awsFound("src/b.ts", 3).fingerprint}`,
        "",
      ].join("\n"),
    );
    expect(reply(found, "tracked", null)).toStartWith("no-secrets: the tracked files hold 3 secrets.");
    expect(reply([], "change", null)).toBe("");
  });

  test("stops before the line that passes the byte cap and counts the rest", () => {
    const whole = reply(found, "change", null);
    const [header = "", ...listing] = whole.split("\n");
    const nearly = reply(found, "change", Buffer.byteLength(whole) - 1);
    expect(nearly.split("\n")).toEqual([header, ...listing.slice(0, 4), "… 1 more finding in 1 file", ""]);
    expect(Buffer.byteLength(nearly)).toBeLessThanOrEqual(Buffer.byteLength(whole) - 1);
    expect(reply(found, "change", Buffer.byteLength(header)).split("\n")).toEqual([
      header,
      "… 3 more findings in 2 files",
      "",
    ]);
  });

  test("prints a GitHub annotation per finding, escaped, capped at ten per step", () => {
    expect(annotations([{ path: "a,b.ts", secrets: [awsFound("a,b.ts", 2)] }])).toBe(
      `::error file=a%2Cb.ts,line=2::aws-access-token: AKIA…  allow: ${awsFound("a,b.ts", 2).fingerprint}\n`,
    );
    const first = awsFound("a.ts", 1);
    const rest = Array.from({ length: 10 }, (_, index) => awsFound("a.ts", index + 2));
    const lines = annotations([{ path: "a.ts", secrets: [first, ...rest] }])
      .trimEnd()
      .split("\n");
    expect(lines).toHaveLength(10);
    expect(lines.at(-1)).toBe("::error::no-secrets: 2 more findings; the step's log lists them all");
  });
});

describe("the bundle", () => {
  test("carries gitleaks' MIT notice after its marker, naming the pinned tag", async () => {
    const text = (await bundled())["no-secrets/scan.cjs"] ?? "";
    expect(text).toStartWith(
      [
        "// biome-ignore-all lint: generated by agent-gates, installed whole and never edited",
        "// biome-ignore-all format: generated by agent-gates, installed whole and never edited",
        "/* eslint-disable */",
        "// agent-gate:no-secrets:6",
        "/*",
        "The rules this file matches come from gitleaks v8.30.1 (https://github.com/gitleaks/gitleaks), used under its MIT License:",
        "",
        "MIT License",
        "",
        "Copyright (c) 2019 Zachary Rice",
        "",
      ].join("\n"),
    );
    expect(text).toContain(`${gitleaksLicense().trimEnd()}\n*/\n`);
    expect(gitleaksLicense()).toContain("Permission is hereby granted, free of charge");
  });
});

describe("the doctor", () => {
  test("counts the secrets the tracked files hold that the allow file does not name, once the gate is installed", () => {
    const dir = repo({ "src/aws.ts": `const key = "${AWS_KEY}";\n`, "src/b.ts": `key = "${PRIVATE_KEY}"\n` });
    execFileSync("git", ["-C", dir, "add", "-A"]);
    const check = () => gatesDoctor(dir).checks.find(({ name }) => name === "no-secrets backlog");
    expect(check()).toBeUndefined();
    installGates(dir, { kind: "gates", gates: ["no-secrets"] }, NO_FILLS);
    expect(check()).toEqual({
      name: "no-secrets backlog",
      state: "warn",
      detail: "the tracked files hold 2 secrets",
      fix: "node .githooks/no-secrets/scan.cjs --all lists each one",
    });
    writeFiles(dir, {
      [ALLOW_FILE]: `${fingerprintOf("aws-access-token", "src/aws.ts", sha256(AWS_KEY))}\n`,
    });
    execFileSync("git", ["-C", dir, "add", "-A"]);
    expect(check()?.detail).toBe("the tracked files hold 1 secret");
    execFileSync("git", ["-C", dir, "rm", "-q", "-f", "src/b.ts"]);
    expect(check()).toEqual({
      name: "no-secrets backlog",
      state: "ok",
      detail: "the tracked files hold no secret",
    });
    writeFileSync(join(dir, NO_SECRETS_SCANNER.target), "// agent-gate:no-secrets:1\n");
    expect(check()).toEqual({
      name: "no-secrets backlog",
      state: "warn",
      detail: `not counted while this differs from this agent-gates, since the count runs it: ${NO_SECRETS_SCANNER.target}`,
      fix: "agent-gates install",
    });
  });
});
