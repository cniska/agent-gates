import { basename } from "node:path/posix";
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

const PREDECLARED_TYPES = new Set([
  "any",
  "bool",
  "byte",
  "comparable",
  "complex64",
  "complex128",
  "error",
  "float32",
  "float64",
  "int",
  "int8",
  "int16",
  "int32",
  "int64",
  "rune",
  "string",
  "uint",
  "uint8",
  "uint16",
  "uint32",
  "uint64",
  "uintptr",
]);

const EXPORTED = /^\p{Lu}/u;

const EXAMPLE = /^Example(?!\p{Ll})/u;

const EXAMPLE_OUTPUT = /^\s*(unordered )?output:/i;

const IMPORT_C = '"C"';

const EXPORT_PREFIX = "//export ";

const C_LINE_COMMENT = "//";

const MAIN_PACKAGES = new Set(["main", "main_test"]);

const LIBRARY_EXCLUDED_PACKAGE = "main";

const TEST_SUFFIX = "_test.go";

const TESTDATA = "testdata";

const PACKAGE = "package";

const NO_LEAD = /^/;

const TOOLCHAIN_NAMES = [
  "build",
  "generate",
  "embed",
  "linkname",
  "noinline",
  "nosplit",
  "noescape",
  "norace",
  "nocheckptr",
  "uintptrescapes",
  "uintptrkeepalive",
  "wasmimport",
  "wasmexport",
  "debug",
  "fix",
] as const;

const TOOLCHAIN = new RegExp(`go:(?:${TOOLCHAIN_NAMES.join("|")})`);

const LINTER = "(?!all(?![\\w-]))[\\w-]+";

const NOLINT = new RegExp(`nolint:${LINTER}(?:,${LINTER})*(?![\\w,-])`);

const STATICCHECK_IGNORE = /lint:(?:file-)?ignore[ \t]+[\w*]+(?:,[\w*]+)*[ \t]+\S.*/;

const PLUS_BUILD = /[ \t]*\+build/;

const LINE_DIRECTIVE = /line .*:\d+(?::\d+)?/;

const GENERATED = / Code generated .* DO NOT EDIT\./;

const WANT = /^\s*want(?:\s|$)/;

const GO_DIRECTIVE = /^(?:line |extern |export |[a-z0-9]+:[a-z0-9])/;

const ANY_NOLINT = /^\s*nolint(?![\w-])/;

type CodeKind = "word" | "string" | "rune" | "number" | "punct";

type Token =
  | {
      readonly kind: "comment";
      readonly start: number;
      readonly end: number;
      readonly style: "line" | "block";
    }
  | { readonly kind: "semicolon"; readonly start: number; readonly end: number; readonly explicit: boolean }
  | { readonly kind: CodeKind; readonly start: number; readonly end: number };

type CodeToken = Exclude<Token, { readonly kind: "comment" }>;

type Tokenized = { readonly kind: "tokenized"; readonly tokens: readonly Token[] } | Stopped;

type Documents =
  | { readonly kind: "none" }
  | { readonly kind: "var" }
  | { readonly kind: "func"; readonly name: string; readonly example: boolean }
  | { readonly kind: "import-c" };

type GoSpan = Span & {
  readonly shown: boolean;
  readonly beforePackage: boolean;
  readonly documents: Documents;
  readonly exampleOutput: boolean;
};

type Facts = { readonly packageName: string | null; readonly importsC: boolean };

type Placement = { readonly test: boolean; readonly testdata: boolean };

type Filter = "exported" | "none";

type Group = number;

type Coded = { readonly token: CodeToken; readonly lead: Group | null; readonly trail: Group | null };

type MemberFound = { readonly kept: boolean; readonly doc: boolean };

type Grouped = {
  readonly groups: readonly (readonly number[])[];
  readonly groupOf: ReadonlyMap<number, Group>;
  readonly code: readonly Coded[];
};

type SpecFound = { readonly exported: boolean; readonly importsC: boolean; readonly doc: Group | null };

const NOT_DOCUMENTING: Documents = { kind: "none" };

