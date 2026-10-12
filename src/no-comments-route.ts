type Route = { readonly kind: "extension"; readonly extension: string } | { readonly kind: "first-line" };

export const SHEBANG_PREFIX = "#!";

const SHEBANG = /^#!\s*(?:\/usr\/bin\/env\s+(?:-\S+\s+)*)?(?:\S*\/)?([^\s/]+)/;

export function routeOf(path: string): Route {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { kind: "first-line" };
  return { kind: "extension", extension: name.slice(dot) };
}

export function interpreterOf(head: string): string | null {
  return SHEBANG.exec(head)?.[1] ?? null;
}

export function lineEnd(text: string, from: number): number {
  const newline = text.indexOf("\n", from);
  return newline < 0 ? text.length : newline;
}

export function firstLine(text: string): string {
  return text.slice(0, lineEnd(text, 0));
}
