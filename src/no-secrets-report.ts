import { ALLOW_FILE } from "./no-secrets-allow";
import type { FileSecrets, Found } from "./no-secrets-judge";

export type Scope = "change" | "tracked";

type Block = { readonly path: string; readonly lines: readonly string[] };

export const REPLY_BYTES = 4_000;

const CUT = "…";

const INDENT = "  ";

const ANNOTATIONS_PER_STEP = 10;

const DATA_ESCAPES: readonly (readonly [string, string])[] = [
  ["%", "%25"],
  ["\r", "%0D"],
  ["\n", "%0A"],
];

const PROPERTY_ESCAPES: readonly (readonly [string, string])[] = [
  ...DATA_ESCAPES,
  [":", "%3A"],
  [",", "%2C"],
];

const SUBJECT: Readonly<Record<Scope, string>> = {
  change: "this change adds",
  tracked: "the tracked files hold",
};

const FIX = `Remove each secret, rotate it if it was ever pushed, or allow a reviewed false positive in ${ALLOW_FILE}.`;

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function secretCount(found: readonly FileSecrets[]): number {
  return found.reduce((sum, { secrets }) => sum + secrets.length, 0);
}

function headerOf(found: readonly FileSecrets[], scope: Scope): string {
  return `no-secrets: ${SUBJECT[scope]} ${counted(secretCount(found), "secret", "secrets")}. ${FIX}`;
}

function shownFinding({ rule, shown, fingerprint }: Found): string {
  return `${rule}: ${shown}${CUT}  allow: ${fingerprint}`;
}

function blockOf({ path, secrets }: FileSecrets): Block {
  return { path, lines: secrets.map((secret) => `${INDENT}${secret.line}  ${shownFinding(secret)}`) };
}

function lineBytes(line: string): number {
  return Buffer.byteLength(line) + 1;
}

function remainderLine(findings: number, files: number): string {
  return `${CUT} ${counted(findings, "more finding", "more findings")} in ${counted(files, "file", "files")}`;
}

function capped(header: string, blocks: readonly Block[], maxBytes: number): string[] {
  const shown = [header];
  let used = lineBytes(header);
  const total = blocks.reduce((sum, { lines }) => sum + lines.length, 0);
  let listed = 0;
  for (const [at, block] of blocks.entries()) {
    for (const [count, line] of block.lines.entries()) {
      const added = count === 0 ? [block.path, line] : [line];
      const cost = added.reduce((sum, next) => sum + lineBytes(next), 0);
      const remainder = remainderLine(total - listed - 1, blocks.length - at);
      if (used + cost + lineBytes(remainder) > maxBytes) {
        return [...shown, remainderLine(total - listed, blocks.length - at)];
      }
      shown.push(...added);
      used += cost;
      listed += 1;
    }
  }
  return shown;
}

function printed(lines: readonly string[]): string {
  return lines.map((line) => `${line}\n`).join("");
}

export function reply(found: readonly FileSecrets[], scope: Scope, maxBytes: number | null): string {
  if (found.length === 0) return "";
  const header = headerOf(found, scope);
  const blocks = found.map(blockOf);
  const whole = [header, ...blocks.flatMap(({ path, lines }) => [path, ...lines])];
  const total = whole.reduce((sum, line) => sum + lineBytes(line), 0);
  return printed(maxBytes === null || total <= maxBytes ? whole : capped(header, blocks, maxBytes));
}

function escaped(value: string, escapes: readonly (readonly [string, string])[]): string {
  return escapes.reduce((text, [from, to]) => text.replaceAll(from, to), value);
}

export function annotations(found: readonly FileSecrets[]): string {
  const all = found.flatMap(({ path, secrets }) =>
    secrets.map(
      (secret) =>
        `::error file=${escaped(path, PROPERTY_ESCAPES)},line=${secret.line}::${escaped(shownFinding(secret), DATA_ESCAPES)}`,
    ),
  );
  if (all.length <= ANNOTATIONS_PER_STEP) return printed(all);
  const shown = all.slice(0, ANNOTATIONS_PER_STEP - 1);
  const rest = counted(all.length - shown.length, "more finding", "more findings");
  return printed([...shown, `::error::no-secrets: ${rest}; the step's log lists them all`]);
}
