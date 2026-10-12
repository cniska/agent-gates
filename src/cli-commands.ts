import type { Command } from "./cli-contract";
import { doctorCommand } from "./doctor-command";
import { installCommand } from "./install-command";

export const COMMANDS: readonly Command[] = [installCommand, doctorCommand];
