import { BUG, CodedError, type RefusalRecord, recordOf } from "./coded-error";

function errorRecord(error: unknown): RefusalRecord {
  if (error instanceof CodedError) return recordOf(error);
  return {
    code: "unexpected",
    message: error instanceof Error ? error.message : String(error),
    meta: {},
    resolve: BUG,
  };
}

export function writeResult(command: string, value: unknown): void {
  process.stdout.write(`${JSON.stringify({ command, ok: true, result: value ?? null })}\n`);
}

export function writeError(command: string, error: unknown): void {
  process.stderr.write(`${JSON.stringify({ command, ok: false, error: errorRecord(error) })}\n`);
}
