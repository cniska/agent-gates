import { checkArity, usageError } from "./cli-args";
import type { Command } from "./cli-contract";
import { installGates } from "./gates";
import { GATE_NAMES, isGateName } from "./gates-contract";
import { checkoutRoot } from "./git";

export const installCommand: Command = {
  name: "install",
  usage: `agent-gates install [<gate>...], choosing from ${GATE_NAMES.join(", ")}`,
  summary: "install the named gates, and bring the installed ones up to date",
  run(args) {
    checkArity(args, [0, GATE_NAMES.length], this);
    const unknown = args.filter((name) => !isGateName(name));
    if (unknown.length > 0) throw usageError("unknown_gate", { names: unknown, usage: this.usage });
    return { value: installGates(checkoutRoot(process.cwd()), args.filter(isGateName)), exitCode: 0 };
  },
};
