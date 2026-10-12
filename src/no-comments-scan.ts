import { unreachable } from "./assert";
import { markerLine } from "./gate-marker";
import { gitOutput, mergeBase, nulFields } from "./git";
import { type CommentsOf, type Language, languageOf } from "./no-comments-languages";
import { marksGenerated, outsideTheCode } from "./no-comments-skips";
import { firstLine } from "./no-comments-spans";

export type Judged =
  | { readonly kind: "staged" }
  | { readonly kind: "pushed"; readonly base: string; readonly head: string };

type JudgedFile = { readonly path: string; readonly text: string };

type Finding =
  | { readonly kind: "comment"; readonly path: string; readonly line: number; readonly body: string }
  | { readonly kind: "unparsed"; readonly path: string; readonly line: number; readonly reason: string };

export type AdapterOf = (language: Language) => CommentsOf | null;

type Changed = { readonly path: string; readonly blob: string };

const REGULAR_FILE_MODES = new Set(["100644", "100755"]);

const CHANGES = ["--no-renames", "--diff-filter=AMT", "-z"];

const BINARY = "-\t-\t";

const FIX = "  Remove each comment; a why belongs in a name, a test or the docs.";

function emptyTree(root: string): string {
  return gitOutput(root, ["hash-object", "-t", "tree", "--stdin"], "").toString().trim();
}

function diffOf(root: string, judged: Judged): string[] {
  switch (judged.kind) {
    case "staged":
      return ["diff", "--cached"];
    case "pushed":
      return ["diff", mergeBase(root, judged.base, judged.head) ?? emptyTree(root), judged.head];
    default:
      return unreachable(judged);
  }
}

function changedFiles(root: string, diff: readonly string[]): Changed[] {
  const fields = nulFields(gitOutput(root, [...diff, ...CHANGES, "--raw", "--no-abbrev"]));
  const changed: Changed[] = [];
  for (let at = 0; at + 1 < fields.length; at += 2) {
    const [, mode, , blob] = (fields[at] ?? "").split(" ");
    const path = fields[at + 1];
    if (path !== undefined && blob !== undefined && mode !== undefined && REGULAR_FILE_MODES.has(mode))
      changed.push({ path, blob });
  }
  return changed;
}

function binaryPaths(root: string, diff: readonly string[]): Set<string> {
  const lines = nulFields(gitOutput(root, [...diff, ...CHANGES, "--numstat"]));
  return new Set(lines.filter((line) => line.startsWith(BINARY)).map((line) => line.slice(BINARY.length)));
}

export function judgedFiles(root: string, judged: Judged): JudgedFile[] {
  const diff = diffOf(root, judged);
  const binary = binaryPaths(root, diff);
  const text = changedFiles(root, diff).filter(({ path }) => !binary.has(path));
  const outside = outsideTheCode(
    root,
    text.map(({ path }) => path),
  );
  return text
    .filter(({ path }) => !outside.has(path))
    .map(({ path, blob }) => ({ path, text: gitOutput(root, ["cat-file", "blob", blob]).toString() }))
    .filter(({ text }) => !marksGenerated(text));
}

export function findings(files: readonly JudgedFile[], adapterOf: AdapterOf): Finding[] {
  const found: Finding[] = [];
  for (const { path, text } of files) {
    const language = languageOf(path, firstLine(text));
    const comments = language === null ? null : adapterOf(language);
    if (comments === null) continue;
    const reading = comments(path, text);
    if (reading.kind === "unparsed") {
      found.push({ kind: "unparsed", path, line: reading.line, reason: reading.reason });
      continue;
    }
    const lines = text.split("\n");
    for (const comment of reading.comments)
      if (markerLine(lines[comment.line - 1] ?? "") === null)
        found.push({ kind: "comment", path, line: comment.line, body: firstLine(comment.text).trim() });
  }
  return found;
}

function lineOf(finding: Finding): string {
  switch (finding.kind) {
    case "comment":
      return `no-comments: ${finding.path}:${finding.line}  ${finding.body}`;
    case "unparsed":
      return `no-comments: ${finding.path}:${finding.line} does not parse: ${finding.reason}; fix its syntax`;
    default:
      return unreachable(finding);
  }
}

export function verdict(found: readonly Finding[]): string[] {
  const lines = found.map(lineOf);
  return found.some(({ kind }) => kind === "comment") ? [...lines, FIX] : lines;
}
