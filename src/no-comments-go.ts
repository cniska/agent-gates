import { invariant } from "./assert";
import {
  adapter,
  type CommentRead,
  directive,
  type KeptForm,
  type Lexed,
  type Span,
} from "./no-comments-adapter";
import { lineCounter, lineEnd, type Stopped, textStart, unterminated } from "./no-comments-spans";

const OPENER = 2;

const CLOSER = 2;

const IDENTIFIER_START = /^[\p{L}_]$/u;

const IDENTIFIER_CONTINUE = /^[\p{L}\p{Nd}_]$/u;

const DIGIT = /^[0-9]$/;

const NUMBER_CHAR = /^[0-9A-Za-z_.]$/;

const HEX_PREFIX = /^0[xX]/;

const DECIMAL_EXPONENT = /^[eEpP]$/;

const HEX_EXPONENT = /^[pP]$/;

const WHITESPACE = new Set([" ", "\t", "\r"]);

const OPERATORS = ["...", "<-", "++", "--", "&&", "||", "&^"] as const;

const ENDS_STATEMENT_PUNCT = new Set([")", "]", "}", "++", "--"]);

const ENDS_STATEMENT_KEYWORDS = new Set(["break", "continue", "fallthrough", "return"]);

const KEYWORDS = new Set([
  "break",
  "case",
  "chan",
  "const",
  "continue",
  "default",
  "defer",
  "else",
  "fallthrough",
  "for",
  "func",
  "go",
  "goto",
  "if",
  "import",
  "interface",
  "map",
  "package",
  "range",
  "return",
  "select",
  "struct",
  "switch",
  "type",
  "var",
]);

const OPENERS = new Set(["(", "[", "{"]);

const CLOSERS = new Set([")", "]", "}"]);

const IMPORT_C = '"C"';

const EXPORT_PREFIX = "//export ";

const PACKAGE = "package";

const ARGUMENT = "[ \\t]+\\S+";

const FLAG_PRAGMAS = [
  "noinline",
  "nosplit",
  "noescape",
  "norace",
  "nocheckptr",
  "uintptrescapes",
  "uintptrkeepalive",
] as const;

type Pragma = { readonly name: string; readonly arguments: string };

const ARGUMENT_PRAGMAS: readonly Pragma[] = [
  { name: "generate", arguments: "[ \\t]\\S.*" },
  { name: "linkname", arguments: `${ARGUMENT}(?:${ARGUMENT})?` },
  { name: "wasmimport", arguments: `${ARGUMENT}${ARGUMENT}` },
  { name: "wasmexport", arguments: ARGUMENT },
  { name: "fix", arguments: "[ \\t]+inline" },
];

const HEADER_PRAGMAS: readonly Pragma[] = [
  { name: "build", arguments: "[ \\t]+(?:[A-Za-z0-9_.]+|!|&&|\\|\\||\\(|\\)|[ \\t])+" },
  { name: "debug", arguments: "[ \\t]+[\\w.]+=\\S+" },
];

function pragmaPattern(pragmas: readonly Pragma[], flags: readonly string[] = []): RegExp {
  return new RegExp(
    `go:(?:${[...flags, ...pragmas.map(({ name, arguments: shape }) => name + shape)].join("|")})`,
  );
}

