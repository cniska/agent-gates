import { parseArgs } from "node:util";
import { checkArity, usageError } from "./cli-args";
import type { Command } from "./cli-contract";
import { GATE_NAMES, type GateName, isGateName } from "./gate-parts";
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

type Named = {
  readonly gates: readonly GateName[];
  readonly eachTrackedLanguage: boolean;
};

const OPTIONS = eachFill(() => ({ type: "string", multiple: true }) as const);

const PARSE_ERROR = "ERR_PARSE_ARGS";

function namedIn(names: readonly string[], usage: string): Named {
  const gates: GateName[] = [];
  const unknown: string[] = [];
  let eachTrackedLanguage = false;
  for (const name of names) {
    if (name === EACH_TRACKED_LANGUAGE) eachTrackedLanguage = true;
    else if (isGateName(name)) gates.push(name);
    else unknown.push(name);
  }
  if (unknown.length > 0) throw usageError("unknown_gate", { names: unknown, usage });
  return { gates, eachTrackedLanguage };
}

function fillOf(
  values: Readonly<Partial<Record<Fill, readonly string[]>>>,
  fill: Fill,
  gates: readonly GateName[],
  usage: string,
): string | null {
  const given = values[fill];
  if (given === undefined) return null;
  const [value, ...more] = given;
  const used = gates.some((gate) => GATES[gate].some((file) => file.fills === fill));
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
  summary: "install the named gates, and bring the installed ones up to date",
  run(args) {
    const { values, positionals } = parsed(args, this.usage);
    checkArity(positionals, [0, GATE_NAMES.length + 1], this);
    const named = namedIn(positionals, this.usage);
    const given: Fills = eachFill((fill) => fillOf(values, fill, named.gates, this.usage));
    const root = checkoutRoot(process.cwd());
    const tracked = named.eachTrackedLanguage ? trackedLanguageGates(root) : [];
    return { value: installGates(root, [...named.gates, ...tracked], given), exitCode: 0 };
  },
};
