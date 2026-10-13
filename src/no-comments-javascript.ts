import { type ParserPlugin, parse } from "@babel/parser";
import { invariant } from "./assert";
import {
  adapter,
  type CommentRead,
  directive,
  type KeptForm,
  type LeadingSpan,
  type Lexed,
} from "./no-comments-adapter";
import { interpreterOf, routeOf } from "./no-comments-route";
import type { Stopped } from "./no-comments-spans";

type Dialect = { readonly syntax: ParserPlugin[] };

type Read = CommentRead<LeadingSpan, null>;

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

function parsedWith(text: string, plugins: ParserPlugin[]): Lexed<LeadingSpan, null> {
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
    return { kind: "lexed", spans, facts: null };
  } catch (error) {
    if (error instanceof SyntaxError) return rejected(error);
    throw error;
  }
}

function lexed(text: string, dialect: Dialect): Lexed<LeadingSpan, null> {
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
  directive("`#__PURE__` or `@__PURE__` alone", { pattern: /[\s*]*[#@]__PURE__/ }),
  directive("a leading `/// <reference …/>` holding only its attributes", {
    pattern: TRIPLE_SLASH_REFERENCE,
    where: leadingLine,
  }),
];

export const { comments, kept } = adapter({
  lex: (text, path) => lexed(text, dialectOf(path, text)),
  kept: KEPT,
});
