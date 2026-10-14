import { type ParserPlugin, parse } from "@babel/parser";
import { invariant } from "./assert";
import {
  adapter,
  type CommentRead,
  directive,
  type KeptForm,
  type LeadingSpan,
  type Lexed,
  SHEBANG,
} from "./no-comments-adapter";
import { interpreterOf, routeOf, SHEBANG_PREFIX } from "./no-comments-route";
import type { Stopped } from "./no-comments-spans";

type Dialect = { readonly syntax: ParserPlugin[] };

type Read = CommentRead<LeadingSpan>;

const REFERENCE_VALUE = `\\s*=\\s*(?:'[^']*'|"[^"]*")`;

const TRIPLE_SLASH_REFERENCE = new RegExp(
  `\\/\\s*<reference\\s+(?:types|lib|path|no-default-lib)${REFERENCE_VALUE}(?:\\s+(?:resolution-mode|preserve)${REFERENCE_VALUE})*\\s*\\/>`,
);

const PLAIN_JAVASCRIPT = [".js", ".jsx", ".mjs", ".cjs"];

const PLAIN_INTERPRETERS = ["node"];

const OPENER = 2;

const BABEL_POSITION = /\.? \(\d+:\d+\)$/;

const STAGE_THREE_DECORATORS: ParserPlugin[] = [["decorators", {}], "decoratorAutoAccessors"];

const LEGACY_DECORATORS: ParserPlugin[] = ["decorators-legacy", "decoratorAutoAccessors"];

function dialectOf(path: string, text: string): Dialect {
  const route = routeOf(path);
  if (route.kind === "first-line") {
    const interpreter = interpreterOf(text);
    return interpreter !== null && PLAIN_INTERPRETERS.includes(interpreter)
      ? { syntax: ["jsx"] }
      : { syntax: ["typescript"] };
  }
  if (route.extension === ".tsx") return { syntax: ["typescript", "jsx"] };
  if (PLAIN_JAVASCRIPT.includes(route.extension)) return { syntax: ["jsx"] };
  return { syntax: ["typescript"] };
}

function rejected(error: SyntaxError): Stopped {
  const at: unknown = Reflect.get(error, "pos");
  invariant(typeof at === "number", "Babel locates each syntax error");
  return { kind: "stopped", at, reason: error.message.replace(BABEL_POSITION, "") };
}

function shebangSpan(start: number | null | undefined, end: number | null | undefined): LeadingSpan {
  invariant(typeof start === "number" && typeof end === "number", "Babel locates the interpreter directive");
  return { start, end, bodyStart: start + SHEBANG_PREFIX.length, bodyEnd: end, style: "line", leading: true };
}

function parsedWith(text: string, plugins: ParserPlugin[]): Lexed<LeadingSpan> {
  try {
    const file = parse(text, {
      sourceType: "unambiguous",
      plugins,
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowSuperOutsideMethod: true,
      allowUndeclaredExports: true,
    });
    const [firstCode] = [...file.program.directives, ...file.program.body];
    const codeStart = firstCode === undefined ? text.length : firstCode.start;
    invariant(typeof codeStart === "number", "Babel locates each statement");
    const spans = (file.comments ?? []).map(({ type, start, end }): LeadingSpan => {
      invariant(start !== undefined && end !== undefined, "Babel locates each comment");
      const block = type === "CommentBlock";
      return {
        start,
        end,
        bodyStart: start + OPENER,
        bodyEnd: block ? end - OPENER : end,
        style: block ? "block" : "line",
        leading: end <= codeStart,
      };
    });
    const { interpreter } = file.program;
    const shebang: LeadingSpan[] =
      interpreter === null || interpreter === undefined
        ? []
        : [shebangSpan(interpreter.start, interpreter.end)];
    return { kind: "lexed", spans: [...shebang, ...spans] };
  } catch (error) {
    if (error instanceof SyntaxError) return rejected(error);
    throw error;
  }
}

function lexed(text: string, dialect: Dialect): Lexed<LeadingSpan> {
  const stageThree = parsedWith(text, [...dialect.syntax, ...STAGE_THREE_DECORATORS]);
  if (stageThree.kind === "lexed") return stageThree;
  const legacy = parsedWith(text, [...dialect.syntax, ...LEGACY_DECORATORS]);
  if (legacy.kind === "lexed") return legacy;
  return legacy.at > stageThree.at ? legacy : stageThree;
}

function leadingLine({ span }: Read): boolean {
  return span.style === "line" && span.leading;
}

const KEPT: readonly KeptForm<Read>[] = [
  SHEBANG,
  directive("a leading `/// <reference …/>` holding only its attributes", {
    pattern: TRIPLE_SLASH_REFERENCE,
    where: leadingLine,
  }),
];

export const { comments, kept } = adapter({
  lex: (text, path) => lexed(text, dialectOf(path, text)),
  kept: KEPT,
});
