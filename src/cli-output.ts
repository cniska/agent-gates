import { type ErrorRecord, recordOf } from "./coded-error";

export function writeResult(command: string, value: unknown): void {
  process.stdout.write(`${JSON.stringify({ command, ok: true, result: value ?? null })}\n`);
}

export function writeError(command: string, error: unknown): ErrorRecord {
  const record = recordOf(error);
  process.stderr.write(`${JSON.stringify({ command, ok: false, error: record })}\n`);
  return record;
}
