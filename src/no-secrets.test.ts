import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALLOW_FILE, fingerprintOf, parsedAllow } from "./no-secrets-allow";
import { compiled, secretsIn } from "./no-secrets-match";
import { allowPattern, rulePattern } from "./no-secrets-pattern";
import { GITLEAKS, shippedRules } from "./no-secrets-rules";
import { refusalOf } from "./repo.test-support";

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
  [...text.matchAll(pattern)];
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
