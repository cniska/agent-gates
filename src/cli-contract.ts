import { refuser } from "./coded-error";

export type Command = {
  name: string;
  usage: string;
  summary: string;
  run(args: readonly string[]): { readonly value: unknown; readonly exitCode: 0 | 1 };
};

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
