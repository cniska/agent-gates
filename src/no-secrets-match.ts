import { createHash } from "node:crypto";
import { unreachable } from "./assert";
import type { Pattern } from "./no-secrets-pattern";
import type { Allowlist, AllowTarget, Condition, Rule, RuleTable } from "./no-secrets-rules";

type CompiledAllowlist = {
  readonly condition: Condition;
  readonly target: AllowTarget;
  readonly regexes: readonly RegExp[];
  readonly paths: readonly RegExp[];
  readonly stopwords: readonly string[];
};

type CompiledRule = {
  readonly id: string;
  readonly pattern: RegExp;
  readonly path: RegExp | null;
  readonly keywords: readonly string[];
  readonly entropy: number | null;
  readonly secretGroup: number | null;
  readonly allowlists: readonly CompiledAllowlist[];
};

export type CompiledTable = { readonly rules: readonly CompiledRule[]; readonly global: CompiledAllowlist };

export type Secret = {
  readonly rule: string;
  readonly line: number;
  readonly shown: string;
  readonly hash: string;
};

type Sighting = {
  readonly path: string;
  readonly secret: string;
  readonly match: string;
  readonly line: string;
};

const SHOWN_CHARACTERS = 4;

const GLOBAL_SEARCH = "g";

const NEWLINE = "\n";

const GENERIC = "generic";

function regexOf({ source, flags }: Pattern, extra = ""): RegExp {
  return new RegExp(source, `${flags}${extra}`);
}

function compiledAllowlist(allowlist: Allowlist): CompiledAllowlist {
  return {
    ...allowlist,
    regexes: allowlist.regexes.map((pattern) => regexOf(pattern)),
    paths: allowlist.paths.map((pattern) => regexOf(pattern)),
  };
}

function compiledRule(rule: Rule): CompiledRule {
  return {
    ...rule,
    pattern: regexOf(rule.pattern, GLOBAL_SEARCH),
    path: rule.path === null ? null : regexOf(rule.path),
    allowlists: rule.allowlists.map(compiledAllowlist),
  };
}

export function compiled(table: RuleTable): CompiledTable {
  return { rules: table.rules.map(compiledRule), global: compiledAllowlist(table.global) };
}

function shannonEntropy(text: string): number {
  const counts = new Map<string, number>();
  const characters = Array.from(text);
  for (const character of characters) counts.set(character, (counts.get(character) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const share = count / characters.length;
    entropy -= share * Math.log2(share);
  }
  return entropy;
}

function secretOf(match: RegExpExecArray, secretGroup: number | null): string {
  if (secretGroup !== null) return match[secretGroup] ?? "";
  return match.slice(1).find((group) => group !== undefined && group !== "") ?? match[0];
}

function lineOf(text: string, at: number, length: number): string {
  const start = text.lastIndexOf(NEWLINE, at - 1) + 1;
  const after = text.indexOf(NEWLINE, at + length);
  return text.slice(start, after < 0 ? text.length : after);
}

function targetOf({ secret, match, line }: Sighting, target: AllowTarget): string {
  switch (target) {
    case "secret":
      return secret;
    case "match":
      return match;
    case "line":
      return line;
    default:
      return unreachable(target);
  }
}

function allows(allowlist: CompiledAllowlist, sighting: Sighting): boolean {
  const target = targetOf(sighting, allowlist.target);
  const lowered = sighting.secret.toLowerCase();
  const parts = [
    ...(allowlist.paths.length === 0 ? [] : [allowlist.paths.some((path) => path.test(sighting.path))]),
    ...(allowlist.regexes.length === 0 ? [] : [allowlist.regexes.some((regex) => regex.test(target))]),
    ...(allowlist.stopwords.length === 0 ? [] : [allowlist.stopwords.some((word) => lowered.includes(word))]),
  ];
  switch (allowlist.condition) {
    case "OR":
      return parts.some(Boolean);
    case "AND":
      return parts.length > 0 && parts.every(Boolean);
    default:
      return unreachable(allowlist.condition);
  }
}

function applies(rule: CompiledRule, path: string, lowered: string): boolean {
  if (rule.path !== null && !rule.path.test(path)) return false;
  return rule.keywords.length === 0 || rule.keywords.some((keyword) => lowered.includes(keyword));
}

function lineNumber(text: string, at: number): number {
  let line = 1;
  for (let index = text.indexOf(NEWLINE); index >= 0 && index < at; index = text.indexOf(NEWLINE, index + 1))
    line += 1;
  return line;
}

function shownOf(secret: string): string {
  return Array.from(secret).slice(0, SHOWN_CHARACTERS).join("");
}

function hashOf(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function secretsByRule(rule: CompiledRule, path: string, text: string, global: CompiledAllowlist): Secret[] {
  const found: Secret[] = [];
  for (const match of text.matchAll(rule.pattern)) {
    const secret = secretOf(match, rule.secretGroup);
    if (secret === "") continue;
    if (rule.entropy !== null && shannonEntropy(secret) <= rule.entropy) continue;
    const sighting = { path, secret, match: match[0], line: lineOf(text, match.index, match[0].length) };
    if ([global, ...rule.allowlists].some((allowlist) => allows(allowlist, sighting))) continue;
    found.push({
      rule: rule.id,
      line: lineNumber(text, match.index),
      shown: shownOf(secret),
      hash: hashOf(secret),
    });
  }
  return found;
}

function byLineThenRule(a: Secret, b: Secret): number {
  if (a.line !== b.line) return a.line - b.line;
  if (a.rule === b.rule) return 0;
  return a.rule < b.rule ? -1 : 1;
}

function isGeneric(rule: string): boolean {
  return rule.includes(GENERIC);
}

function withoutGenericRepeats(found: readonly Secret[]): Secret[] {
  const specific = new Set(
    found.filter(({ rule }) => !isGeneric(rule)).map(({ line, hash }) => `${line}:${hash}`),
  );
  return found.filter(({ rule, line, hash }) => !isGeneric(rule) || !specific.has(`${line}:${hash}`));
}

export function secretsIn(path: string, text: string, table: CompiledTable): readonly Secret[] {
  if (table.global.paths.some((skip) => skip.test(path))) return [];
  const lowered = text.toLowerCase();
  const found = table.rules
    .filter((rule) => applies(rule, path, lowered))
    .flatMap((rule) => secretsByRule(rule, path, text, table.global));
  return withoutGenericRepeats(found).sort(byLineThenRule);
}
