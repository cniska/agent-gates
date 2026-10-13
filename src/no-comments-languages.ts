import { interpreterOf, routeOf } from "./no-comments-route";

export const LANGUAGE_NAMES = ["javascript", "dart", "sql", "shell", "rust"] as const;

export type Language = (typeof LANGUAGE_NAMES)[number];

export type Comment = { readonly line: number; readonly text: string };

export type Reading =
  | { readonly kind: "read"; readonly comments: readonly Comment[] }
  | { readonly kind: "unparsed"; readonly line: number; readonly reason: string };

export type Tracked = (path: string) => boolean;

export type CommentsOf = (path: string, text: string, tracked: Tracked) => Reading;

export type Adapter = { readonly comments: CommentsOf; readonly kept: readonly string[] };

type LanguageEntry = {
  readonly shown: string;
  readonly extensions: readonly string[];
  readonly interpreters: readonly string[];
};

export const LANGUAGES: Readonly<Record<Language, LanguageEntry>> = {
  javascript: {
    shown: "JavaScript and TypeScript",
    extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
    interpreters: ["node", "bun", "deno"],
  },
  dart: { shown: "Dart", extensions: [".dart"], interpreters: ["dart"] },
  sql: { shown: "SQL", extensions: [".sql"], interpreters: [] },
  shell: { shown: "shell", extensions: [".sh", ".bash"], interpreters: ["sh", "bash", "dash", "zsh"] },
  rust: { shown: "Rust", extensions: [".rs"], interpreters: [] },
};

export function languageOf(path: string, firstLine: string): Language | null {
  const route = routeOf(path);
  if (route.kind === "extension")
    return (
      LANGUAGE_NAMES.find((language) => LANGUAGES[language].extensions.includes(route.extension)) ?? null
    );
  const interpreter = interpreterOf(firstLine);
  if (interpreter === null) return null;
  return LANGUAGE_NAMES.find((language) => LANGUAGES[language].interpreters.includes(interpreter)) ?? null;
}
