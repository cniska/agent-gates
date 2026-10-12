import { type Command, refuseUsage } from "./cli-contract";

export function checkArity(
  args: readonly string[],
  [min, max]: readonly [min: number, max: number],
  { name, usage }: Pick<Command, "name" | "usage">,
): void {
  if (args.length < min || args.length > max)
    throw refuseUsage("wrong_arity", { command: name, min, max, got: args, usage });
}
