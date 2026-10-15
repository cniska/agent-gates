#!/usr/bin/env bun
import { version } from "../package.json";
import { checkArity, usageError } from "./cli-args";
import { COMMANDS } from "./cli-commands";
import type { Command } from "./cli-contract";
import { exitWithError, exitWithResult, exitWithVersion } from "./cli-output";

const VERSION_FLAG = "--version";

const [name, ...args] = process.argv.slice(2);

if (name === undefined)
  exitWithResult(
    "agent-gates",
    { commands: COMMANDS.map(({ name, usage, summary }) => ({ name, usage, summary })) },
    0,
  );

function versionOrExited(): string {
  try {
    checkArity(args, [0, 0], { name: VERSION_FLAG, usage: `agent-gates ${VERSION_FLAG}` });
    return version;
  } catch (error) {
    return exitWithError("agent-gates", error);
  }
}

if (name === VERSION_FLAG) exitWithVersion(versionOrExited());

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