function pragmaNames(names: readonly string[]): string {
  const shown = names.map((name) => `\`//go:${name}\``);
  return shown.length < 2 ? shown.join("") : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

const EMBED = /go:embed(?:[ \t]+(?:"(?:[^"\\]|\\.)*"|`[^`]*`|[^ \t"`]+))+/;

const LINE_DIRECTIVE = /line \S*:\d+(?::\d+)?/;

const C_LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;

const C_COMMENT = /\/\/|\/\*/;

const C_PROSE_DIRECTIVE = /^[ \t]*#[ \t]*(?:(?:el)?if[ \t]+0\b|error\b|warning\b|pragma[ \t]+message\b)/m;

type CodeKind = "word" | "string" | "rune" | "number" | "punct";

type Token =
  | {
      readonly kind: "comment";
      readonly start: number;
      readonly end: number;
      readonly style: "line" | "block";
    }
  | { readonly kind: "semicolon"; readonly start: number; readonly end: number }
  | { readonly kind: CodeKind; readonly start: number; readonly end: number };

type CodeToken = Exclude<Token, { readonly kind: "comment" }>;

type Tokenized = { readonly kind: "tokenized"; readonly tokens: readonly Token[] } | Stopped;

type Documents =
  | { readonly kind: "none" }
  | { readonly kind: "var" }
  | { readonly kind: "func"; readonly name: string }
  | { readonly kind: "import-c" };

type GoSpan = Span & { readonly beforePackage: boolean; readonly documents: Documents };

type Facts = { readonly importsC: boolean };

type Group = number;

type Coded = { readonly token: CodeToken; readonly lead: Group | null };

type Grouped = { readonly groupOf: ReadonlyMap<number, Group>; readonly code: readonly Coded[] };

type SpecFound = { readonly importsC: boolean; readonly doc: Group | null };

const NOT_DOCUMENTING: Documents = { kind: "none" };

type CommentToken = Extract<Token, { readonly kind: "comment" }>;

function bodyEnd(token: CommentToken): number {
  return token.style === "block" ? token.end - CLOSER : token.end;
}

function bodyOf(text: string, token: CommentToken): string {
  return text.slice(token.start + OPENER, bodyEnd(token));
}

function tokensOf(text: string): Tokenized {
  const tokens: Token[] = [];
  let at = textStart(text);
  let endsStatement = false;

  const charAt = (index: number): string => {
    const code = text.codePointAt(index);
    return code === undefined ? "" : String.fromCodePoint(code);
  };

  function semicolon(start: number): void {
    tokens.push({ kind: "semicolon", start, end: start });
    endsStatement = false;
  }

  function code(kind: CodeKind, start: number, ends: boolean): void {
    tokens.push({ kind, start, end: at });
    endsStatement = ends;
  }

  function quoted(close: string, construct: string): Stopped | null {
    const start = at;
    at++;
    while (at < text.length) {
      const char = text[at];
      if (char === "\n") break;
      at++;
      if (char === close) return null;
      if (char === "\\" && text[at] !== "\n") at++;
    }
    return unterminated(start, construct);
  }

  function raw(): Stopped | null {
    const end = text.indexOf("`", at + 1);
    if (end < 0) return unterminated(at, "raw string");
    at = end + 1;
    return null;
  }

  function number(): void {
    const exponents = HEX_PREFIX.test(text.slice(at, at + 2)) ? HEX_EXPONENT : DECIMAL_EXPONENT;
    while (at < text.length) {
      const char = text[at] ?? "";
      const sign = (char === "+" || char === "-") && exponents.test(text[at - 1] ?? "");
      if (!NUMBER_CHAR.test(char) && !sign) return;
      at++;
    }
  }

  while (at < text.length) {
    const start = at;
    const char = charAt(at);
    if (WHITESPACE.has(char)) {
      at++;
      continue;
    }
    if (char === "\n") {
      if (endsStatement) semicolon(at);
      at++;
      continue;
    }
    if (text.startsWith("//", at)) {
      at = lineEnd(text, at);
      tokens.push({ kind: "comment", start, end: at, style: "line" });
      continue;
    }
    if (text.startsWith("/*", at)) {
      const close = text.indexOf("*/", at + OPENER);
      if (close < 0) return unterminated(at, "comment");
      at = close + CLOSER;
      tokens.push({ kind: "comment", start, end: at, style: "block" });
      const newline = text.indexOf("\n", start);
      if (endsStatement && newline >= 0 && newline < at) semicolon(newline);
      continue;
    }
    if (char === '"' || char === "'") {
      const stopped = quoted(char, char === '"' ? "string" : "rune");
      if (stopped !== null) return stopped;
      code(char === '"' ? "string" : "rune", start, true);
      continue;
    }
    if (char === "`") {
      const stopped = raw();
      if (stopped !== null) return stopped;
      code("string", start, true);
      continue;
    }
    if (DIGIT.test(char) || (char === "." && DIGIT.test(text[at + 1] ?? ""))) {
      number();
      code("number", start, true);
      continue;
    }
    if (IDENTIFIER_START.test(char)) {
      while (IDENTIFIER_CONTINUE.test(charAt(at))) at += charAt(at).length;
      const word = text.slice(start, at);
      code("word", start, !KEYWORDS.has(word) || ENDS_STATEMENT_KEYWORDS.has(word));
      continue;
    }
    if (char === ";") {
      at++;
      tokens.push({ kind: "semicolon", start, end: at });
      endsStatement = false;
      continue;
    }
    const operator = OPERATORS.find((candidate) => text.startsWith(candidate, at)) ?? char;
    at += operator.length;
    code("punct", start, ENDS_STATEMENT_PUNCT.has(operator));
  }
  if (endsStatement) semicolon(text.length);
  return { kind: "tokenized", tokens };
}

