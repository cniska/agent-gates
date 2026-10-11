import { parseArgs } from "./cli-args";
import { type Command, Ran, UsageError } from "./cli-contract";
import { installGates } from "./gates";
import { GATE_NAMES, isGateName } from "./gates-contract";
import { checkoutRoot } from "./git";

export const installCommand: Command = {
  name: "install",
  usage: `agent-gates install [<gate>...], choosing from ${GATE_NAMES.join(", ")}`,
  summary: "install the named gates, and bring the installed ones up to date",
  run(args) {
    const positionals = parseArgs(args, [0, GATE_NAMES.length], this);
    const unknown = positionals.filter((name) => !isGateName(name));
    if (unknown.length > 0)
      throw new UsageError(`agent-gates install has no gate named ${unknown.join(", ")}`, this.usage);
    return new Ran(installGates(checkoutRoot(process.cwd()), positionals.filter(isGateName)), 0);
  },
};
