import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type Channel, isChannel, isVersion } from "./update-channel";

export type Checked = { readonly at: number; readonly channel: Channel; readonly latest: string | null };

function parsed(text: string): Checked | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const at: unknown = Reflect.get(value, "at");
  const channel: unknown = Reflect.get(value, "channel");
  const latest: unknown = Reflect.get(value, "latest");
  if (typeof at !== "string" || !isChannel(channel)) return null;
  if (latest !== null && (typeof latest !== "string" || !isVersion(latest))) return null;
  const time = Date.parse(at);
  return Number.isNaN(time) ? null : { at: time, channel, latest };
}

export function checkedOrNull(file: string): Checked | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  return parsed(text);
}

export function recorded(file: string, checked: Checked): boolean {
  const text = `${JSON.stringify({ ...checked, at: new Date(checked.at).toISOString() })}\n`;
  const partial = `${file}.${process.pid}.partial`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(partial, text);
    renameSync(partial, file);
    return true;
  } catch {
    rmSync(partial, { force: true });
    return false;
  }
}
