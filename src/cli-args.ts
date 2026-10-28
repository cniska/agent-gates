import type { Command } from "./cli-contract";
import { usageErrors } from "./coded-error";

export const usageError = usageErrors<{
  readonly unknown_command: { readonly name: string; readonly usage: string };
  readonly wrong_arity: {
    readonly command: string;
    readonly min: number;
    readonly max: number;
    readonly got: readonly string[];
    readonly usage: string;
  };
  readonly unknown_gate: { readonly names: readonly string[]; readonly usage: string };
  readonly flag_misplaced: { readonly flag: string; readonly usage: string };
  readonly fill_malformed: {
    readonly flag: string;
    readonly value: string;
    readonly form: string;
    readonly usage: string;
  };
}>({
  unknown_command: {
    message: ({ name }) => `${name} is not an agent-gates command; agent-gates with no command lists them`,
    resolve: ({ usage }) => usage,
  },
  wrong_arity: {
    message: ({ command, min, max, got }) =>
      `agent-gates ${command} takes ${min === max ? `${min}` : `${min} to ${max}`} argument(s), and got ${got.length}: ${got.join(" ")}`,
    resolve: ({ usage }) => usage,
  },
  flag_misplaced: {
    message: ({ flag }) =>
      `agent-gates install takes ${flag} once, followed by its value, and only with a gate that runs it named, or with none named and one installed`,
    resolve: ({ usage }) => usage,
  },
  fill_malformed: {
    message: ({ flag, value, form }) => `agent-gates install takes ${flag} as ${form}, and got ${value}`,
    resolve: ({ usage }) => usage,
  },
  unknown_gate: {
    message: ({ names }) => `agent-gates install has no gate named ${names.join(", ")}`,
    resolve: ({ usage }) => usage,
  },
});

export const FULL_FLAG = "--full";

export function fullOf(args: readonly string[]): {
  readonly full: boolean;
  readonly rest: readonly string[];
} {
  const rest = args.filter((arg) => arg !== FULL_FLAG);
  return { full: rest.length < args.length, rest };
}

export function checkArity(
  args: readonly string[],
  [min, max]: readonly [min: number, max: number],
  { name, usage }: Pick<Command, "name" | "usage">,
): void {
  if (args.length < min || args.length > max)
    throw usageError("wrong_arity", { command: name, min, max, got: args, usage });
}
