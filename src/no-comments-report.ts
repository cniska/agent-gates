import { invariant, unreachable } from "./assert";
import { KEEP_FILE, type Keep, keptShown } from "./no-comments-keep";
import { LANGUAGE_NAMES, LANGUAGES } from "./no-comments-languages";
import type { FileFindings } from "./no-comments-scan";
import type { Scope } from "./scanner-call";
import {
  annotationsOf,
  type Block,
  blockOf,
  CUT,
  counted,
  type Finding,
  lineBytes,
  printed,
  type Reported,
  remainderLine,
  subjectOf,
} from "./scanner-report";

type Listing = {
  readonly blocks: readonly Block[];
  readonly findingsFrom: readonly number[];
  readonly cheapestTailFrom: readonly number[];
};

const GATE = "no-comments";

const CHANGE_SUBJECT = "this change adds";

const BODY_CHARACTERS = 120;

const COMMENT_FIX = `Remove each comment; a why belongs in a name, a test or the docs. Keep a comment a tool reads in ${KEEP_FILE}.`;

const NO_PATTERN = "none";

const SYNTAX_FIX = "Fix the syntax where each file stops parsing.";

function commentCount(found: readonly FileFindings[]): number {
  return found.reduce((sum, file) => sum + (file.kind === "comments" ? file.comments.length : 0), 0);
}

function unparsedCount(found: readonly FileFindings[]): number {
  return found.filter(({ kind }) => kind === "unparsed").length;
}

export function countsOf(found: readonly FileFindings[], scope: Scope): string {
  const comments = commentCount(found);
  const unparsed = unparsedCount(found);
  const subject = subjectOf(scope, CHANGE_SUBJECT);
  if (comments === 0 && unparsed === 0) return `${subject} no comment`;
  return [
    ...(comments > 0 ? [`${subject} ${counted(comments, "comment", "comments")}`] : []),
    ...(unparsed > 0 ? [`${counted(unparsed, "file does", "files do")} not parse`] : []),
  ].join(", and ");
}

function headerOf(found: readonly FileFindings[], scope: Scope): string {
  const fixes = [
    ...(commentCount(found) > 0 ? [COMMENT_FIX] : []),
    ...(unparsedCount(found) > 0 ? [SYNTAX_FIX] : []),
  ];
  return `${GATE}: ${countsOf(found, scope)}. ${fixes.join(" ")}`;
}

function keptShownOf(patterns: readonly string[]): string {
  if (patterns.length === 0) return NO_PATTERN;
  return patterns.map((pattern) => `\`${pattern}\``).join(", ");
}

function keptLines(found: readonly FileFindings[], keep: Keep): string[] {
  const refused = new Set(found.flatMap((file) => (file.kind === "comments" ? [file.language] : [])));
  return LANGUAGE_NAMES.filter((language) => refused.has(language)).map(
    (language) => `kept in ${LANGUAGES[language].shown}: ${keptShownOf(keptShown(keep, language))}`,
  );
}

function shownBody(body: string): string {
  const characters = Array.from(body);
  if (characters.length <= BODY_CHARACTERS) return body;
  return `${characters.slice(0, BODY_CHARACTERS - 1).join("")}${CUT}`;
}

function shownFindings(file: FileFindings): Finding[] {
  switch (file.kind) {
    case "comments":
      return file.comments.map(({ line, body }) => ({ line, text: shownBody(body) }));
    case "unparsed":
      return [{ line: file.line, text: `does not parse: ${file.reason}` }];
    default:
      return unreachable(file);
  }
}

function reported(file: FileFindings): Reported {
  return { path: file.path, findings: shownFindings(file) };
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

export function reply(
  found: readonly FileFindings[],
  scope: Scope,
  keep: Keep,
  maxBytes: number | null,
): string {
  if (found.length === 0) return "";
  const header = [headerOf(found, scope), ...keptLines(found, keep)];
  const blocks = found.map(reported).map(blockOf);
  const whole = [...header, ...blocks.flatMap(({ path, lines }) => [path, ...lines])];
  const total = whole.reduce((sum, line) => sum + lineBytes(line), 0);
  const lines = maxBytes === null || total <= maxBytes ? whole : capped(header, listingOf(blocks), maxBytes);
  return printed(lines);
}

export function annotations(found: readonly FileFindings[]): string {
  return annotationsOf(GATE, found.map(reported));
}
