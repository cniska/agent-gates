import { type Command, UsageError } from "./cli-contract";

export function parseArgs(
  args: readonly string[],
  [min, max]: readonly [min: number, max: number],
  { name, usage }: Pick<Command, "name" | "usage">,
): readonly string[] {
  if (args.length < min || args.length > max) {
    const wanted = min === max ? `${min}` : `${min} to ${max}`;
    throw new UsageError(
      `agent-gates ${name} takes ${wanted} argument(s), and got ${args.length}: ${args.join(" ")}`,
      usage,
    );
  }
  return args;
}