function tokensOf(text: string): Tokenized {
  const tokens: Token[] = [];
  let at = textStart(text);
  let endsStatement = false;

  const charAt = (index: number): string => {
    const code = text.codePointAt(index);
    return code === undefined ? "" : String.fromCodePoint(code);
  };

  function semicolon(start: number): void {
    tokens.push({ kind: "semicolon", start, end: start, explicit: false });
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
      tokens.push({ kind: "semicolon", start, end: at, explicit: true });
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
  const groups: number[][] = [];
  const groupOf = new Map<number, Group>();
  const codeTokens: CodeToken[] = [];
  const lead: (Group | null)[] = [];
  const trail: (Group | null)[] = [];

  const isComment = (index: number) => tokens[index]?.kind === "comment";
  const lineOf = (index: number) => lines[index] ?? endOfFileLine;
  const endLineOf = (index: number): number => {
    const token = tokens[index];
    if (token?.kind !== "comment" || token.style === "line") return lineOf(index);
    return lineOf(index) + (text.slice(token.start, token.end).match(/\n/g)?.length ?? 0);
  };

  let next = 0;
  function consumeGroup(gap: number): { readonly group: Group; readonly endLine: number } {
    const members: number[] = [];
    const group = groups.length;
    let endLine = lineOf(next);
    while (isComment(next) && lineOf(next) <= endLine + gap) {
      members.push(next);
      groupOf.set(next, group);
      endLine = endLineOf(next);
      next++;
    }
    groups.push(members);
    return { group, endLine };
  }

  let previousLine = 0;
  for (;;) {
    let leadGroup: Group | null = null;
    let trailGroup: Group | null = null;
    if (isComment(next)) {
      if (lineOf(next) === previousLine) {
        const { group, endLine } = consumeGroup(0);
        if (lineOf(next) !== endLine || tokens[next]?.kind === "semicolon" || next === tokens.length)
          trailGroup = group;
      }
      let endLine = -1;
      let last: Group | null = null;
      while (isComment(next)) ({ group: last, endLine } = consumeGroup(1));
      if (endLine + 1 === lineOf(next)) leadGroup = last;
    }
    lead.push(leadGroup);
    trail.push(trailGroup);
    const token = tokens[next];
    if (token === undefined || token.kind === "comment") break;
    codeTokens.push(token);
    previousLine = lineOf(next);
    next++;
  }
  const code = codeTokens.map((token, index): Coded => {
    const ending = token.kind === "semicolon" ? (token.explicit ? trail[index + 1] : trail[index]) : null;
    return { token, lead: lead[index] ?? null, trail: ending ?? null };
  });
  return { groups, groupOf, code };
}

function targetSpans(text: string, tokens: readonly Token[]): Lexed<GoSpan, Facts> {
  const { groups, groupOf, code } = commentGroups(text, tokens);
  const shown = new Set<Group>();
  const documents = new Map<Group, Documents>();
  const outputs = new Set<Group>();
  let packageName: string | null = null;
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
  const isExported = (name: string | null) => name !== null && EXPORTED.test(name);
  const keeps = (filter: Filter, exported: boolean) => filter === "exported" && exported;

  function show(group: Group | null): void {
    if (group !== null) shown.add(group);
  }

  function skipBalanced(): void {
    let depth = 0;
    while (at < code.length) {
      if (isOpener(at)) depth++;
      else if (isCloser(at)) depth--;
      at++;
      if (depth <= 0) return;
    }
  }

  function skipToItemEnd(): void {
    while (at < code.length && !isSemicolon(at) && !isCloser(at)) {
      if (isOpener(at)) skipBalanced();
      else at++;
    }
  }

  function itemEnd(): Group | null {
    const ending = code[at];
    if (ending?.token.kind !== "semicolon") return null;
    at++;
    return ending.trail;
  }

  function qualifiedName(): string | null {
    let name = nameAt(at);
    if (name === null) return null;
    at++;
    if (isPunct(at, ".")) {
      name = nameAt(at + 1);
      at += 2;
    }
    if (isPunct(at, "[")) skipBalanced();
    return name;
  }

  function parameters(filter: Filter): void {
    at++;
    while (at < code.length && !isPunct(at, ")")) {
      const before = at;
      const startsType = !isPunct(at + 1, ",") && !isPunct(at + 1, ")") && !isPunct(at + 1, ".");
      if (nameAt(at) !== null && startsType) at++;
      if (isPunct(at, "...")) at++;
      type(filter);
      if (isPunct(at, ",")) at++;
      if (at === before) at++;
    }
    at++;
  }

  function result(filter: Filter): void {
    if (isPunct(at, "(")) parameters(filter);
    else type(filter);
  }

  function signature(filter: Filter): void {
    if (isPunct(at, "(")) parameters(filter);
    result(filter);
  }

  function type(filter: Filter): void {
    const word = wordAt(at);
    if (word === "struct" || word === "interface") {
      at++;
      if (isPunct(at, "{")) members(filter, word === "struct" ? field : element);
      return;
    }
    if (word === "map") {
      at++;
      if (isPunct(at, "[")) {
        at++;
        type(filter);
        if (isPunct(at, "]")) at++;
      }
      type(filter);
      return;
    }
    if (word === "chan" || isPunct(at, "<-")) {
      at++;
      if (isPunct(at, "<-") || wordAt(at) === "chan") at++;
      type(filter);
      return;
    }
    if (word === "func") {
      at++;
      signature(filter);
      return;
    }
    if (isPunct(at, "*") || isPunct(at, "~")) {
      at++;
      type(filter);
      return;
    }
    if (isPunct(at, "(")) {
      at++;
      type(filter);
      if (isPunct(at, ")")) at++;
      return;
    }
    if (isPunct(at, "[")) {
      skipBalanced();
      type(filter);
      return;
    }
    if (nameAt(at) !== null) qualifiedName();
  }

  function members(filter: Filter, member: (filter: Filter) => MemberFound) {
    at++;
    while (at < code.length && !isPunct(at, "}")) {
      const before = at;
      if (isSemicolon(at)) {
        at++;
        continue;
      }
      const doc = leadAt(at);
      const found = member(filter);
      skipToItemEnd();
      const comment = itemEnd();
      if (found.kept) {
        if (found.doc) show(doc);
        show(comment);
      }
      if (at === before) at++;
    }
    at++;
  }

  function field(filter: Filter): MemberFound {
    const first = nameAt(at);
    if (isPunct(at, "*")) {
      at++;
      return { kept: keeps(filter, isExported(qualifiedName())), doc: true };
    }
    if (first === null) return { kept: false, doc: true };
    const embeddedEnd = (index: number) => isString(index) || isSemicolon(index) || isPunct(index, "}");
    if (isPunct(at + 1, ".") || embeddedEnd(at + 1))
      return { kept: keeps(filter, isExported(qualifiedName())), doc: true };
    at++;
    if (isPunct(at, "[")) {
      skipBalanced();
      const kept = keeps(filter, isExported(first));
      if (!embeddedEnd(at)) type(kept ? filter : "none");
      return { kept, doc: true };
    }
    const names: (string | null)[] = [first];
    while (isPunct(at, ",")) {
      names.push(nameAt(at + 1));
      at += 2;
    }
    const kept = keeps(filter, names.some(isExported));
    type(kept ? filter : "none");
    return { kept, doc: true };
  }

  function element(filter: Filter): MemberFound {
    const name = nameAt(at);
    if (name !== null && isPunct(at + 1, "(")) {
      at++;
      const kept = keeps(filter, isExported(name));
      signature(kept ? filter : "none");
      return { kept, doc: true };
    }
    const qualified = name !== null && isPunct(at + 1, ".");
    const base = qualified ? nameAt(at + 2) : name;
    type(filter);
    let union = false;
    while (isPunct(at, "|")) {
      union = true;
      at++;
      type(filter);
    }
    const named = base !== null && !union;
    const exported = isExported(base) || (!qualified && base !== null && PREDECLARED_TYPES.has(base));
    return { kept: keeps(filter, !named || exported), doc: name !== null };
  }

  function spec(keyword: string, doc: Group | null): SpecFound {
    if (keyword === "import") {
      if (wordAt(at) !== null || isPunct(at, ".")) at++;
      const path = isString(at) ? textOf(at) : "";
      skipToItemEnd();
      itemEnd();
      return { exported: false, importsC: path === IMPORT_C, doc };
    }
    const names: (string | null)[] = [];
    if (keyword === "type") {
      names.push(nameAt(at));
      at++;
      if (isPunct(at, "[")) skipBalanced();
      if (isPunct(at, "=")) at++;
    } else {
      names.push(nameAt(at));
      at++;
      while (isPunct(at, ",")) {
        names.push(nameAt(at + 1));
        at += 2;
      }
    }
    const exported = names.some(isExported);
    if (!isPunct(at, "=") && !isSemicolon(at) && !isCloser(at)) type(exported ? "exported" : "none");
    skipToItemEnd();
    const comment = itemEnd();
    if (exported) {
      show(doc);
      show(comment);
    }
    return { exported, importsC: false, doc };
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
      itemEnd();
    } else specs.push(spec(keyword, null));
    if (specs.some(({ exported }) => exported)) show(doc);
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

  function receiverBase(): string | null {
    let base: string | null = null;
    let brackets = 0;
    const open = at;
    skipBalanced();
    for (let index = open + 1; index < at - 1; index++) {
      if (isPunct(index, "[")) brackets++;
      else if (isPunct(index, "]")) brackets--;
      else if (brackets === 0 && nameAt(index) !== null) base = nameAt(index);
    }
    return base;
  }

  function groupStart(group: Group): number {
    return tokens[groups[group]?.[0] ?? -1]?.start ?? text.length;
  }

  function lastGroupWithin(open: number, close: number): Group | null {
    let low = 0;
    let high = groups.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (groupStart(middle) < close) low = middle + 1;
      else high = middle;
    }
    const last = low - 1;
    return last >= 0 && groupStart(last) > open ? last : null;
  }

  function groupText(group: Group): string {
    return (groups[group] ?? [])
      .map((member) => {
        const token = tokens[member];
        if (token?.kind !== "comment") return "";
        const end = token.style === "block" ? token.end - CLOSER : token.end;
        return text.slice(token.start + OPENER, end);
      })
      .join("\n");
  }

  function funcDecl(): void {
    const doc = leadAt(at);
    at++;
    const method = isPunct(at, "(");
    const base = method ? receiverBase() : null;
    const name = nameAt(at);
    at++;
    if (isPunct(at, "[")) skipBalanced();
    const noParameters = isPunct(at, "(") && isPunct(at + 1, ")");
    if (isPunct(at, "(")) parameters("none");
    const noResults = isPunct(at, "{") || isSemicolon(at);
    if (!noResults) result("none");
    let body: { readonly open: number; readonly close: number } | null = null;
    if (isPunct(at, "{")) {
      const open = tokenAt(at)?.start ?? text.length;
      skipBalanced();
      body = { open, close: tokenAt(at - 1)?.start ?? text.length };
    }
    skipToItemEnd();
    itemEnd();
    if (isExported(name) && (!method || isExported(base))) show(doc);
    if (method || name === null) return;
    const example = EXAMPLE.test(name) && noParameters && noResults && body !== null;
    if (doc !== null) documents.set(doc, { kind: "func", name, example });
    if (!example || body === null) return;
    const output = lastGroupWithin(body.open, body.close);
    if (output !== null && EXAMPLE_OUTPUT.test(groupText(output))) outputs.add(output);
  }

  if (wordAt(at) === PACKAGE) {
    packageStart = tokenAt(at)?.start ?? null;
    show(leadAt(at));
    at++;
    packageName = nameAt(at);
    skipToItemEnd();
    itemEnd();
    while (at < code.length) {
      const word = wordAt(at);
      if (word === "import" || word === "var" || word === "const" || word === "type") genDecl(word);
      else if (word === "func") funcDecl();
      else if (isOpener(at)) skipBalanced();
      else at++;
    }
  }

  const spans = tokens.flatMap((token, index): GoSpan[] => {
    if (token.kind !== "comment") return [];
    const group = groupOf.get(index);
    invariant(group !== undefined, "commentGroups puts every comment in a group");
    const bodyEnd = token.style === "block" ? token.end - CLOSER : token.end;
    const directive = token.style === "line" && GO_DIRECTIVE.test(text.slice(token.start + OPENER, bodyEnd));
    return [
      {
        start: token.start,
        end: token.end,
        bodyStart: token.start + OPENER,
        bodyEnd,
        style: token.style,
        shown: shown.has(group) && !directive,
        beforePackage: packageStart !== null && token.start < packageStart,
        documents: documents.get(group) ?? NOT_DOCUMENTING,
        exampleOutput: outputs.has(group),
      },
    ];
  });
  return { kind: "lexed", spans, facts: { packageName, importsC } };
}

