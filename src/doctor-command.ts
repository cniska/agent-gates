import { checkArity, FULL_FLAG, fullOf } from "./cli-args";
import type { Command } from "./cli-contract";
import { gatesDoctor, type Health } from "./doctor";
import { checkoutRoot } from "./git";

function fullCheck(check: Health) {
  const fix = check.state === "ok" ? null : check.fix;
  return { name: check.name, state: check.state, detail: check.detail, fix };
}

function fixes(checks: readonly Health[]) {
  return checks.flatMap((check) => (check.state === "ok" ? [] : [{ name: check.name, fix: check.fix }]));
}

export const doctorCommand: Command = {
  name: "doctor",
  usage: `agent-gates doctor [${FULL_FLAG}]`,
  summary: "judge each installed gate file and the hook wiring, naming the fix for each problem",
  run(args) {
    const { full, rest } = fullOf(args);
    checkArity(rest, [0, 0], this);
    const { counts, checks } = gatesDoctor(checkoutRoot(process.cwd()));
    const exitCode = counts.fail === 0 ? 0 : 1;
    if (full) return { value: { counts, checks: checks.map(fullCheck) }, exitCode };
    const listed = checks.map(({ name, state, detail }) => ({ name, state, detail }));
    return { value: { counts, checks: listed, fixes: fixes(checks) }, exitCode };
  },
};
