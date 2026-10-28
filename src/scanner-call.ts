import { unreachable } from "./assert";
import { EXIT_STATUS, recordOf, usageErrors } from "./coded-error";
import type { Judged } from "./scanner-change";
import { REPLY_BYTES } from "./scanner-report";

export const SWEEP_ALL = "--all";

const FORMAT = "--format";

const GITHUB = "github";

const FLAG_PREFIX = "-";

type Format = "text" | "github";

export type Scope = "change" | "tracked";

export type Form = { readonly said: string; readonly syntax: string };

type Call = { readonly format: Format; readonly rest: readonly string[] };

type Run = {
  readonly format: Format;
  readonly reply: (maxBytes: number | null) => string;
  readonly annotations: string;
  readonly refused: boolean;
};

export const JUDGED_FORMS: readonly Form[] = [
  { said: SWEEP_ALL, syntax: SWEEP_ALL },
  { said: "a base and a head", syntax: "<base> <head>" },
];

function listed(forms: readonly Form[]): string {
  const phrases = ["no arguments", ...forms.map(({ said }) => said)];
  return `${phrases.slice(0, -1).join(", ")}, or ${phrases.at(-1)}`;
}

const scanUsageError = usageErrors<{
  readonly wrong_arguments: { readonly forms: readonly Form[]; readonly got: readonly string[] };
}>({
  wrong_arguments: {
    message: ({ forms, got }) =>
      `scan.cjs takes ${listed(forms)}, each optionally after ${FORMAT} ${GITHUB}, and got ${got.length}: ${got.join(" ")}`,
    resolve: ({ forms }) =>
      `node scan.cjs [${FORMAT} ${GITHUB}] [${forms.map(({ syntax }) => syntax).join(" | ")}]`,
  },
});

export function usageError(forms: readonly Form[], got: readonly string[]) {
  return scanUsageError("wrong_arguments", { forms, got });
}

export function formatOf(args: readonly string[]): Call | null {
  if (args[0] !== FORMAT) return { format: "text", rest: args };
  if (args[1] !== GITHUB) return null;
  return { format: "github", rest: args.slice(2) };
}

export function judgedOf(rest: readonly string[]): Judged | null {
  if (rest.length === 1 && rest[0] === SWEEP_ALL) return { kind: "all" };
  if (rest.some((arg) => arg.startsWith(FLAG_PREFIX))) return null;
  if (rest.length === 0) return { kind: "staged" };
  const [base, head] = rest;
  if (rest.length === 2 && base !== undefined && head !== undefined) return { kind: "pushed", base, head };
  return null;
}

export function scopeOf(judged: Judged): Scope {
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

export function run(gate: string, main: () => Run): void {
  try {
    const { format, reply, annotations, refused } = main();
    switch (format) {
      case "text":
        process.stderr.write(reply(REPLY_BYTES));
        break;
      case "github":
        process.stdout.write(annotations);
        process.stderr.write(reply(null));
        break;
      default:
        unreachable(format);
    }
    process.exitCode = refused ? EXIT_STATUS.refusal : 0;
  } catch (error) {
    const { kind, message, resolve } = recordOf(error);
    process.stderr.write(`${gate}: ${message}; ${resolve}\n`);
    process.exitCode = EXIT_STATUS[kind];
  }
}