function commentSpans(text: string): Lexed<GoSpan, Facts> {
  const tokenized = tokensOf(text);
  if (tokenized.kind === "stopped") return tokenized;
  return targetSpans(text, tokenized.tokens);
}

function placementOf(path: string): Placement {
  return { test: basename(path).endsWith(TEST_SUFFIX), testdata: path.split("/").includes(TESTDATA) };
}

type GoRead = CommentRead<GoSpan, Placement, Facts>;

function isLine({ span }: GoRead): boolean {
  return span.style === "line";
}

function atLineStart(read: GoRead): boolean {
  return isLine(read) && read.column === 0;
}

function isLibrary({ file }: GoRead): boolean {
  const { packageName } = file.facts;
  return !file.context.test && packageName !== null && packageName !== LIBRARY_EXCLUDED_PACKAGE;
}

function toolchainPlaced(read: GoRead): boolean {
  if (!atLineStart(read)) return false;
  if (read.directive.startsWith("go:build")) return read.span.beforePackage;
  if (read.directive.startsWith("go:embed")) return read.span.documents.kind === "var";
  return true;
}

function isNolint(read: GoRead): boolean {
  return isLine(read) && ANY_NOLINT.test(read.body);
}

function startsCComment(line: string): boolean {
  return line.trimStart().startsWith(C_LINE_COMMENT);
}

