export const LANGUAGE_NAMES = ["javascript"] as const;

export type Language = (typeof LANGUAGE_NAMES)[number];

export type Comment = { readonly line: number; readonly body: string };

export type CommentsOf = (path: string, text: string) => Promise<readonly Comment[] | null>;

type Routing = { readonly extensions: readonly string[]; readonly interpreters: readonly string[] };

export const LANGUAGES: Readonly<Record<Language, Routing>> = {
  javascript: {
    extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
    interpreters: ["node", "bun", "deno"],
  },
};

const SHEBANG = /^#!\s*(?:\/usr\/bin\/env\s+(?:-\S+\s+)*)?(?:\S*\/)?([^\s/]+)/;

export type Route =
  | { readonly kind: "extension"; readonly extension: string; readonly language: Language | null }
  | { readonly kind: "first-line" };

export function routeOf(path: string): Route {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { kind: "first-line" };
  const extension = name.slice(dot);
  const language = LANGUAGE_NAMES.find((named) => LANGUAGES[named].extensions.includes(extension)) ?? null;
  return { kind: "extension", extension, language };
}

export function interpreterOf(head: string): string | null {
  return SHEBANG.exec(head)?.[1] ?? null;
}

export function languageOf(path: string, firstLine: string): Language | null {
  const route = routeOf(path);
  if (route.kind === "extension") return route.language;
  const interpreter = interpreterOf(firstLine);
  if (interpreter === null) return null;
  return LANGUAGE_NAMES.find((language) => LANGUAGES[language].interpreters.includes(interpreter)) ?? null;
}
