import { parseArgs } from "node:util";
import { unreachable } from "./assert";
import { checkArity, FULL_FLAG, fullOf, usageError } from "./cli-args";
import type { Command } from "./cli-contract";
import { type GateName, isGateName, noCommentsGate } from "./gate-parts";
import { type InstalledFile, installedGates, installGates, type Named } from "./gates";
import {
  EACH_TRACKED_LANGUAGE,
  eachFill,
  FILL_NAMES,
  FILLS,
  type Fill,
  type Fills,
  GATE_CHOICES,
  gatesFilling,
} from "./gates-contract";
import { checkoutRoot } from "./git";
import { GH, repoVisibility } from "./github";
import { LANGUAGE_NAMES } from "./no-comments-languages";

const OPTIONS = eachFill(() => ({ type: "string", multiple: true }) as const);

const PARSE_ERROR = "ERR_PARSE_ARGS";

function namedIn(name: string | undefined, usage: string): Named {
  if (name === undefined) return { kind: "none" };
  if (name === EACH_TRACKED_LANGUAGE) return { kind: "each-tracked-language" };
  if (isGateName(name)) return { kind: "gates", gates: [name] };
  throw usageError("unknown_gate", { names: [name], usage });
}

function admitting(named: Named, root: string): readonly GateName[] {
  switch (named.kind) {
    case "none":
      return installedGates(root);
    case "gates":
      return named.gates;
    case "each-tracked-language":
      return LANGUAGE_NAMES.map(noCommentsGate);
    default:
      return unreachable(named);
  }
}

function fillOf(
  values: Readonly<Partial<Record<Fill, readonly string[]>>>,
  fill: Fill,
  admitted: () => readonly GateName[],
  usage: string,
): string | null {
  const given = values[fill];
  if (given === undefined) return null;
  const [value, ...more] = given;
  const used = admitted().some((gate) => gatesFilling(fill).includes(gate));
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

function fullFile(file: InstalledFile) {
  const backup = file.state === "changed" || file.state === "unwanted" ? file.backup : null;
  return { target: file.target, state: file.state, backup };
}

function backups(files: readonly InstalledFile[]) {
  return files.flatMap((file) => {
    if (file.state !== "changed" && file.state !== "unwanted") return [];
    return file.backup === null ? [] : [{ target: file.target, backup: file.backup }];
  });
}

const INSTALL_USAGE = `agent-gates install [<gate>] [${FILLS.command.flag} <format command>] [${FILLS.prefixes.flag} ${FILLS.prefixes.placeholder}] [${FILLS.workflows.flag} ${FILLS.workflows.placeholder}] [${FULL_FLAG}], choosing from ${GATE_CHOICES}`;

export const installCommand: Command = {
  name: "install",
  usage: INSTALL_USAGE,
  summary: "install the named gate, and bring the installed ones up to date",
  run(args) {
    const { full, rest } = fullOf(args);
    const { values, positionals } = parsed(rest, this.usage);
    checkArity(positionals, [0, 1], this);
    const named = namedIn(positionals[0], this.usage);
    const root = checkoutRoot(process.cwd());
    const admitted = () => admitting(named, root);
    const given: Fills = eachFill((fill) => fillOf(values, fill, admitted, this.usage));
    const { counts, gates, files, prepare, fills, workflows } = installGates(root, named, given, () =>
      repoVisibility(root, GH),
    );
    if (full)
      return { value: { counts, gates, files: files.map(fullFile), prepare, fills, workflows }, exitCode: 0 };
    const listed = files.map(({ target, state }) => ({ target, state }));
    const value = { counts, gates, files: listed, backups: backups(files), prepare, fills, workflows };
    return { value, exitCode: 0 };
  },
};