function commentGroups(text: string, tokens: readonly Token[]): Grouped {
  const lineAt = lineCounter(text);
  const lines = tokens.map(({ start }) => lineAt(start));
  const endOfFileLine = lineAt(text.length);
  const groupOf = new Map<number, Group>();
  const code: Coded[] = [];
  let groups = 0;

  const isComment = (index: number) => tokens[index]?.kind === "comment";
  const lineOf = (index: number) => lines[index] ?? endOfFileLine;
  const endLineOf = (index: number): number => {
    const token = tokens[index];
    if (token?.kind !== "comment" || token.style === "line") return lineOf(index);
    return lineOf(index) + (text.slice(token.start, token.end).match(/\n/g)?.length ?? 0);
  };

  let next = 0;
  function consumeGroup(gap: number): { readonly group: Group; readonly endLine: number } {
    const group = groups++;
    let endLine = lineOf(next);
    while (isComment(next) && lineOf(next) <= endLine + gap) {
      groupOf.set(next, group);
      endLine = endLineOf(next);
      next++;
    }
    return { group, endLine };
  }

  let previousLine = 0;
  for (;;) {
    let lead: Group | null = null;
    if (isComment(next)) {
      if (lineOf(next) === previousLine) consumeGroup(0);
      let endLine = -1;
      let last: Group | null = null;
      while (isComment(next)) ({ group: last, endLine } = consumeGroup(1));
      if (endLine + 1 === lineOf(next)) lead = last;
    }
    const token = tokens[next];
    if (token === undefined || token.kind === "comment") break;
    code.push({ token, lead });
    previousLine = lineOf(next);
    next++;
  }
  return { groupOf, code };
}

function targetSpans(text: string, tokens: readonly Token[]): Lexed<GoSpan, Facts> {
  const { groupOf, code } = commentGroups(text, tokens);
  const documents = new Map<Group, Documents>();
  let packageStart: number | null = null;
  let importsC = false;
  let at = 0;

  const tokenAt = (index: number): CodeToken | undefined => code[index]?.token;
  const leadAt = (index: number): Group | null => code[index]?.lead ?? null;
  const textOf = (index: number): string => {
    const token = tokenAt(index);
    return token === undefined ? "" : text.slice(token.start, token.end);
  };
  const wordAt = (index: number): string | null => (tokenAt(index)?.kind === "word" ? textOf(index) : null);
  const nameAt = (index: number): string | null => {
    const word = wordAt(index);
    return word === null || KEYWORDS.has(word) ? null : word;
  };
  const isPunct = (index: number, punct: string) =>
    tokenAt(index)?.kind === "punct" && textOf(index) === punct;
  const isSemicolon = (index: number) => tokenAt(index)?.kind === "semicolon";
  const isString = (index: number) => tokenAt(index)?.kind === "string";
  const isOpener = (index: number) => tokenAt(index)?.kind === "punct" && OPENERS.has(textOf(index));
  const isCloser = (index: number) => tokenAt(index)?.kind === "punct" && CLOSERS.has(textOf(index));

  function skipBalanced(): void {
    let depth = 0;
    while (at < code.length) {
      if (isOpener(at)) depth++;
      else if (isCloser(at)) depth--;
      at++;
      if (depth <= 0) return;
    }
  }

  function skipItem(): void {
    while (at < code.length && !isSemicolon(at) && !isCloser(at)) {
      if (isOpener(at)) skipBalanced();
      else at++;
    }
    if (isSemicolon(at)) at++;
  }

  function spec(keyword: string, doc: Group | null): SpecFound {
    if (keyword === "import" && (nameAt(at) !== null || isPunct(at, "."))) at++;
    const importsC = keyword === "import" && isString(at) && textOf(at) === IMPORT_C;
    skipItem();
    return { importsC, doc };
  }

  function genDecl(keyword: string): void {
    const doc = leadAt(at);
    at++;
    const specs: SpecFound[] = [];
    if (isPunct(at, "(")) {
      at++;
      while (at < code.length && !isPunct(at, ")")) {
        const before = at;
        if (isSemicolon(at)) at++;
        else specs.push(spec(keyword, leadAt(at)));
        if (at === before) at++;
      }
      at++;
      if (isSemicolon(at)) at++;
    } else specs.push(spec(keyword, null));
    if (keyword === "var")
      for (const group of [doc, ...specs.map((found) => found.doc)])
        if (group !== null) documents.set(group, { kind: "var" });
    for (const found of specs) {
      if (!found.importsC) continue;
      importsC = true;
      const preamble = found.doc ?? (specs.length === 1 ? doc : null);
      if (preamble !== null) documents.set(preamble, { kind: "import-c" });
    }
  }

  function funcDecl(): void {
    const doc = leadAt(at);
    at++;
    const method = isPunct(at, "(");
    if (method) skipBalanced();
    const name = nameAt(at);
    skipItem();
    if (!method && name !== null && doc !== null) documents.set(doc, { kind: "func", name });
  }

  if (wordAt(at) === PACKAGE) {
    packageStart = tokenAt(at)?.start ?? null;
    skipItem();
    while (at < code.length) {
      const word = wordAt(at);
      if (word === "import" || word === "var") genDecl(word);
      else if (word === "func") funcDecl();
      else if (isOpener(at)) skipBalanced();
      else at++;
    }
  }

  const proseGroups = new Set<Group>();
  for (const [index, token] of tokens.entries()) {
    const group = groupOf.get(index);
    if (token.kind === "comment" && group !== undefined && C_PROSE_DIRECTIVE.test(bodyOf(text, token)))
      proseGroups.add(group);
  }

  const spans = tokens.flatMap((token, index): GoSpan[] => {
    if (token.kind !== "comment") return [];
    const group = groupOf.get(index);
    invariant(group !== undefined, "commentGroups puts every comment in a group");
    const documented = documents.get(group) ?? NOT_DOCUMENTING;
    return [
      {
        start: token.start,
        end: token.end,
        bodyStart: token.start + OPENER,
        bodyEnd: bodyEnd(token),
        style: token.style,
        beforePackage: packageStart !== null && token.start < packageStart,
        documents: documented.kind === "import-c" && proseGroups.has(group) ? NOT_DOCUMENTING : documented,
      },
    ];
  });
  return { kind: "lexed", spans, facts: { importsC } };
}

