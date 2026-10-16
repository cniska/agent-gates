export type Use = { readonly line: number; readonly ref: string };

const COMMENT = "#";

const KEY_PREFIX = "^\\s*(?:- )*";

const KEY_START = new RegExp(KEY_PREFIX);

const BLOCK_SCALAR = new RegExp(`${KEY_PREFIX}[^\\s#-][^:]*:\\s*[|>][-+0-9]*\\s*(?:#.*)?$`);

const USES = new RegExp(
  `(?<=${KEY_PREFIX}|[{,]\\s*)uses:\\s*(?:"([^"]*)"|'([^']*)'|([^\\s,}"'][^\\s,}]*))`,
  "g",
);

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function keyIndentOf(line: string): number {
  return line.length - line.replace(KEY_START, "").length;
}

function usesOn(line: string): readonly string[] {
  return [...line.matchAll(USES)].flatMap(([, doubleQuoted, singleQuoted, bare]) => {
    const ref = doubleQuoted ?? singleQuoted ?? bare;
    return ref === undefined ? [] : [ref];
  });
}

export function usesIn(text: string): Use[] {
  const uses: Use[] = [];
  let scalarIndent: number | null = null;
  for (const [index, line] of text.split("\n").entries()) {
    if (scalarIndent !== null) {
      if (line.trim() === "" || indentOf(line) > scalarIndent) continue;
      scalarIndent = null;
    }
    const content = line.trimStart();
    if (content === "" || content.startsWith(COMMENT)) continue;
    if (BLOCK_SCALAR.test(line)) {
      scalarIndent = keyIndentOf(line);
      continue;
    }
    uses.push(...usesOn(line).map((ref) => ({ line: index + 1, ref })));
  }
  return uses;
}
