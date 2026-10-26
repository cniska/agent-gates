import { checkArity, FULL_FLAG, fullOf } from "./cli-args";
import type { Command } from "./cli-contract";
import { gatesDoctor, type Health } from "./doctor";
import { checkoutRoot } from "./git";

function checkRecord(check: Health) {
  const fix = check.state === "ok" ? null : check.fix;
  return { name: check.name, state: check.state, detail: check.detail, fix };
}

export const doctorCommand: Command = {
  name: "doctor",
  usage: `agent-gates doctor [${FULL_FLAG}]`,
  summary: "judge each installed gate file and the hook wiring, naming the fix for each problem",
  run(args) {
    const { full, rest } = fullOf(args);
    checkArity(rest, [0, 0], this);
    const { counts, checks } = gatesDoctor(checkoutRoot(process.cwd()));
    const listed = full ? checks : checks.filter(({ state }) => state !== "ok");
    return { value: { counts, checks: listed.map(checkRecord) }, exitCode: counts.fail === 0 ? 0 : 1 };
  },
};
