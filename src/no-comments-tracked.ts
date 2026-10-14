import { LANGUAGE_NAMES, type Language, languageOf } from "./no-comments-languages";
import { routeOf } from "./no-comments-route";
import { changesInTheCode, filesOf } from "./no-comments-scan";
import { firstLine } from "./no-comments-spans";

export function trackedPerLanguage(root: string): ReadonlyMap<Language, number> {
  const tracked = changesInTheCode(root, { kind: "all" }).map(({ head }) => head);
  const routedByShebang = tracked.filter(({ path }) => routeOf(path).kind === "first-line");
  const shebangs = new Map(filesOf(root, routedByShebang).map(({ path, text }) => [path, firstLine(text)]));
  const counts = new Map<Language, number>(LANGUAGE_NAMES.map((language) => [language, 0]));
  for (const { path } of tracked) {
    const language = languageOf(path, shebangs.get(path) ?? "");
    if (language !== null) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return counts;
}

export function trackedLanguages(tracked: ReadonlyMap<Language, number>): Language[] {
  return LANGUAGE_NAMES.filter((language) => (tracked.get(language) ?? 0) > 0);
}
