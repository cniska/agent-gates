type Route = { readonly kind: "extension"; readonly extension: string } | { readonly kind: "first-line" };

export const SHEBANG_PREFIX = "#!";

const SHEBANG = /^#!\s*(?:\/usr\/bin\/env\s+(?:-\S+\s+)*)?(?:\S*\/)?([^\s/]+)(.*)/;

const VERSION_SUFFIX = /\d+(?:\.\d+)*$/;

const UV = "uv";

const UV_SCRIPT_ARGUMENTS = /^\s+run\s+(?:\S+\s+)*--script(?:\s|$)/;

export const UV_SCRIPT = "uv run --script";

export function routeOf(path: string): Route {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { kind: "first-line" };
  return { kind: "extension", extension: name.slice(dot) };
}

export function interpreterOf(head: string): string | null {
  const found = SHEBANG.exec(head);
  const program = found?.[1];
  const argumentsText = found?.[2];
  if (program === undefined || argumentsText === undefined) return null;
  if (program === UV && UV_SCRIPT_ARGUMENTS.test(argumentsText)) return UV_SCRIPT;
  return program.replace(VERSION_SUFFIX, "");
}
