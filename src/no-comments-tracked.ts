import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { gitOutput, nulFields } from "./git";
import { LANGUAGE_NAMES, type Language, languageOf, routeOf } from "./no-comments-languages";
import { firstLine, HEAD_SPAN, marksGenerated, outsideTheCode } from "./no-comments-skips";

const REGULAR_FILE = /^100(?:644|755) /;

const MOST_BYTES_PER_CHAR = 4;

function headOf(path: string): string {
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(HEAD_SPAN * MOST_BYTES_PER_CHAR);
    const read = readSync(descriptor, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, read).toString().slice(0, HEAD_SPAN);
  } finally {
    closeSync(descriptor);
  }
}

function isRouted(path: string): boolean {
  const route = routeOf(path);
  return route.kind === "first-line" || route.language !== null;
}

function trackedRegularFiles(root: string): string[] {
  return nulFields(gitOutput(root, ["ls-files", "-z", "--stage"])).flatMap((entry) => {
    const tab = entry.indexOf("\t");
    return REGULAR_FILE.test(entry) && tab !== -1 ? [entry.slice(tab + 1)] : [];
  });
}

export function trackedPerLanguage(root: string): ReadonlyMap<Language, number> {
  const counts = new Map<Language, number>(LANGUAGE_NAMES.map((language) => [language, 0]));
  const routed = trackedRegularFiles(root).filter((path) => isRouted(path) && existsSync(join(root, path)));
  const outside = outsideTheCode(root, routed);
  for (const path of routed) {
    if (outside.has(path)) continue;
    const head = headOf(join(root, path));
    const language = languageOf(path, firstLine(head));
    if (language === null || marksGenerated(head)) continue;
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return counts;
}
