import { interpreterOf, routeOf } from "./no-comments-route";

export const LANGUAGE_NAMES = ["javascript", "dart", "sql", "shell", "rust"] as const;

export type Language = (typeof LANGUAGE_NAMES)[number];

export type Comment = { readonly line: number; readonly body: string };

export type CommentsOf = (path: string, text: string) => Promise<readonly Comment[] | null>;

type Routing = { readonly extensions: readonly string[]; readonly interpreters: readonly string[] };

export const LANGUAGES: Readonly<Record<Language, Routing>> = {
  javascript: {
    extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
    interpreters: ["node", "bun", "deno"],
  },
  dart: { extensions: [".dart"], interpreters: ["dart"] },
  sql: { extensions: [".sql"], interpreters: [] },
  shell: { extensions: [".sh", ".bash"], interpreters: ["sh", "bash", "dash", "zsh"] },
  rust: { extensions: [".rs"], interpreters: [] },
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
