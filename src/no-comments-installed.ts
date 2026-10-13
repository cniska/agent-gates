import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { invariant } from "./assert";
import type { Adapter, Comment, Reading } from "./no-comments-adapter";
import type { Language } from "./no-comments-languages";
import type { AdapterOf } from "./no-comments-scan";

const SCANNER = "scan.cjs";

export const SWEEP_ALL = "--all";

function isComment(value: unknown): value is Comment {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "line") === "number" &&
    typeof Reflect.get(value, "text") === "string"
  );
}

function isReading(value: unknown): value is Reading {
  if (typeof value !== "object" || value === null) return false;
  switch (Reflect.get(value, "kind")) {
    case "read": {
      const comments: unknown = Reflect.get(value, "comments");
      return Array.isArray(comments) && comments.every(isComment);
    }
    case "unparsed":
      return (
        typeof Reflect.get(value, "line") === "number" && typeof Reflect.get(value, "reason") === "string"
      );
    default:
      return false;
  }
}

function isFormList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((form) => typeof form === "string");
}

function adapterAt(path: string, load: NodeJS.Require): Adapter | null {
  if (!existsSync(path)) return null;
  const module = Object(load(path));
  const comments: unknown = Reflect.get(module, "comments");
  const kept: unknown = Reflect.get(module, "kept");
  invariant(typeof comments === "function", `${path} exports comments()`);
  invariant(isFormList(kept), `${path} exports the comment forms it keeps`);
  return {
    comments: (file, text) => {
      const reading: unknown = Reflect.apply(comments, undefined, [file, text]);
      invariant(isReading(reading), `${path} returns the comments it read, or where the file stops parsing`);
      return reading;
    },
    kept,
  };
}

export function adaptersBeside(dir: string): AdapterOf {
  const load = createRequire(join(dir, SCANNER));
  const loaded = new Map<Language, Adapter | null>();
  return (language) => {
    const known = loaded.get(language);
    if (known !== undefined) return known;
    const adapter = adapterAt(join(dir, `${language}.cjs`), load);
    loaded.set(language, adapter);
    return adapter;
  };
}
