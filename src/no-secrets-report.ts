import { ALLOW_FILE } from "./no-secrets-allow";
import type { FileSecrets, Found } from "./no-secrets-judge";
import type { Scope } from "./scanner-call";
import { annotationsOf, CUT, counted, type Reported, replyOf, subjectOf } from "./scanner-report";

const GATE = "no-secrets";

const CHANGE_SUBJECT = "this change adds";

const FIX = `Remove each secret, rotate it if it was ever pushed, or allow a reviewed false positive in ${ALLOW_FILE}.`;

function secretCount(found: readonly FileSecrets[]): number {
  return found.reduce((sum, { secrets }) => sum + secrets.length, 0);
}

export function countsOf(found: readonly FileSecrets[], scope: Scope): string {
  const count = secretCount(found);
  const subject = subjectOf(scope, CHANGE_SUBJECT);
  if (count === 0) return `${subject} no secret`;
  return `${subject} ${counted(count, "secret", "secrets")}`;
}

function headerOf(found: readonly FileSecrets[], scope: Scope): string {
  return `${GATE}: ${countsOf(found, scope)}. ${FIX}`;
}

function shownFinding({ rule, shown, fingerprint }: Found): string {
  return `${rule}: ${shown}${CUT}  allow: ${fingerprint}`;
}

function reported({ path, secrets }: FileSecrets): Reported {
  return { path, findings: secrets.map((secret) => ({ line: secret.line, text: shownFinding(secret) })) };
}

export function reply(found: readonly FileSecrets[], scope: Scope, maxBytes: number | null): string {
  return replyOf(headerOf(found, scope), found.map(reported), maxBytes);
}

export function annotations(found: readonly FileSecrets[]): string {
  return annotationsOf(GATE, found.map(reported));
}
