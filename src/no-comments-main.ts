import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { invariant } from "./assert";
import { EXIT_STATUS, recordOf, usageErrors } from "./coded-error";
import { checkoutRoot } from "./git";
import type { Comment, CommentsOf, Language } from "./no-comments-languages";
import { type AdapterOf, findings, type Judged, judgedFiles, verdict } from "./no-comments-scan";

const SCANNER = "scan.cjs";

const scanUsageError = usageErrors<{ readonly wrong_arguments: { readonly got: readonly string[] } }>({
  wrong_arguments: {
    message: ({ got }) =>
      `scan.cjs takes no arguments or a base and a head, and got ${got.length}: ${got.join(" ")}`,
    resolve: () => "node scan.cjs [<base> <head>]",
  },
});

function isComment(value: unknown): value is Comment {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "line") === "number" &&
    typeof Reflect.get(value, "body") === "string"
  );
}

function adapterAt(path: string, load: NodeJS.Require): CommentsOf | null {
  if (!existsSync(path)) return null;
  const comments: unknown = Reflect.get(Object(load(path)), "comments");
  invariant(typeof comments === "function", `${path} exports comments()`);
  return async (file, text) => {
    const found: unknown = await Reflect.apply(comments, undefined, [file, text]);
    invariant(
      found === null || (Array.isArray(found) && found.every(isComment)),
      `${path} returns comments or null`,
    );
    return found;
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
  const [base, head] = args;
  if (args.length === 0) return { kind: "staged" };
  if (args.length === 2 && base !== undefined && head !== undefined) return { kind: "pushed", base, head };
  return null;
}

async function main(): Promise<number> {
  const script = process.argv[1];
  invariant(script !== undefined, "node names the script it runs");
  const args = process.argv.slice(2);
  const judged = judgedOf(args);
  if (judged === null) throw scanUsageError("wrong_arguments", { got: args });
  const root = checkoutRoot(process.cwd());
  const lines = verdict(
    await findings(judgedFiles(root, judged), adaptersBeside(dirname(realpathSync(script)))),
  );
  for (const line of lines) process.stderr.write(`${line}\n`);
  return lines.length === 0 ? 0 : EXIT_STATUS.refusal;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const { kind, message, resolve } = recordOf(error);
    process.stderr.write(`no-comments: ${message}; ${resolve}\n`);
    process.exitCode = EXIT_STATUS[kind];
  },
);
