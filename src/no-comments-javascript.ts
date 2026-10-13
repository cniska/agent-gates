import { type ParserPlugin, parse } from "@babel/parser";
import { invariant } from "./assert";
import {
  adapter,
  type CommentRead,
  directive,
  type KeptForm,
  type Lexed,
  type Span,
} from "./no-comments-adapter";
import { interpreterOf, routeOf } from "./no-comments-route";
import type { Stopped } from "./no-comments-spans";

type Dialect = { readonly syntax: ParserPlugin[]; readonly plainJavaScript: boolean };

type JavaScriptSpan = Span & { readonly leading: boolean };

type Read = CommentRead<JavaScriptSpan, Dialect, null>;

const TRIPLE_SLASH_REFERENCE = /^\/\s*<reference\b/;

const PLAIN_JAVASCRIPT = [".js", ".jsx", ".mjs", ".cjs"];

const PLAIN_INTERPRETERS = ["node"];

const JSDOC_TYPE_ONLY = [
  /^@type\s+\{.*\}$/,
  /^@typedef\s+\{.*\}\s+[\w$.]+$/,
  /^@param\s+\{.*\}\s+\[?[\w$.]+(?:=[^\]]*)?\]?$/,
];

const LEADING_STARS = /^[\s*]*/;

const JSDOC_OPENER = "*";

const OPENER = 2;

const BABEL_POSITION = /\.? \(\d+:\d+\)$/;

const STAGE_THREE_DECORATORS: ParserPlugin[] = [["decorators", {}], "decoratorAutoAccessors"];

const LEGACY_DECORATORS: ParserPlugin[] = ["decorators-legacy", "decoratorAutoAccessors"];

function dialectOf(path: string, text: string): Dialect {
  const route = routeOf(path);
  if (route.kind === "first-line") {
    const interpreter = interpreterOf(text);
    return interpreter !== null && PLAIN_INTERPRETERS.includes(interpreter)
      ? { syntax: ["jsx"], plainJavaScript: true }
      : { syntax: ["typescript"], plainJavaScript: false };
  }
  if (route.extension === ".tsx") return { syntax: ["typescript", "jsx"], plainJavaScript: false };
  if (PLAIN_JAVASCRIPT.includes(route.extension)) return { syntax: ["jsx"], plainJavaScript: true };
  return { syntax: ["typescript"], plainJavaScript: false };
}

function rejected(error: SyntaxError): Stopped {
  const at: unknown = Reflect.get(error, "pos");
  invariant(typeof at === "number", "Babel locates each syntax error");
  return { kind: "stopped", at, reason: error.message.replace(BABEL_POSITION, "") };
}

function parsedWith(text: string, plugins: ParserPlugin[]): Lexed<JavaScriptSpan, null> {
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
    const spans = (file.comments ?? []).map(({ type, start, end }): JavaScriptSpan => {
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

function lexed(text: string, dialect: Dialect): Lexed<JavaScriptSpan, null> {
  const stageThree = parsedWith(text, [...dialect.syntax, ...STAGE_THREE_DECORATORS]);
  if (stageThree.kind === "lexed") return stageThree;
  const legacy = parsedWith(text, [...dialect.syntax, ...LEGACY_DECORATORS]);
  if (legacy.kind === "lexed") return legacy;
  return legacy.at > stageThree.at ? legacy : stageThree;
}

function typesPlainJavaScript({ span, body }: Read): boolean {
  if (span.style !== "block" || !body.startsWith(JSDOC_OPENER)) return false;
  const lines = body
    .split("\n")
    .map((line) => line.replace(LEADING_STARS, "").trim())
    .filter((line) => line !== "");
  return lines.length > 0 && lines.every((line) => JSDOC_TYPE_ONLY.some((tag) => tag.test(line)));
}

function inBlock({ span }: Read): boolean {
  return span.style === "block";
}

function leadingLine({ span }: Read): boolean {
  return span.style === "line" && span.leading;
}

function leadingLineInPlainJavaScript(read: Read): boolean {
  return read.file.context.plainJavaScript && leadingLine(read);
}

const KEPT: readonly KeptForm<Read>[] = [
  directive("`@ts-expect-error`", { pattern: /@ts-expect-error/, reason: "allowed" }),
  directive("a leading `// @ts-check` in plain JavaScript", {
    pattern: /@ts-check/,
    reason: "allowed",
    where: leadingLineInPlainJavaScript,
  }),
  directive("`eslint-disable-line` and `eslint-disable-next-line` naming rules", {
    pattern: /eslint-disable-(?:next-)?line\s+(?!--)\S+/,
    reason: "allowed",
  }),
  directive("`/* eslint-disable */` and `/* eslint-enable */` naming rules", {
    pattern: /eslint-(?:disable|enable)\s+(?!--)\S+/,
    reason: "allowed",
    where: inBlock,
  }),
  directive("`biome-ignore`, `-all`, `-start` and `-end` naming only rules or `format`", {
    pattern:
      /biome-ignore(?:-all|-start|-end)?(?:\s+(?:(?:lint|assist|syntax)\/\w+\/\w+(?:\([^)]*\))?|format))+\s*(?::|$)/,
    reason: "allowed",
  }),
  directive("`prettier-ignore` alone", { pattern: /prettier-ignore/, reason: "alone" }),
  directive("`#__PURE__` or `@__PURE__` alone", { pattern: /[#@]__PURE__/, reason: "alone" }),
  directive("`@vitest-environment <env>` alone", { pattern: /@vitest-environment\s+\S+/, reason: "alone" }),
  {
    shown: "a leading `/// <reference`",
    keeps: (read) => leadingLine(read) && TRIPLE_SLASH_REFERENCE.test(read.body),
  },
  {
    shown:
      "in plain JavaScript, JSDoc blocks holding only `@type {…}`, `@typedef {…} Name` and `@param {…} name`",
    keeps: (read) => read.file.context.plainJavaScript && typesPlainJavaScript(read),
  },
];

export const { comments, kept } = adapter({
  contextOf: dialectOf,
  lex: lexed,
  directiveLead: LEADING_STARS,
  kept: KEPT,
});
