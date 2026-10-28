#!/usr/bin/env bun
import { version } from "../package.json";
import { checkArity, usageError } from "./cli-args";
import { COMMANDS } from "./cli-commands";
import type { Command } from "./cli-contract";
import { exitWithError, exitWithResult, exitWithVersion } from "./cli-output";

const VERSION_FLAG = "--version";

const VERSION_USAGE = `agent-gates ${VERSION_FLAG}`;

const FLAGS = [{ name: VERSION_FLAG, usage: VERSION_USAGE, summary: "print the version alone on one line" }];

const [asked, ...args] = process.argv.slice(2);

if (asked === undefined)
  exitWithResult(
    "agent-gates",
    { commands: COMMANDS.map(({ name, usage, summary }) => ({ name, usage, summary })), flags: FLAGS },
    0,
  );

function versionOrExited(): string {
  try {
    checkArity(args, [0, 0], { name: VERSION_FLAG, usage: VERSION_USAGE });
    return version;
  } catch (error) {
    return exitWithError("agent-gates", error);
  }
}

if (asked === VERSION_FLAG) exitWithVersion(versionOrExited());

const command = COMMANDS.find((known) => known.name === asked);

if (command === undefined)
  exitWithError(
    "agent-gates",
    usageError("unknown_command", {
      name: asked,
      usage: `agent-gates ${[...COMMANDS.map(({ name }) => name), VERSION_FLAG].join("|")}`,
    }),
  );

function ranOrExited(chosen: Command): ReturnType<Command["run"]> {
  try {
    return chosen.run(args);
  } catch (error) {
    return exitWithError(chosen.name, error);
  }
}

const result = ranOrExited(command);
exitWithResult(command.name, result.value, result.exitCode);
