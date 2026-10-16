import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { invariant } from "./assert";
import { checkoutRoot } from "./git";
import { fileChange } from "./no-comments-file";
import { adaptersBeside } from "./no-comments-installed";
import type { Language } from "./no-comments-languages";
import { annotations, reply } from "./no-comments-report";
import { findings, type JudgedChange, judgedChange, keptIn } from "./no-comments-scan";
import {
  type Form,
  formatOf,
  JUDGED_FORMS,
  judgedOf,
  run,
  type Scope,
  scopeOf,
  usageError,
} from "./scanner-call";
import type { Judged } from "./scanner-change";

const ONE_FILE = "--file";

const FORMS: readonly Form[] = [
  ...JUDGED_FORMS,
  { said: `${ONE_FILE} and a path`, syntax: `${ONE_FILE} <path>` },
];

type Target = Judged | { readonly kind: "file"; readonly absolute: string };

function targetOf(rest: readonly string[]): Target | null {
  const [flag, path] = rest;
  if (rest.length === 2 && flag === ONE_FILE && path !== undefined)
    return { kind: "file", absolute: resolve(path) };
  return judgedOf(rest);
}

function scopeOfTarget(target: Target): Scope {
  return target.kind === "file" ? "change" : scopeOf(target);
}

function changeOf(root: string, target: Target): JudgedChange {
  if (target.kind === "file") return fileChange(root, target.absolute);
  return judgedChange(root, target);
}

run("no-comments", () => {
  const script = process.argv[1];
  invariant(script !== undefined, "node names the script it runs");
  const args = process.argv.slice(2);
  const call = formatOf(args);
  const target = call === null ? null : targetOf(call.rest);
  if (call === null || target === null) throw usageError(FORMS, args);
  const root = checkoutRoot(process.cwd());
  const adapterOf = adaptersBeside(dirname(realpathSync(script)));
  const found = findings(changeOf(root, target), adapterOf);
  const keptOf = (language: Language) => keptIn(adapterOf, language);
  const scope = scopeOfTarget(target);
  return {
    format: call.format,
    reply: (maxBytes) => reply(found, scope, keptOf, maxBytes),
    annotations: annotations(found),
    refused: found.length > 0,
  };
});
