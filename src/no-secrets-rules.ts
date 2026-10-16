import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { invariant } from "./assert";
import { allowPattern, type Pattern, rulePattern } from "./no-secrets-pattern";

export const GITLEAKS = {
  tag: "v8.30.1",
  sha256: "e163e53b9e7e8a8511e77271e2b323ed057759542a6d988258afe3a1fa329caf",
} as const;

const VENDOR_DIR = resolve(import.meta.dir, "..", "vendor", "gitleaks");

const RULES_FILE = join(VENDOR_DIR, "gitleaks.toml");

const LICENSE_FILE = join(VENDOR_DIR, "LICENSE");

export type Condition = "OR" | "AND";

export type AllowTarget = "secret" | "match" | "line";

export type Allowlist = {
  readonly condition: Condition;
  readonly target: AllowTarget;
  readonly regexes: readonly Pattern[];
  readonly paths: readonly Pattern[];
  readonly stopwords: readonly string[];
};

export type Rule = {
  readonly id: string;
  readonly pattern: Pattern;
  readonly path: Pattern | null;
  readonly keywords: readonly string[];
  readonly entropy: number | null;
  readonly secretGroup: number | null;
  readonly allowlists: readonly Allowlist[];
};

export type RuleTable = {
  readonly tag: string;
  readonly rules: readonly Rule[];
  readonly dropped: readonly string[];
  readonly global: Allowlist;
};

const SUPER_LINEAR_IN_NODE: readonly string[] = ["curl-auth-header", "curl-auth-user"];

const ASSIGNMENT_RULE_ID = "token-or-secret-assignment";

const ASSIGNMENT_PLACEHOLDERS = [
  "changeme",
  "change-me",
  "change_me",
  "placeholder",
  "example",
  "dummy",
  "redacted",
  "todo",
];

const ASSIGNMENT_RULE: Rule = {
  id: ASSIGNMENT_RULE_ID,
  pattern: {
    source:
      "\\b[A-Z][A-Z0-9_]*_(?:TOKEN|SECRET)[ \\t]*=[ \\t]*(?:\"([^\"\\n]+)\"|'([^'\\n]+)'|([^\\s\"'][^\\n]*?)[ \\t]*[;,]?[ \\t]*(?=\\r?\\n|$|#|//))",
    flags: "",
  },
  path: null,
  keywords: ["_token", "_secret"],
  entropy: null,
  secretGroup: null,
  allowlists: [
    {
      condition: "OR",
      target: "secret",
      regexes: [
        { source: "^\\$", flags: "" },
        { source: "^<[^>]*>$", flags: "" },
        { source: "^\\.{3,}$", flags: "" },
        { source: "^x+$", flags: "i" },
        { source: `^(?:${ASSIGNMENT_PLACEHOLDERS.join("|")})$`, flags: "i" },
      ],
      paths: [],
      stopwords: [],
    },
  ],
};

type Table = Readonly<Record<string, unknown>>;

function isTable(value: unknown): value is Table {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tableAt(value: unknown, where: string): Table {
  invariant(isTable(value), `${where} is a TOML table`);
  return value;
}

function stringAt(table: Table, key: string, where: string): string | null {
  const value = table[key];
  if (value === undefined) return null;
  invariant(typeof value === "string", `${where}.${key} is a string`);
  return value;
}

function numberAt(table: Table, key: string, where: string): number | null {
  const value = table[key];
  if (value === undefined) return null;
  invariant(typeof value === "number", `${where}.${key} is a number`);
  return value;
}

function stringsAt(table: Table, key: string, where: string): readonly string[] {
  const value = table[key];
  if (value === undefined) return [];
  invariant(
    Array.isArray(value) && value.every((item) => typeof item === "string"),
    `${where}.${key} is an array of strings`,
  );
  return value;
}

function tablesAt(table: Table, key: string, where: string): readonly Table[] {
  const value = table[key];
  if (value === undefined) return [];
  invariant(Array.isArray(value), `${where}.${key} is an array of tables`);
  return value.map((item, index) => tableAt(item, `${where}.${key}[${index}]`));
}

function conditionOf(value: string | null, where: string): Condition {
  if (value === null || value === "OR") return "OR";
  invariant(value === "AND", `${where}.condition is OR or AND`);
  return "AND";
}

function targetOf(value: string | null, where: string): AllowTarget {
  if (value === null || value === "secret") return "secret";
  invariant(value === "match" || value === "line", `${where}.regexTarget is secret, match or line`);
  return value;
}

function translatedAll(sources: readonly string[], where: string): readonly Pattern[] {
  return sources.map((source) => {
    const pattern = allowPattern(source);
    invariant(pattern !== null, `${where} translates to a Node pattern: ${source}`);
    return pattern;
  });
}

function allowlistOf(table: Table, where: string): Allowlist {
  return {
    condition: conditionOf(stringAt(table, "condition", where), where),
    target: targetOf(stringAt(table, "regexTarget", where), where),
    regexes: translatedAll(stringsAt(table, "regexes", where), `${where}.regexes`),
    paths: translatedAll(stringsAt(table, "paths", where), `${where}.paths`),
    stopwords: stringsAt(table, "stopwords", where).map((word) => word.toLowerCase()),
  };
}

type Translated =
  | { readonly kind: "rule"; readonly rule: Rule }
  | { readonly kind: "dropped"; readonly id: string };

function translatedRule(table: Table, index: number): Translated {
  const where = `rules[${index}]`;
  const id = stringAt(table, "id", where);
  invariant(id !== null, `${where} has an id`);
  const regex = stringAt(table, "regex", where);
  const pattern = regex === null || SUPER_LINEAR_IN_NODE.includes(id) ? null : rulePattern(regex);
  if (pattern === null) return { kind: "dropped", id };
  const path = stringAt(table, "path", where);
  const pathPattern = path === null ? null : rulePattern(path);
  invariant(path === null || pathPattern !== null, `${where}.path translates to a Node pattern`);
  return {
    kind: "rule",
    rule: {
      id,
      pattern,
      path: pathPattern,
      keywords: stringsAt(table, "keywords", where).map((keyword) => keyword.toLowerCase()),
      entropy: numberAt(table, "entropy", where),
      secretGroup: numberAt(table, "secretGroup", where),
      allowlists: tablesAt(table, "allowlists", where).map((allowlist, at) =>
        allowlistOf(allowlist, `${where}.allowlists[${at}]`),
      ),
    },
  };
}

export function shippedRules(): RuleTable {
  const parsed: unknown = Bun.TOML.parse(readFileSync(RULES_FILE, "utf8"));
  const config = tableAt(parsed, "gitleaks.toml");
  const translated = tablesAt(config, "rules", "gitleaks.toml").map(translatedRule);
  return {
    tag: GITLEAKS.tag,
    rules: [...translated.flatMap((each) => (each.kind === "rule" ? [each.rule] : [])), ASSIGNMENT_RULE],
    dropped: translated.flatMap((each) => (each.kind === "dropped" ? [each.id] : [])),
    global: allowlistOf(tableAt(config.allowlist, "allowlist"), "allowlist"),
  };
}

export function gitleaksLicense(): string {
  return readFileSync(LICENSE_FILE, "utf8");
}
