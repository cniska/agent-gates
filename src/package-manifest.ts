import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Refusal, refusals } from "./coded-error";
import { PAST_PREPARES, PREPARE } from "./gates-contract";

const JSON_INDENT = /^([ \t]+)"/m;

const DEFAULT_JSON_INDENT = "  ";

type JsonObject = Readonly<Record<string, unknown>>;

type Parsed =
  | { readonly parsed: true; readonly value: unknown }
  | { readonly parsed: false; readonly detail: string };

const manifestRefusal = refusals<{
  readonly manifest_unparseable: { readonly path: string; readonly detail: string };
  readonly prepare_occupied: { readonly path: string; readonly prepare: string; readonly wanted: string };
}>({
  manifest_unparseable: {
    message: ({ path, detail }) =>
      `${path} does not parse, so what the project declares is unknown: ${detail}`,
    resolve: ({ path }) => `stop and hand this error to the owner: ${path} must parse`,
  },
  prepare_occupied: {
    message: ({ path, prepare }) =>
      `${path} runs \`${prepare}\` as its prepare script, so a fresh clone would not wire the hooks`,
    resolve: ({ path, wanted }) =>
      `stop and hand this error to the owner: ${path}'s prepare script must become \`${wanted}\` before the gates install`,
  },
});

export type PrepareState =
  | { readonly kind: "absent" }
  | { readonly kind: "wired" }
  | { readonly kind: "missing" | "behind"; readonly path: string; readonly wired: string }
  | { readonly kind: "occupied" | "unparseable"; readonly refusal: Refusal };

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsedJson(text: string): Parsed {
  try {
    return { parsed: true, value: JSON.parse(text) };
  } catch (error) {
    return { parsed: false, detail: String(error) };
  }
}

function unparseable(path: string, detail: string): PrepareState {
  return { kind: "unparseable", refusal: manifestRefusal("manifest_unparseable", { path, detail }) };
}

export function prepareState(root: string): PrepareState {
  const path = join(root, "package.json");
  if (!existsSync(path)) return { kind: "absent" };
  const text = readFileSync(path, "utf8");
  const json = parsedJson(text);
  if (!json.parsed) return unparseable(path, json.detail);
  const fields = json.value;
  if (!isJsonObject(fields)) return unparseable(path, "the manifest is not an object");
  const scripts = fields.scripts ?? {};
  if (!isJsonObject(scripts)) return unparseable(path, "scripts is not an object");
  const found = scripts.prepare;
  if (found === PREPARE) return { kind: "wired" };
  if (found !== undefined && !PAST_PREPARES.some((earlier) => earlier === found)) {
    const refusal = manifestRefusal("prepare_occupied", {
      path,
      prepare: typeof found === "string" ? found : JSON.stringify(found),
      wanted: PREPARE,
    });
    return { kind: "occupied", refusal };
  }
  const indent = JSON_INDENT.exec(text)?.[1] ?? DEFAULT_JSON_INDENT;
  const wired = `${JSON.stringify({ ...fields, scripts: { ...scripts, prepare: PREPARE } }, null, indent)}\n`;
  return { kind: found === undefined ? "missing" : "behind", path, wired };
}
