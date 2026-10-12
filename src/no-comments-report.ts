import { invariant, unreachable } from "./assert";
import type { FileFindings, Refused } from "./no-comments-scan";

export type Scope = "change" | "tracked";

type Block = { readonly path: string; readonly lines: readonly string[] };

type Listing = { readonly blocks: readonly Block[]; readonly findingsFrom: readonly number[] };

export const REPLY_BYTES = 4_000;

const BODY_CHARACTERS = 120;

const CUT = "…";

const INDENT = "  ";

const COMMENT_FIX = "Remove each comment; a why belongs in a name, a test or the docs.";

const SYNTAX_FIX = "Fix the syntax where each file stops parsing.";

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

function shownBody(body: string): string {
  const characters = Array.from(body);
  if (characters.length <= BODY_CHARACTERS) return body;
  return `${characters.slice(0, BODY_CHARACTERS - 1).join("")}${CUT}`;
}

function commentLine({ line, body }: Refused): string {
  return `${INDENT}${line}  ${shownBody(body)}`;
}

function blockOf(file: FileFindings): Block {
  switch (file.kind) {
    case "comments":
      return { path: file.path, lines: file.comments.map(commentLine) };
    case "unparsed":
      return { path: file.path, lines: [`${INDENT}${file.line}  does not parse: ${file.reason}`] };
    default:
      return unreachable(file);
  }
}

function lineBytes(line: string): number {
  return Buffer.byteLength(line) + 1;
}

function remainderLine(findings: number, files: number): string {
  return `${CUT} ${counted(findings, "more finding", "more findings")} in ${counted(files, "file", "files")}`;
}

function listingOf(blocks: readonly Block[]): Listing {
  let left = blocks.reduce((sum, { lines }) => sum + lines.length, 0);
  const findingsFrom = blocks.map(({ lines }) => {
    const from = left;
    left -= lines.length;
    return from;
  });
  return { blocks, findingsFrom: [...findingsFrom, 0] };
}

function tailOf(
  { blocks, findingsFrom }: Listing,
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
    invariant(block !== undefined && restFindings !== undefined, "a tail starts inside the blocks");
    const unshown = block.lines.length - (index === at ? shownOfFirst : 0);
    if (unshown === 0) continue;
    const line = `${block.path}: ${unshown} more`;
    const restFiles = blocks.length - index - 1;
    const reserve = restFiles === 0 ? 0 : lineBytes(remainderLine(restFindings, restFiles));
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

function capped(header: string, listing: Listing, maxBytes: number): string[] {
  const shown = [header];
  let used = lineBytes(header);
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

export function reply(found: readonly FileFindings[], scope: Scope, maxBytes: number | null): string {
  if (found.length === 0) return "";
  const header = headerOf(found, scope);
  const blocks = found.map(blockOf);
  const whole = [header, ...blocks.flatMap(({ path, lines }) => [path, ...lines])];
  const total = whole.reduce((sum, line) => sum + lineBytes(line), 0);
  const lines = maxBytes === null || total <= maxBytes ? whole : capped(header, listingOf(blocks), maxBytes);
  return lines.map((line) => `${line}\n`).join("");
}
