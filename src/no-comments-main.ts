import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { invariant, unreachable } from "./assert";
import { EXIT_STATUS, recordOf, usageErrors } from "./coded-error";
import { checkoutRoot } from "./git";
import { fileChange } from "./no-comments-file";
import { adaptersBeside, SWEEP_ALL } from "./no-comments-installed";
import type { Language } from "./no-comments-languages";
import { annotations, REPLY_BYTES, reply, type Scope } from "./no-comments-report";
import { findings, type Judged, type JudgedChange, judgedChange, keptIn } from "./no-comments-scan";

const FORMAT = "--format";

const ONE_FILE = "--file";

const GITHUB = "github";

const FLAG_PREFIX = "-";

type Format = "text" | "github";

type Target = Judged | { readonly kind: "file"; readonly absolute: string };

type Call = { readonly target: Target; readonly format: Format };

const scanUsageError = usageErrors<{ readonly wrong_arguments: { readonly got: readonly string[] } }>({
  wrong_arguments: {
    message: ({ got }) =>
      `scan.cjs takes no arguments, ${SWEEP_ALL}, a base and a head, or ${ONE_FILE} and a path, each optionally after ${FORMAT} ${GITHUB}, and got ${got.length}: ${got.join(" ")}`,
    resolve: () => `node scan.cjs [${FORMAT} ${GITHUB}] [${SWEEP_ALL} | <base> <head> | ${ONE_FILE} <path>]`,
  },
});

function targetOf(args: readonly string[]): Target | null {
  if (args.length === 1 && args[0] === SWEEP_ALL) return { kind: "all" };
  const [flag, path] = args;
  if (args.length === 2 && flag === ONE_FILE && path !== undefined)
    return { kind: "file", absolute: resolve(path) };
  if (args.some((arg) => arg.startsWith(FLAG_PREFIX))) return null;
  if (args.length === 0) return { kind: "staged" };
  const [base, head] = args;
  if (args.length === 2 && base !== undefined && head !== undefined) return { kind: "pushed", base, head };
  return null;
}

function callOf(args: readonly string[]): Call | null {
  if (args[0] !== FORMAT) {
    const target = targetOf(args);
    return target === null ? null : { target, format: "text" };
  }
  if (args[1] !== GITHUB) return null;
  const target = targetOf(args.slice(2));
  return target === null ? null : { target, format: "github" };
}

function scopeOf(target: Target): Scope {
  switch (target.kind) {
    case "staged":
    case "pushed":
    case "file":
      return "change";
    case "all":
      return "tracked";
    default:
      return unreachable(target);
  }
}

function changeOf(root: string, target: Target): JudgedChange {
  if (target.kind === "file") return fileChange(root, target.absolute);
  return judgedChange(root, target);
}

function main(): number {
  const script = process.argv[1];
  invariant(script !== undefined, "node names the script it runs");
  const args = process.argv.slice(2);
  const call = callOf(args);
  if (call === null) throw scanUsageError("wrong_arguments", { got: args });
  const { target, format } = call;
  const root = checkoutRoot(process.cwd());
  const adapterOf = adaptersBeside(dirname(realpathSync(script)));
  const found = findings(changeOf(root, target), adapterOf);
  const keptOf = (language: Language) => keptIn(adapterOf, language);
  switch (format) {
    case "text":
      process.stderr.write(reply(found, scopeOf(target), keptOf, REPLY_BYTES));
      break;
    case "github":
      process.stdout.write(annotations(found));
      process.stderr.write(reply(found, scopeOf(target), keptOf, null));
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
