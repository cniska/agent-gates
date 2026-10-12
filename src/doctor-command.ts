import { checkArity } from "./cli-args";
import type { Command } from "./cli-contract";
import { gatesDoctor } from "./doctor";
import { checkoutRoot } from "./git";

export const doctorCommand: Command = {
  name: "doctor",
  usage: "agent-gates doctor",
  summary: "judge each installed gate file and the hook wiring, naming the fix for each problem",
  run(args) {
    checkArity(args, [0, 0], this);
    const report = gatesDoctor(checkoutRoot(process.cwd()));
    return { value: report, exitCode: report.failing === 0 ? 0 : 1 };
  },
};
