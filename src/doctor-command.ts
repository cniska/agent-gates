import { parseArgs } from "./cli-args";
import { type Command, Ran } from "./cli-contract";
import { gatesDoctor } from "./doctor";
import { checkoutRoot } from "./git";

export const doctorCommand: Command = {
  name: "doctor",
  usage: "agent-gates doctor",
  summary: "judge each installed gate file and the hook wiring, naming the fix for each problem",
  run(args) {
    parseArgs(args, [0, 0], this);
    const report = gatesDoctor(checkoutRoot(process.cwd()));
    return new Ran(report, report.failing === 0 ? 0 : 1);
  },
};