function commentSpans(text: string): Lexed<GoSpan, Facts> {
  const tokenized = tokensOf(text);
  if (tokenized.kind === "stopped") return tokenized;
  return targetSpans(text, tokenized.tokens);
}

type GoRead = CommentRead<GoSpan, Facts>;

function isLine({ span }: GoRead): boolean {
  return span.style === "line";
}

function atLineStart(read: GoRead): boolean {
  return isLine(read) && read.column === 0;
}

function holdsNoCComment(body: string): boolean {
  return !body.split("\n").some((line) => C_COMMENT.test(line.replace(C_LITERAL, "")));
}

const KEPT: readonly KeptForm<GoRead>[] = [
  directive(
    `${pragmaNames(HEADER_PRAGMAS.map(({ name }) => name))} with their argument, before \`package\``,
    {
      pattern: pragmaPattern(HEADER_PRAGMAS),
      where: (read) => atLineStart(read) && read.span.beforePackage,
    },
  ),
  directive("`//go:embed` with its patterns, above a `var`", {
    pattern: EMBED,
    where: (read) => isLine(read) && read.span.documents.kind === "var",
  }),
  directive(
    `${pragmaNames(ARGUMENT_PRAGMAS.map(({ name }) => name))} with their arguments, and ${pragmaNames(FLAG_PRAGMAS)} alone, at column 1`,
    { pattern: pragmaPattern(ARGUMENT_PRAGMAS, FLAG_PRAGMAS), where: atLineStart },
  ),
  directive("`//line file:N` at column 1, and `/*line file:N*/`", {
    pattern: LINE_DIRECTIVE,
    where: (read) => atLineStart(read) || read.span.style === "block",
  }),
  {
    shown: '`//export Name` above the top-level func `Name`, in a file that imports `"C"`',
    keeps: ({ span, text, file }) =>
      span.style === "line" &&
      file.facts.importsC &&
      span.documents.kind === "func" &&
      text.startsWith(EXPORT_PREFIX) &&
      text.slice(EXPORT_PREFIX.length).trim() === span.documents.name,
  },
  {
    shown:
      'the cgo preamble above `import "C"`, holding no C comment, `#if 0`, `#error`, `#warning` or `#pragma message`',
    keeps: ({ span, body }) => span.documents.kind === "import-c" && holdsNoCComment(body),
  },
];

export const { comments, kept } = adapter({
  lex: commentSpans,
  kept: KEPT,
});
