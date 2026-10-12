#!/usr/bin/env bun
import { usageError } from "./cli-args";
import { COMMANDS } from "./cli-commands";
import { writeError, writeResult } from "./cli-output";
import { EXIT_STATUS } from "./coded-error";

const [name, ...args] = process.argv.slice(2);
const command = COMMANDS.find((known) => known.name === name);

if (name === undefined) {
  writeResult("agent-gates", {
    commands: COMMANDS.map(({ name, usage, summary }) => ({ name, usage, summary })),
  });
  process.exitCode = 0;
} else {
  try {
    if (command === undefined)
      throw usageError("unknown_command", {
        name,
        usage: `agent-gates ${COMMANDS.map(({ name }) => name).join("|")}`,
      });
    const ran = command.run(args);
    writeResult(command.name, ran.value);
    process.exitCode = ran.exitCode;
  } catch (error) {
    process.exitCode = EXIT_STATUS[writeError(command?.name ?? "agent-gates", error).kind];
  }
}
