#!/usr/bin/env bun
import { refuseUsage } from "./cli-args";
import { COMMANDS } from "./cli-commands";
import { writeError, writeResult } from "./cli-output";

const [name, ...args] = process.argv.slice(2);
const command = COMMANDS.find((known) => known.name === name);

if (name === undefined) {
  writeResult("agent-gates", {
    commands: COMMANDS.map(({ name, usage, summary }) => ({ name, usage, summary })),
  });
  process.exitCode = 0;
} else if (command === undefined) {
  const usage = `agent-gates ${COMMANDS.map(({ name }) => name).join("|")}`;
  writeError("agent-gates", refuseUsage("unknown_command", { name, usage }));
  process.exitCode = 1;
} else {
  try {
    const ran = command.run(args);
    writeResult(command.name, ran.value);
    process.exitCode = ran.exitCode;
  } catch (error) {
    writeError(command.name, error);
    process.exitCode = 1;
  }
}