const KEPT: readonly KeptForm<GoRead>[] = [
  {
    shown:
      "in library code, a doc or trailing comment `go doc` shows: on the package, or on an exported name, its fields and its methods",
    keeps: (read) => read.span.shown && isLibrary(read) && !isNolint(read),
  },
  directive(
    `\`//go:\` directives at column 1 (${TOOLCHAIN_NAMES.map((name) => `\`${name}\``).join(", ")}), with \`//go:build\` only before \`package\` and \`//go:embed\` only above a \`var\``,
    { pattern: TOOLCHAIN, reason: "allowed", where: toolchainPlaced },
  ),
  directive("`// +build` before `package`", {
    pattern: PLUS_BUILD,
    reason: "allowed",
    where: (read) => isLine(read) && read.span.beforePackage,
  }),
  directive("`//line file:N` at column 1, and `/*line file:N*/`", {
    pattern: LINE_DIRECTIVE,
    reason: "alone",
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
    shown: 'the cgo preamble above `import "C"`, but no line of it that starts a C `//` comment',
    keeps: ({ span, body }) => span.documents.kind === "import-c" && !body.split("\n").some(startsCComment),
  },
  directive("`//nolint:` naming linters, never `all`", { pattern: NOLINT, reason: "allowed", where: isLine }),
  directive("`//lint:ignore` and `//lint:file-ignore` naming checks, with a reason", {
    pattern: STATICCHECK_IGNORE,
    reason: "alone",
    where: isLine,
  }),
  directive("`// Code generated … DO NOT EDIT.` before `package`", {
    pattern: GENERATED,
    reason: "alone",
    where: (read) => isLine(read) && read.span.beforePackage,
  }),
  {
    shown:
      "in a `_test.go` file outside packages `main` and `main_test`, an `Example` func's doc and its closing `// Output:` comment",
    keeps: ({ span, file }) =>
      file.context.test &&
      file.facts.packageName !== null &&
      !MAIN_PACKAGES.has(file.facts.packageName) &&
      ((span.documents.kind === "func" && span.documents.example) || span.exampleOutput),
  },
  {
    shown: "`// want` in a file under `testdata`",
    keeps: ({ body, file }) => file.context.testdata && WANT.test(body),
  },
];

export const { comments, kept } = adapter({
  contextOf: (path) => placementOf(path),
  lex: commentSpans,
  directiveLead: NO_LEAD,
  kept: KEPT,
});
