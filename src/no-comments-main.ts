import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { invariant, unreachable } from "./assert";
import { EXIT_STATUS, recordOf, usageErrors } from "./coded-error";
import { checkoutRoot } from "./git";
import type { Comment, CommentsOf, Language, Reading } from "./no-comments-languages";
import { REPLY_BYTES, reply, type Scope } from "./no-comments-report";
import { type AdapterOf, findings, type Judged, judgedChange } from "./no-comments-scan";

const SCANNER = "scan.cjs";

const ALL = "--all";

const FLAG_PREFIX = "-";

const scanUsageError = usageErrors<{ readonly wrong_arguments: { readonly got: readonly string[] } }>({
  wrong_arguments: {
    message: ({ got }) =>
      `scan.cjs takes no arguments, ${ALL}, or a base and a head, and got ${got.length}: ${got.join(" ")}`,
    resolve: () => `node scan.cjs [${ALL} | <base> <head>]`,
  },
});

function isComment(value: unknown): value is Comment {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "line") === "number" &&
    typeof Reflect.get(value, "text") === "string"
  );
}

function isReading(value: unknown): value is Reading {
  if (typeof value !== "object" || value === null) return false;
  switch (Reflect.get(value, "kind")) {
    case "read": {
      const comments: unknown = Reflect.get(value, "comments");
      return Array.isArray(comments) && comments.every(isComment);
    }
    case "unparsed":
      return (
        typeof Reflect.get(value, "line") === "number" && typeof Reflect.get(value, "reason") === "string"
      );
    default:
      return false;
  }
}

function adapterAt(path: string, load: NodeJS.Require): CommentsOf | null {
  if (!existsSync(path)) return null;
  const comments: unknown = Reflect.get(Object(load(path)), "comments");
  invariant(typeof comments === "function", `${path} exports comments()`);
  return (file, text) => {
    const reading: unknown = Reflect.apply(comments, undefined, [file, text]);
    invariant(isReading(reading), `${path} returns the comments it read, or where the file stops parsing`);
    return reading;
  };
}

function adaptersBeside(dir: string): AdapterOf {
  const load = createRequire(join(dir, SCANNER));
  const loaded = new Map<Language, CommentsOf | null>();
  return (language) => {
    const known = loaded.get(language);
    if (known !== undefined) return known;
    const adapter = adapterAt(join(dir, `${language}.cjs`), load);
    loaded.set(language, adapter);
    return adapter;
  };
}

function judgedOf(args: readonly string[]): Judged | null {
  if (args.length === 1 && args[0] === ALL) return { kind: "all" };
  if (args.some((arg) => arg.startsWith(FLAG_PREFIX))) return null;
  if (args.length === 0) return { kind: "staged" };
  const [base, head] = args;
  if (args.length === 2 && base !== undefined && head !== undefined) return { kind: "pushed", base, head };
  return null;
}

function scopeOf(judged: Judged): Scope {
  switch (judged.kind) {
    case "staged":
    case "pushed":
      return "change";
    case "all":
      return "tracked";
    default:
      return unreachable(judged);
  }
}

function main(): number {
  const script = process.argv[1];
  invariant(script !== undefined, "node names the script it runs");
  const args = process.argv.slice(2);
  const judged = judgedOf(args);
  if (judged === null) throw scanUsageError("wrong_arguments", { got: args });
  const root = checkoutRoot(process.cwd());
  const found = findings(judgedChange(root, judged), adaptersBeside(dirname(realpathSync(script))));
  process.stderr.write(reply(found, scopeOf(judged), REPLY_BYTES));
  return found.length === 0 ? 0 : EXIT_STATUS.refusal;
}

try {
  process.exitCode = main();
} catch (error) {
  const { kind, message, resolve } = recordOf(error);
  process.stderr.write(`no-comments: ${message}; ${resolve}\n`);
  process.exitCode = EXIT_STATUS[kind];
}
