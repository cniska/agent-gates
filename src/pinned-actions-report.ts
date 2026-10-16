import type { FileUses } from "./pinned-actions-judge";
import type { Scope } from "./scanner-call";
import { annotationsOf, counted, type Reported, replyOf, subjectOf } from "./scanner-report";

const GATE = "pinned-actions";

const CHANGE_SUBJECT = "this change holds";

const FIX =
  "Pin each to the commit SHA of its release, with the version as a trailing comment (owner/repo@<40 hex> # vX.Y.Z), or a docker:// image by its @sha256: digest.";

function unpinnedCount(found: readonly FileUses[]): number {
  return found.reduce((sum, { unpinned }) => sum + unpinned.length, 0);
}

export function countsOf(found: readonly FileUses[], scope: Scope): string {
  const count = unpinnedCount(found);
  const subject = subjectOf(scope, CHANGE_SUBJECT);
  if (count === 0) return `${subject} no unpinned action`;
  return `${subject} ${counted(count, "unpinned action", "unpinned actions")}`;
}

function headerOf(found: readonly FileUses[], scope: Scope): string {
  return `${GATE}: ${countsOf(found, scope)}. ${FIX}`;
}

function reported({ path, unpinned }: FileUses): Reported {
  return { path, findings: unpinned.map(({ line, ref }) => ({ line, text: ref })) };
}

export function reply(found: readonly FileUses[], scope: Scope, maxBytes: number | null): string {
  return replyOf(headerOf(found, scope), found.map(reported), maxBytes);
}

export function annotations(found: readonly FileUses[]): string {
  return annotationsOf(GATE, found.map(reported));
}
