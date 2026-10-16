import { unreachable } from "./assert";
import type { Scope } from "./scanner-call";

export type Finding = { readonly line: number; readonly text: string };

export type Reported = { readonly path: string; readonly findings: readonly Finding[] };

export type Block = { readonly path: string; readonly lines: readonly string[] };

export const REPLY_BYTES = 4_000;

export const CUT = "…";

const INDENT = "  ";

const TRACKED_SUBJECT = "the tracked files hold";

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

export function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function subjectOf(scope: Scope, changeSubject: string): string {
  switch (scope) {
    case "change":
      return changeSubject;
    case "tracked":
      return TRACKED_SUBJECT;
    default:
      return unreachable(scope);
  }
}

function findingLine({ line, text }: Finding): string {
  return `${INDENT}${line}  ${text}`;
}

export function lineBytes(line: string): number {
  return Buffer.byteLength(line) + 1;
}

export function remainderLine(findings: number, files: number): string {
  return `${CUT} ${counted(findings, "more finding", "more findings")} in ${counted(files, "file", "files")}`;
}

export function printed(lines: readonly string[]): string {
  return lines.map((line) => `${line}\n`).join("");
}

export function blockOf({ path, findings }: Reported): Block {
  return { path, lines: findings.map(findingLine) };
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

export function replyOf(header: string, files: readonly Reported[], maxBytes: number | null): string {
  if (files.length === 0) return "";
  const blocks = files.map(blockOf);
  const whole = [header, ...blocks.flatMap(({ path, lines }) => [path, ...lines])];
  const total = whole.reduce((sum, line) => sum + lineBytes(line), 0);
  return printed(maxBytes === null || total <= maxBytes ? whole : capped(header, blocks, maxBytes));
}

function escaped(value: string, escapes: readonly (readonly [string, string])[]): string {
  return escapes.reduce((text, [from, to]) => text.replaceAll(from, to), value);
}

export function annotationsOf(gate: string, files: readonly Reported[]): string {
  const all = files.flatMap(({ path, findings }) =>
    findings.map(
      ({ line, text }) =>
        `::error file=${escaped(path, PROPERTY_ESCAPES)},line=${line}::${escaped(text, DATA_ESCAPES)}`,
    ),
  );
  if (all.length <= ANNOTATIONS_PER_STEP) return printed(all);
  const shown = all.slice(0, ANNOTATIONS_PER_STEP - 1);
  const rest = counted(all.length - shown.length, "more finding", "more findings");
  return printed([...shown, `::error::${gate}: ${rest}; the step's log lists them all`]);
}
