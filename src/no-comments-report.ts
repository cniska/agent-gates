import { invariant, unreachable } from "./assert";
import { LANGUAGE_NAMES, LANGUAGES, type Language } from "./no-comments-languages";
import type { FileFindings } from "./no-comments-scan";

export type KeptOf = (language: Language) => readonly string[];

export type Scope = "change" | "tracked";

type Shown = { readonly line: number; readonly text: string };

type Block = { readonly path: string; readonly lines: readonly string[] };

type Listing = {
  readonly blocks: readonly Block[];
  readonly findingsFrom: readonly number[];
  readonly cheapestTailFrom: readonly number[];
};

export const REPLY_BYTES = 4_000;

const BODY_CHARACTERS = 120;

const CUT = "…";

const INDENT = "  ";

const COMMENT_FIX = "Remove each comment; a why belongs in a name, a test or the docs.";

const SYNTAX_FIX = "Fix the syntax where each file stops parsing.";

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

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function commentCount(found: readonly FileFindings[]): number {
  return found.reduce((sum, file) => sum + (file.kind === "comments" ? file.comments.length : 0), 0);
}

function headerOf(found: readonly FileFindings[], scope: Scope): string {
  const comments = commentCount(found);
  const unparsed = found.filter(({ kind }) => kind === "unparsed").length;
  const counts = [
    ...(comments > 0 ? [`${SUBJECT[scope]} ${counted(comments, "comment", "comments")}`] : []),
    ...(unparsed > 0 ? [`${counted(unparsed, "file does", "files do")} not parse`] : []),
  ];
  const fixes = [...(comments > 0 ? [COMMENT_FIX] : []), ...(unparsed > 0 ? [SYNTAX_FIX] : [])];
  return `no-comments: ${counts.join(", and ")}. ${fixes.join(" ")}`;
}

function keptLines(found: readonly FileFindings[], keptOf: KeptOf): string[] {
  const refused = new Set(found.flatMap((file) => (file.kind === "comments" ? [file.language] : [])));
  return LANGUAGE_NAMES.filter((language) => refused.has(language)).map(
    (language) => `kept in ${LANGUAGES[language].shown}: ${keptOf(language).join("; ")}`,
  );
}

function shownBody(body: string): string {
  const characters = Array.from(body);
  if (characters.length <= BODY_CHARACTERS) return body;
  return `${characters.slice(0, BODY_CHARACTERS - 1).join("")}${CUT}`;
}

function shownFindings(file: FileFindings): Shown[] {
  switch (file.kind) {
    case "comments":
      return file.comments.map(({ line, body }) => ({ line, text: shownBody(body) }));
    case "unparsed":
      return [{ line: file.line, text: `does not parse: ${file.reason}` }];
    default:
      return unreachable(file);
  }
}

function blockOf(file: FileFindings): Block {
  return { path: file.path, lines: shownFindings(file).map(({ line, text }) => `${INDENT}${line}  ${text}`) };
}

function lineBytes(line: string): number {
  return Buffer.byteLength(line) + 1;
}

function remainderLine(findings: number, files: number): string {
  return `${CUT} ${counted(findings, "more finding", "more findings")} in ${counted(files, "file", "files")}`;
}

function countLine(block: Block, unshown: number): string {
  return `${block.path}: ${unshown} more`;
}

function listingOf(blocks: readonly Block[]): Listing {
  let left = blocks.reduce((sum, { lines }) => sum + lines.length, 0);
  const findingsFrom = blocks.map(({ lines }) => {
    const from = left;
    left -= lines.length;
    return from;
  });
  const cheapestTailFrom = [0];
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    const findings = findingsFrom[index];
    const after = cheapestTailFrom[0];
    invariant(block !== undefined && findings !== undefined && after !== undefined, "each block is counted");
    const named = lineBytes(countLine(block, block.lines.length)) + after;
    cheapestTailFrom.unshift(Math.min(named, lineBytes(remainderLine(findings, blocks.length - index))));
  }
  return { blocks, findingsFrom: [...findingsFrom, 0], cheapestTailFrom };
}

function tailOf(
  { blocks, findingsFrom, cheapestTailFrom }: Listing,
  at: number,
  shownOfFirst: number,
  room: number,
): string[] | null {
  if (room < 0) return null;
  const tail: string[] = [];
  let used = 0;
  for (let index = at; index < blocks.length; index++) {
    const block = blocks[index];
    const restFindings = findingsFrom[index + 1];
    const reserve = cheapestTailFrom[index + 1];
    invariant(
      block !== undefined && restFindings !== undefined && reserve !== undefined,
      "a tail starts inside the blocks",
    );
    const unshown = block.lines.length - (index === at ? shownOfFirst : 0);
    if (unshown === 0) continue;
    const line = countLine(block, unshown);
    const restFiles = blocks.length - index - 1;
    if (used + lineBytes(line) + reserve <= room) {
      tail.push(line);
      used += lineBytes(line);
      continue;
    }
    const remainder = remainderLine(unshown + restFindings, restFiles + 1);
    return used + lineBytes(remainder) <= room ? [...tail, remainder] : null;
  }
  return tail;
}

function capped(header: readonly string[], listing: Listing, maxBytes: number): string[] {
  const shown = [...header];
  let used = header.reduce((sum, line) => sum + lineBytes(line), 0);
  for (const [at, block] of listing.blocks.entries()) {
    for (const [count, line] of block.lines.entries()) {
      const added = count === 0 ? [block.path, line] : [line];
      const cost = added.reduce((sum, next) => sum + lineBytes(next), 0);
      if (tailOf(listing, at, count + 1, maxBytes - used - cost) === null) {
        const tail = tailOf(listing, at, count, maxBytes - used);
        invariant(tail !== null, "the tail fits in the room the last shown line left");
        return [...shown, ...tail];
      }
      shown.push(...added);
      used += cost;
    }
  }
  return shown;
}

function printed(lines: readonly string[]): string {
  return lines.map((line) => `${line}\n`).join("");
}

export function reply(
  found: readonly FileFindings[],
  scope: Scope,
  keptOf: KeptOf,
  maxBytes: number | null,
): string {
  if (found.length === 0) return "";
  const header = [headerOf(found, scope), ...keptLines(found, keptOf)];
  const blocks = found.map(blockOf);
  const whole = [...header, ...blocks.flatMap(({ path, lines }) => [path, ...lines])];
  const total = whole.reduce((sum, line) => sum + lineBytes(line), 0);
  const lines = maxBytes === null || total <= maxBytes ? whole : capped(header, listingOf(blocks), maxBytes);
  return printed(lines);
}

function escaped(value: string, escapes: readonly (readonly [string, string])[]): string {
  return escapes.reduce((text, [from, to]) => text.replaceAll(from, to), value);
}

export function annotations(found: readonly FileFindings[]): string {
  const all = found.flatMap((file) =>
    shownFindings(file).map(
      ({ line, text }) =>
        `::error file=${escaped(file.path, PROPERTY_ESCAPES)},line=${line}::${escaped(text, DATA_ESCAPES)}`,
    ),
  );
  if (all.length <= ANNOTATIONS_PER_STEP) return printed(all);
  const shown = all.slice(0, ANNOTATIONS_PER_STEP - 1);
  const rest = counted(all.length - shown.length, "more finding", "more findings");
  return printed([...shown, `::error::no-comments: ${rest}; the step's log lists them all`]);
}
