import type { Command } from "./cli-contract";
import { doctorCommand } from "./doctor-command";
import { installCommand } from "./install-command";

export const COMMANDS: readonly Command[] = [installCommand, doctorCommand];

export const COMMAND_NAMES: readonly string[] = COMMANDS.map(({ name }) => name);

export function findCommand(name: string | undefined): Command | undefined {
  return COMMANDS.find((command) => command.name === name);
}
