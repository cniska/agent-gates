import { checkArity, usageError } from "./cli-args";
import type { Command } from "./cli-contract";
import { GATE_NAMES, type GateName, isGateName } from "./gate-parts";
import { installGates, trackedLanguageGates } from "./gates";
import { EACH_TRACKED_LANGUAGE, INSTALL_USAGE } from "./gates-contract";
import { checkoutRoot } from "./git";

type Named = { readonly gates: readonly GateName[]; readonly eachTrackedLanguage: boolean };

function namedIn(args: readonly string[], usage: string): Named {
  const gates: GateName[] = [];
  const unknown: string[] = [];
  let eachTrackedLanguage = false;
  for (const name of args) {
    if (name === EACH_TRACKED_LANGUAGE) eachTrackedLanguage = true;
    else if (isGateName(name)) gates.push(name);
    else unknown.push(name);
  }
  if (unknown.length > 0) throw usageError("unknown_gate", { names: unknown, usage });
  return { gates, eachTrackedLanguage };
}

export const installCommand: Command = {
  name: "install",
  usage: INSTALL_USAGE,
  summary: "install the named gates, and bring the installed ones up to date",
  run(args) {
    checkArity(args, [0, GATE_NAMES.length + 1], this);
    const named = namedIn(args, this.usage);
    const root = checkoutRoot(process.cwd());
    const tracked = named.eachTrackedLanguage ? trackedLanguageGates(root) : [];
    return { value: installGates(root, [...named.gates, ...tracked]), exitCode: 0 };
  },
};
