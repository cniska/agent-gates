import { type Keep, keepRead } from "./no-comments-keep";

export function keepOf(text: string | null): Keep {
  const read = keepRead(text);
  if (read.kind === "malformed") throw read.refusal;
  return read.keep;
}
