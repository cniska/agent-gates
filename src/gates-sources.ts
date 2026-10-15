import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { GATES } from "./gates-contract";

export const SOURCE_DIR = resolve(import.meta.dir, "..", "gates");

export function gateSources(): Readonly<Record<string, string>> {
  const sources = new Set(Object.values(GATES).flatMap((files) => files.map(({ source }) => source)));
  return Object.fromEntries(
    [...sources].map((source) => [source, readFileSync(join(SOURCE_DIR, source), "utf8")]),
  );
}
