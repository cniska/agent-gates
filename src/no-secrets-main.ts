import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { invariant } from "./assert";
import { checkoutRoot } from "./git";
import { rootRelative } from "./no-secrets-change";
import { secretsAdded } from "./no-secrets-judge";
import { annotations, reply } from "./no-secrets-report";
import { formatOf, JUDGED_FORMS, judgedOf, run, scopeOf, usageError } from "./scanner-call";

run("no-secrets", () => {
  const script = process.argv[1];
  invariant(script !== undefined, "node names the script it runs");
  const args = process.argv.slice(2);
  const call = formatOf(args);
  const target = call === null ? null : judgedOf(call.rest);
  if (call === null || target === null) throw usageError(JUDGED_FORMS, args);
  const root = checkoutRoot(process.cwd());
  const own = rootRelative(root, dirname(realpathSync(script)));
  const found = secretsAdded(root, target, own === null ? [] : [own]);
  const scope = scopeOf(target);
  return {
    format: call.format,
    reply: (maxBytes) => reply(found, scope, maxBytes),
    annotations: annotations(found),
    refused: found.length > 0,
  };
});
