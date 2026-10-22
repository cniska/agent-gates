import { type Refusal, refusals } from "./coded-error";
import { LANGUAGE_NAMES, type Language } from "./no-comments-languages";

export const KEEP_FILE = ".no-comments-keep";

const INSTALL_KEEP_LINES: readonly string[] = ["shell # agent-gate:[a-z-]+:[0-9]+"];

type KeepPattern = { readonly language: Language; readonly shown: string; readonly matches: RegExp };

export type Keep = readonly KeepPattern[];

type KeepRead =
  | { readonly kind: "parsed"; readonly keep: Keep }
  | { readonly kind: "malformed"; readonly refusal: Refusal };

type Fault = "unknown_language" | "no_regex" | "uncompiled_regex";

const FAULTS: Readonly<Record<Fault, string>> = {
  unknown_language: "names no language the gates read",
  no_regex: "holds no regex after its language",
  uncompiled_regex: "holds a regex that does not compile",
};

const keepRefusal = refusals<{
  readonly malformed_keep_line: { readonly line: number; readonly text: string; readonly fault: Fault };
}>({
  malformed_keep_line: {
    message: ({ line, text, fault }) => `${KEEP_FILE} line ${line} ${FAULTS[fault]}: ${text}`,
    resolve: () =>
      `write each line of ${KEEP_FILE} as a language (${LANGUAGE_NAMES.join(", ")}), one space and a regex that compiles, blank lines aside`,
  },
});

const SEPARATOR = " ";

const NEWLINE = "\n";

function isLanguage(name: string): name is Language {
  return LANGUAGE_NAMES.some((language) => language === name);
}

function compiled(source: string): RegExp | null {
  try {
    return new RegExp(`^(?:${source})$`, "u");
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function malformed(line: number, text: string, fault: Fault): KeepRead {
  return { kind: "malformed", refusal: keepRefusal("malformed_keep_line", { line, text, fault }) };
}

export function keepRead(text: string | null): KeepRead {
  const keep: KeepPattern[] = [];
  if (text === null) return { kind: "parsed", keep };
  for (const [index, untrimmed] of text.split(NEWLINE).entries()) {
    const raw = untrimmed.trimEnd();
    if (raw.trim() === "") continue;
    const line = index + 1;
    const at = raw.indexOf(SEPARATOR);
    const name = at < 0 ? raw : raw.slice(0, at);
    const shown = at < 0 ? "" : raw.slice(at + SEPARATOR.length);
    if (!isLanguage(name)) return malformed(line, raw, "unknown_language");
    if (shown === "") return malformed(line, raw, "no_regex");
    const matches = compiled(shown);
    if (matches === null) return malformed(line, raw, "uncompiled_regex");
    keep.push({ language: name, shown, matches });
  }
  return { kind: "parsed", keep };
}

export function isKept(keep: Keep, language: Language, comment: string): boolean {
  const trimmed = comment.trim();
  return keep.some((pattern) => pattern.language === language && pattern.matches.test(trimmed));
}

export function keptShown(keep: Keep, language: Language): readonly string[] {
  return keep.flatMap((pattern) => (pattern.language === language ? [pattern.shown] : []));
}

export function withInstallLines(text: string | null): string | null {
  const lines = text === null ? [] : text.split(NEWLINE).map((line) => line.trimEnd());
  const missing = INSTALL_KEEP_LINES.filter((line) => !lines.includes(line));
  if (missing.length === 0) return null;
  const added = missing.map((line) => `${line}${NEWLINE}`).join("");
  if (text === null || text === "" || text.endsWith(NEWLINE)) return `${text ?? ""}${added}`;
  return `${text}${NEWLINE}${added}`;
}
