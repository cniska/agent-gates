#!/usr/bin/env bun
import { COMMAND_NAMES, COMMANDS, findCommand } from "./cli-commands";
import { UsageError } from "./cli-contract";
import { listing, writeError, writeResult } from "./cli-output";

const [name, ...args] = process.argv.slice(2);
const command = findCommand(name);

if (name === undefined) {
  writeResult("agent-gates", listing(COMMANDS));
  process.exitCode = 0;
} else if (command === undefined) {
  writeError(
    "agent-gates",
    new UsageError(
      `${name} is not an agent-gates command; agent-gates with no command lists them`,
      `agent-gates ${COMMAND_NAMES.join("|")}`,
    ),
  );
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
