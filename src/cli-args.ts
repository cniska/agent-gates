import type { Command } from "./cli-contract";
import { refuser } from "./coded-error";

export const refuseUsage = refuser<{
  readonly unknown_command: { readonly name: string; readonly usage: string };
  readonly wrong_arity: {
    readonly command: string;
    readonly min: number;
    readonly max: number;
    readonly got: readonly string[];
    readonly usage: string;
  };
  readonly unknown_gate: { readonly names: readonly string[]; readonly usage: string };
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
  unknown_gate: {
    message: ({ names }) => `agent-gates install has no gate named ${names.join(", ")}`,
    resolve: ({ usage }) => usage,
  },
});

export function checkArity(
  args: readonly string[],
  [min, max]: readonly [min: number, max: number],
  { name, usage }: Pick<Command, "name" | "usage">,
): void {
  if (args.length < min || args.length > max)
    throw refuseUsage("wrong_arity", { command: name, min, max, got: args, usage });
}
