import { parseArgs } from "node:util";
import { unreachable } from "./assert";
import { checkArity, usageError } from "./cli-args";
import type { Command } from "./cli-contract";
import { type GateName, isGateName } from "./gate-parts";
import { installGates, trackedLanguageGates } from "./gates";
import {
  EACH_TRACKED_LANGUAGE,
  eachFill,
  FILL_NAMES,
  FILLS,
  type Fill,
  type Fills,
  GATES,
  INSTALL_USAGE,
} from "./gates-contract";
import { checkoutRoot } from "./git";

type Named =
  | { readonly kind: "none" }
  | { readonly kind: "gate"; readonly gate: GateName }
  | { readonly kind: "each-tracked-language" };

const OPTIONS = eachFill(() => ({ type: "string", multiple: true }) as const);

const PARSE_ERROR = "ERR_PARSE_ARGS";

function namedIn(name: string | undefined, usage: string): Named {
  if (name === undefined) return { kind: "none" };
  if (name === EACH_TRACKED_LANGUAGE) return { kind: "each-tracked-language" };
  if (isGateName(name)) return { kind: "gate", gate: name };
  throw usageError("unknown_gate", { names: [name], usage });
}

function gatesOf(named: Named, root: string): readonly GateName[] {
  switch (named.kind) {
    case "none":
      return [];
    case "gate":
      return [named.gate];
    case "each-tracked-language":
      return trackedLanguageGates(root);
    default:
      return unreachable(named);
  }
}

function fillOf(
  values: Readonly<Partial<Record<Fill, readonly string[]>>>,
  fill: Fill,
  named: Named,
  usage: string,
): string | null {
  const given = values[fill];
  if (given === undefined) return null;
  const [value, ...more] = given;
  const used = named.kind === "gate" && GATES[named.gate].some((file) => file.fills === fill);
  const { flag, pattern } = FILLS[fill];
  if (value === undefined || value.trim() === "" || more.length > 0 || !used)
    throw usageError("flag_misplaced", { flag, usage });
  if (pattern !== null && !pattern.matches.test(value))
    throw usageError("fill_malformed", { flag, value, form: pattern.form, usage });
  return value;
}

const FLAG_NAMES: readonly string[] = FILL_NAMES.map((fill) => FILLS[fill].flag);

function isParseError(error: unknown): boolean {
  return error instanceof Error && "code" in error && String(error.code).startsWith(PARSE_ERROR);
}

function parsed(args: readonly string[], usage: string) {
  try {
    return parseArgs({ args: [...args], options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    if (!isParseError(error)) throw error;
    const unknown = args.filter((arg) => arg.startsWith("-") && !FLAG_NAMES.includes(arg));
    if (unknown.length > 0) throw usageError("unknown_gate", { names: unknown, usage });
    const [flag = ""] = args.filter((arg) => FLAG_NAMES.includes(arg));
    throw usageError("flag_misplaced", { flag, usage });
  }
}

export const installCommand: Command = {
  name: "install",
  usage: INSTALL_USAGE,
  summary: "install the named gate, and bring the installed ones up to date",
  run(args) {
    const { values, positionals } = parsed(args, this.usage);
    checkArity(positionals, [0, 1], this);
    const named = namedIn(positionals[0], this.usage);
    const given: Fills = eachFill((fill) => fillOf(values, fill, named, this.usage));
    const root = checkoutRoot(process.cwd());
    return { value: installGates(root, gatesOf(named, root), given), exitCode: 0 };
  },
};
