import { type ParserPlugin, parse } from "@babel/parser";
import { invariant } from "./assert";
import type { Comment, CommentsOf, Reading } from "./no-comments-languages";
import { interpreterOf, routeOf } from "./no-comments-route";

type Dialect = { readonly syntax: ParserPlugin[]; readonly typedByJsdoc: boolean };

type Unparsed = Extract<Reading, { readonly kind: "unparsed" }>;

type Parsed = {
  readonly type: "CommentLine" | "CommentBlock";
  readonly value: string;
  readonly line: number;
  readonly source: string;
};

const TOOL_DIRECTIVE = /^(?:@ts-|eslint-|biome-ignore|prettier-ignore|[#@]__PURE__|@vitest-environment\b)/;

const TRIPLE_SLASH_REFERENCE = /^\/\s*<reference\b/;

const PLAIN_JAVASCRIPT = [".js", ".jsx", ".mjs", ".cjs"];

const TYPED_BY_JSDOC = [".js", ".mjs", ".cjs"];

const PLAIN_INTERPRETERS = ["node"];

const JSDOC_TYPE = /^@(?:type|typedef)\b/;

const JSDOC_PARAM = /^@param\b/;

const LEADING_STARS = /^[\s*]*/;

const BABEL_POSITION = /\.? \(\d+:\d+\)$/;

function dialectOf(path: string, text: string): Dialect {
  const route = routeOf(path);
  if (route.kind === "first-line") {
    const interpreter = interpreterOf(text);
    return interpreter !== null && PLAIN_INTERPRETERS.includes(interpreter)
      ? { syntax: ["jsx"], typedByJsdoc: true }
      : { syntax: ["typescript"], typedByJsdoc: false };
  }
  if (route.extension === ".tsx") return { syntax: ["typescript", "jsx"], typedByJsdoc: false };
  if (PLAIN_JAVASCRIPT.includes(route.extension))
    return { syntax: ["jsx"], typedByJsdoc: TYPED_BY_JSDOC.includes(route.extension) };
  return { syntax: ["typescript"], typedByJsdoc: false };
}

function unparsed(error: SyntaxError): Unparsed {
  const loc: unknown = Reflect.get(error, "loc");
  const line: unknown = typeof loc === "object" && loc !== null ? Reflect.get(loc, "line") : null;
  invariant(typeof line === "number", "Babel locates each syntax error");
  return { kind: "unparsed", line, reason: error.message.replace(BABEL_POSITION, "") };
}

function parsed(text: string, dialect: Dialect): Parsed[] | Unparsed {
  try {
    const file = parse(text, {
      sourceType: "unambiguous",
      plugins: [...dialect.syntax, ["decorators", {}], "decoratorAutoAccessors"],
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowSuperOutsideMethod: true,
      allowUndeclaredExports: true,
    });
    return (file.comments ?? []).flatMap(({ type, value, loc, start, end }) =>
      loc ? [{ type, value, line: loc.start.line, source: text.slice(start, end) }] : [],
    );
  } catch (error) {
    if (error instanceof SyntaxError) return unparsed(error);
    throw error;
  }
}

function typesPlainJavaScript({ type, value }: Parsed): boolean {
  if (type !== "CommentBlock" || !value.startsWith("*")) return false;
  const lines = value
    .split("\n")
    .map((line) => line.replace(LEADING_STARS, "").trim())
    .filter((line) => line !== "");
  const [first] = lines;
  if (first === undefined) return false;
  return JSDOC_TYPE.test(first) || lines.every((line) => JSDOC_PARAM.test(line));
}

function isToolContract(comment: Parsed, dialect: Dialect): boolean {
  const { type, value } = comment;
  if (type === "CommentLine" && TRIPLE_SLASH_REFERENCE.test(value)) return true;
  if (type === "CommentBlock" && value.startsWith("!")) return true;
  if (TOOL_DIRECTIVE.test(value.replace(LEADING_STARS, ""))) return true;
  return dialect.typedByJsdoc && typesPlainJavaScript(comment);
}

function refused({ line, source }: Parsed): Comment {
  return { line, text: source };
}

export const comments: CommentsOf = (path, text) => {
  const dialect = dialectOf(path, text);
  const found = parsed(text, dialect);
  if (!Array.isArray(found)) return found;
  return {
    kind: "read",
    comments: found.filter((comment) => !isToolContract(comment, dialect)).map(refused),
  };
};
