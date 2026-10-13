import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { invariant, unreachable } from "./assert";
import { EXIT_STATUS, recordOf, usageErrors } from "./coded-error";
import { checkoutRoot } from "./git";
import { adaptersBeside, SWEEP_ALL } from "./no-comments-installed";
import type { Language } from "./no-comments-languages";
import { annotations, REPLY_BYTES, reply, type Scope } from "./no-comments-report";
import { findings, type Judged, judgedChange, keptIn } from "./no-comments-scan";

const FORMAT = "--format";

const GITHUB = "github";

const FLAG_PREFIX = "-";

type Format = "text" | "github";

type Call = { readonly judged: Judged; readonly format: Format };

const scanUsageError = usageErrors<{ readonly wrong_arguments: { readonly got: readonly string[] } }>({
  wrong_arguments: {
    message: ({ got }) =>
      `scan.cjs takes no arguments, ${SWEEP_ALL}, or a base and a head, each optionally after ${FORMAT} ${GITHUB}, and got ${got.length}: ${got.join(" ")}`,
    resolve: () => `node scan.cjs [${FORMAT} ${GITHUB}] [${SWEEP_ALL} | <base> <head>]`,
  },
});

function judgedOf(args: readonly string[]): Judged | null {
  if (args.length === 1 && args[0] === SWEEP_ALL) return { kind: "all" };
  if (args.some((arg) => arg.startsWith(FLAG_PREFIX))) return null;
  if (args.length === 0) return { kind: "staged" };
  const [base, head] = args;
  if (args.length === 2 && base !== undefined && head !== undefined) return { kind: "pushed", base, head };
  return null;
}

function callOf(args: readonly string[]): Call | null {
  if (args[0] !== FORMAT) {
    const judged = judgedOf(args);
    return judged === null ? null : { judged, format: "text" };
  }
  if (args[1] !== GITHUB) return null;
  const judged = judgedOf(args.slice(2));
  return judged === null ? null : { judged, format: "github" };
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
  const call = callOf(args);
  if (call === null) throw scanUsageError("wrong_arguments", { got: args });
  const { judged, format } = call;
  const root = checkoutRoot(process.cwd());
  const adapterOf = adaptersBeside(dirname(realpathSync(script)));
  const found = findings(judgedChange(root, judged), adapterOf);
  const keptOf = (language: Language) => keptIn(adapterOf, language);
  switch (format) {
    case "text":
      process.stderr.write(reply(found, scopeOf(judged), keptOf, REPLY_BYTES));
      break;
    case "github":
      process.stdout.write(annotations(found));
      process.stderr.write(reply(found, scopeOf(judged), keptOf, null));
      break;
    default:
      unreachable(format);
  }
  return found.length === 0 ? 0 : EXIT_STATUS.refusal;
}

try {
  process.exitCode = main();
} catch (error) {
  const { kind, message, resolve } = recordOf(error);
  process.stderr.write(`no-comments: ${message}; ${resolve}\n`);
  process.exitCode = EXIT_STATUS[kind];
}
