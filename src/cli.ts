#!/usr/bin/env bun
import { usageError } from "./cli-args";
import { COMMANDS } from "./cli-commands";
import type { Command } from "./cli-contract";
import { exitWithError, exitWithResult } from "./cli-output";

const [name, ...args] = process.argv.slice(2);

if (name === undefined)
  exitWithResult(
    "agent-gates",
    { commands: COMMANDS.map(({ name, usage, summary }) => ({ name, usage, summary })) },
    0,
  );

const command = COMMANDS.find((known) => known.name === name);

if (command === undefined)
  exitWithError(
    "agent-gates",
    usageError("unknown_command", {
      name,
      usage: `agent-gates ${COMMANDS.map(({ name }) => name).join("|")}`,
    }),
  );

function ranOrExited(command: Command): ReturnType<Command["run"]> {
  try {
    return command.run(args);
  } catch (error) {
    return exitWithError(command.name, error);
  }
}

const result = ranOrExited(command);
exitWithResult(command.name, result.value, result.exitCode);
