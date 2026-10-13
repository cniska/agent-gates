import { type ParserPlugin, parse } from "@babel/parser";
import { invariant } from "./assert";
import { type KeptForm, keptBy, shownOf } from "./no-comments-kept";
import type { Comment, CommentsOf, Reading } from "./no-comments-languages";
import { interpreterOf, routeOf } from "./no-comments-route";

type Dialect = { readonly syntax: ParserPlugin[]; readonly plainJavaScript: boolean };

type Unparsed = Extract<Reading, { readonly kind: "unparsed" }>;

type Rejected = { readonly kind: "rejected"; readonly offset: number; readonly unparsed: Unparsed };

type Parsed = {
  readonly type: "CommentLine" | "CommentBlock";
  readonly value: string;
  readonly line: number;
  readonly source: string;
  readonly leading: boolean;
};

const TRIPLE_SLASH_REFERENCE = /^\/\s*<reference\b/;

const PLAIN_JAVASCRIPT = [".js", ".jsx", ".mjs", ".cjs"];

const PLAIN_INTERPRETERS = ["node"];

const JSDOC_TYPE_ONLY = [
  /^@type\s+\{.*\}$/,
  /^@typedef\s+\{.*\}\s+[\w$.]+$/,
  /^@param\s+\{.*\}\s+\[?[\w$.]+(?:=[^\]]*)?\]?$/,
];

const LEADING_STARS = /^[\s*]*/;

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

function rejected(error: SyntaxError): Rejected {
  const offset: unknown = Reflect.get(error, "pos");
  const loc: unknown = Reflect.get(error, "loc");
  const line: unknown = typeof loc === "object" && loc !== null ? Reflect.get(loc, "line") : null;
  invariant(typeof offset === "number" && typeof line === "number", "Babel locates each syntax error");
  return {
    kind: "rejected",
    offset,
    unparsed: { kind: "unparsed", line, reason: error.message.replace(BABEL_POSITION, "") },
  };
}

function parsedWith(text: string, plugins: ParserPlugin[]): Parsed[] | Rejected {
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
    return (file.comments ?? []).map(({ type, value, loc, start, end }) => {
      invariant(loc !== undefined && end !== undefined, "Babel locates each comment");
      return { type, value, line: loc.start.line, source: text.slice(start, end), leading: end <= codeStart };
    });
  } catch (error) {
    if (error instanceof SyntaxError) return rejected(error);
    throw error;
  }
}

function parsed(text: string, dialect: Dialect): Parsed[] | Unparsed {
  const stageThree = parsedWith(text, [...dialect.syntax, ...STAGE_THREE_DECORATORS]);
  if (Array.isArray(stageThree)) return stageThree;
  const legacy = parsedWith(text, [...dialect.syntax, ...LEGACY_DECORATORS]);
  if (Array.isArray(legacy)) return legacy;
  return legacy.offset > stageThree.offset ? legacy.unparsed : stageThree.unparsed;
}

function typesPlainJavaScript({ type, value }: Parsed): boolean {
  if (type !== "CommentBlock" || !value.startsWith("*")) return false;
  const lines = value
    .split("\n")
    .map((line) => line.replace(LEADING_STARS, "").trim())
    .filter((line) => line !== "");
  return lines.length > 0 && lines.every((line) => JSDOC_TYPE_ONLY.some((tag) => tag.test(line)));
}

type InDialect = { readonly comment: Parsed; readonly dialect: Dialect };

function anywhere(): boolean {
  return true;
}

function inBlock({ comment }: InDialect): boolean {
  return comment.type === "CommentBlock";
}

function leadingLine({ comment }: InDialect): boolean {
  return comment.type === "CommentLine" && comment.leading;
}

function leadingLineInPlainJavaScript(read: InDialect): boolean {
  return read.dialect.plainJavaScript && leadingLine(read);
}

function directive(
  shown: string,
  pattern: RegExp,
  readWhere: (read: InDialect) => boolean = anywhere,
): KeptForm<InDialect> {
  return {
    shown,
    keeps: (read) => {
      const { value } = read.comment;
      return (
        readWhere(read) && !value.includes("\n") && pattern.test(value.replace(LEADING_STARS, "").trim())
      );
    },
  };
}

const KEPT: readonly KeptForm<InDialect>[] = [
  directive("`@ts-expect-error`", /^@ts-expect-error(?![\w-])/),
  directive(
    "a leading `// @ts-check` in plain JavaScript",
    /^@ts-check(?![\w-])/,
    leadingLineInPlainJavaScript,
  ),
  directive(
    "`eslint-disable-line` and `eslint-disable-next-line` naming rules",
    /^eslint-disable-(?:next-)?line\s+(?!--)\S/,
  ),
  directive(
    "`/* eslint-disable */` and `/* eslint-enable */` naming rules",
    /^eslint-(?:disable|enable)\s+(?!--)\S/,
    inBlock,
  ),
  directive(
    "`biome-ignore`, `-all`, `-start` and `-end` naming only rules or `format`",
    /^biome-ignore(?:-all|-start|-end)?(?:\s+(?:(?:lint|assist|syntax)\/\w+\/\w+(?:\([^)]*\))?|format))+\s*(?::|$)/,
  ),
  directive("`prettier-ignore` alone", /^prettier-ignore$/),
  directive("`#__PURE__` or `@__PURE__` alone", /^[#@]__PURE__$/),
  directive("`@vitest-environment <env>` alone", /^@vitest-environment\s+\S+$/),
  {
    shown: "a leading `/// <reference`",
    keeps: (read) => leadingLine(read) && TRIPLE_SLASH_REFERENCE.test(read.comment.value),
  },
  {
    shown:
      "in plain JavaScript, JSDoc blocks holding only `@type {…}`, `@typedef {…} Name` and `@param {…} name`",
    keeps: ({ comment, dialect }) => dialect.plainJavaScript && typesPlainJavaScript(comment),
  },
];

const isKept = keptBy(KEPT);

function refused({ line, source }: Parsed): Comment {
  return { line, text: source };
}

export const comments: CommentsOf = (path, text) => {
  const dialect = dialectOf(path, text);
  const found = parsed(text, dialect);
  if (!Array.isArray(found)) return found;
  return {
    kind: "read",
    comments: found.filter((comment) => !isKept({ comment, dialect })).map(refused),
  };
};

export const kept = shownOf(KEPT);
