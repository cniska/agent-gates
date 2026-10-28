import { ALLOW_FILE, fingerprintOf, parsedAllow } from "./no-secrets-allow";
import { type JudgedChange, judgedChange, type RootRelative } from "./no-secrets-change";
import { type CompiledTable, compiled, type Secret, secretsIn } from "./no-secrets-match";
import { shippedRules } from "./no-secrets-rules" with { type: "macro" };
import { type FileText, type Judged, judgedTextOf } from "./scanner-change";

export type Found = Secret & { readonly fingerprint: string };

export type FileSecrets = { readonly path: string; readonly secrets: readonly [Found, ...Found[]] };

type Judging = {
  readonly table: CompiledTable;
  readonly allowed: ReadonlySet<string>;
  readonly skipped: readonly RootRelative[];
};

const TABLE = compiled(shippedRules());

const PATH_SEPARATOR = "/";

const KNOWN_SEPARATOR = ":";

function isUnder(path: string, { inRoot }: RootRelative): boolean {
  return path === inRoot || path.startsWith(`${inRoot}${PATH_SEPARATOR}`);
}

function byPath(a: FileSecrets, b: FileSecrets): number {
  if (a.path === b.path) return 0;
  return a.path < b.path ? -1 : 1;
}

function knownOf({ rule, hash }: Secret): string {
  return `${rule}${KNOWN_SEPARATOR}${hash}`;
}

function knownIn(bases: readonly FileText[], table: CompiledTable): ReadonlySet<string> {
  return new Set(bases.flatMap(({ path, text }) => secretsIn(path, text, table).map(knownOf)));
}

function fileSecretsOf(
  { path, text }: FileText,
  { table, allowed }: Judging,
  known: ReadonlySet<string>,
): FileSecrets | null {
  const secrets = secretsIn(path, text, table).flatMap((secret): Found[] => {
    if (known.has(knownOf(secret))) return [];
    const fingerprint = fingerprintOf(secret.rule, path, secret.hash);
    return allowed.has(fingerprint) ? [] : [{ ...secret, fingerprint }];
  });
  const [first, ...rest] = secrets;
  return first === undefined ? null : { path, secrets: [first, ...rest] };
}

function judged({ heads, bases }: JudgedChange, judging: Judging): readonly FileSecrets[] {
  const known = knownIn(bases, judging.table);
  return heads
    .filter(({ path }) => !judging.skipped.some((skipped) => isUnder(path, skipped)))
    .flatMap((head) => fileSecretsOf(head, judging, known) ?? [])
    .toSorted(byPath);
}

export function secretsAdded(
  root: string,
  target: Judged,
  skipped: readonly RootRelative[],
): readonly FileSecrets[] {
  const allowed = parsedAllow(judgedTextOf(root, target, ALLOW_FILE));
  return judged(judgedChange(root, target), {
    table: TABLE,
    allowed,
    skipped: [...skipped, { inRoot: ALLOW_FILE }],
  });
}
