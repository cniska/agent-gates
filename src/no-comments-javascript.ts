import { type ParserPlugin, parse } from "@babel/parser";
import { invariant } from "./assert";
import { adapter, type Lexed, type Span } from "./no-comments-adapter";
import { interpreterOf, routeOf } from "./no-comments-route";
import type { Stopped } from "./no-comments-spans";

type Dialect = { readonly syntax: ParserPlugin[] };

const PLAIN_JAVASCRIPT = [".js", ".jsx", ".mjs", ".cjs"];

const PLAIN_INTERPRETERS = ["node"];

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

function shebangSpan(start: number | null | undefined, end: number | null | undefined): Span {
  invariant(typeof start === "number" && typeof end === "number", "Babel locates the interpreter directive");
  return { start, end, style: "line" };
}

function parsedWith(text: string, plugins: ParserPlugin[]): Lexed {
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
    const spans = (file.comments ?? []).map(({ type, start, end }): Span => {
      invariant(start !== undefined && end !== undefined, "Babel locates each comment");
      return { start, end, style: type === "CommentBlock" ? "block" : "line" };
    });
    const { interpreter } = file.program;
    const shebang: Span[] =
      interpreter === null || interpreter === undefined
        ? []
        : [shebangSpan(interpreter.start, interpreter.end)];
    return { kind: "lexed", spans: [...shebang, ...spans] };
  } catch (error) {
    if (error instanceof SyntaxError) return rejected(error);
    throw error;
  }
}

function lexed(text: string, dialect: Dialect): Lexed {
  const stageThree = parsedWith(text, [...dialect.syntax, ...STAGE_THREE_DECORATORS]);
  if (stageThree.kind === "lexed") return stageThree;
  const legacy = parsedWith(text, [...dialect.syntax, ...LEGACY_DECORATORS]);
  if (legacy.kind === "lexed") return legacy;
  return legacy.at > stageThree.at ? legacy : stageThree;
}

export const { comments } = adapter((text, path) => lexed(text, dialectOf(path, text)));
