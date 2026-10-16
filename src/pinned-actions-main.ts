import { checkoutRoot } from "./git";
import { unpinnedIn } from "./pinned-actions-judge";
import { annotations, reply } from "./pinned-actions-report";
import { formatOf, JUDGED_FORMS, judgedOf, run, scopeOf, usageError } from "./scanner-call";

run("pinned-actions", () => {
  const args = process.argv.slice(2);
  const call = formatOf(args);
  const target = call === null ? null : judgedOf(call.rest);
  if (call === null || target === null) throw usageError(JUDGED_FORMS, args);
  const found = unpinnedIn(checkoutRoot(process.cwd()), target);
  const scope = scopeOf(target);
  return {
    format: call.format,
    reply: (maxBytes) => reply(found, scope, maxBytes),
    annotations: annotations(found),
    refused: found.length > 0,
  };
});
