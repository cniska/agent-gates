import { afterEach, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  bypassing,
  commitAs,
  committing,
  git,
  gitRan,
  PASSED,
  readText,
  removeScratch,
  scratchDir,
  shell,
  writeFiles,
} from "./cli";
import { commentReply, gated, KEPT_JAVASCRIPT } from "./no-comments";

afterEach(removeScratch);

const NOT_CONVENTIONAL =
  "subject is not a Conventional Commit (type(scope): what changed); types: build,chore,ci,docs,feat,fix,perf,refactor,revert,style,test.";

test("AC-39 hands git's arguments and pushed refs to each executable pre-push step in name order, stopping at the first failure", () => {
  const dir = gated(["commit-subject"]);
  const logs = scratchDir();
  const log = join(logs, "log");
  const steps: Record<string, string> = {};
  for (const [name, status] of [
    ["20-second", 0],
    ["10-first", 0],
    ["15-not-executable", 0],
    ["30-fails", 7],
    ["40-after", 0],
  ] as const)
    steps[`.githooks/pre-push.d/${name}`] =
      `#!/bin/sh\necho "${name} $1 $2 $(cat)" >> '${log}'\nexit ${status}\n`;
  writeFiles(dir, steps);
  for (const path of Object.keys(steps))
    if (!path.endsWith("not-executable")) chmodSync(join(dir, path), 0o755);

  const pushed = "refs/heads/main abc refs/heads/main def";
  expect(shell(dir, ".githooks/pre-push origin /remote", {}, `${pushed}\n`)).toEqual({
    status: 7,
    stdout: "",
    stderr: "",
  });
  expect(readText(logs, "log")).toBe(
    ["10-first", "20-second", "30-fails"].map((name) => `${name} origin /remote ${pushed}\n`).join(""),
  );
});

function pushedClone(): { readonly clone: string; readonly remote: string } {
  const work = gated(["commit-subject", "no-comments-javascript"], { "old.ts": "export const old = 0;\n" });
  commitAs(work, "Add an old thing");
  const remote = join(scratchDir(), "remote.git");
  git(work, ["clone", "-q", "--bare", work, remote]);
  const clone = join(scratchDir(), "clone");
  git(work, ["clone", "-q", remote, clone]);
  git(clone, ["config", "core.hooksPath", ".githooks"]);
  return { clone, remote };
}

function tipOf(remote: string, ref: string): string {
  return gitRan(remote, ["rev-parse", "-q", "--verify", ref]).stdout.trim();
}

function pushRefused(clone: string, remote: string, refspec: string, reply: string): void {
  const ref = `refs/heads/${refspec.split(":").at(-1)}`;
  const before = tipOf(remote, ref);
  const ran = gitRan(clone, ["push", "-q", "origin", refspec]);
  expect([ran.status, ran.stderr.startsWith(reply)]).toEqual([1, true]);
  expect(tipOf(remote, ref)).toBe(before);
}

function pushes(clone: string, remote: string, refspec: string): void {
  const ran = gitRan(clone, ["push", "-q", "origin", refspec]);
  expect([ran.status, ran.stderr]).toEqual([0, ""]);
  const ref = `refs/heads/${refspec.split(":").at(-1)}`;
  const [local = ""] = refspec.split(":");
  expect(tipOf(remote, ref)).toBe(local === "" ? "" : git(clone, ["rev-parse", local]));
}

test("AC-40 judges each pushed ref's subjects and comments before the push leaves, as CI would", () => {
  const { clone, remote } = pushedClone();
  const start = git(clone, ["rev-parse", "HEAD"]);

  const fixup = join(scratchDir(), "message");
  writeFileSync(fixup, "fixup! chore: start\n");
  expect(committing(clone, ["-q", "--allow-empty", "-F", fixup])).toEqual(PASSED);
  const fixupSha = git(clone, ["rev-parse", "HEAD"]);
  pushRefused(
    clone,
    remote,
    "HEAD:main",
    `${fixupSha} is an autosquash commit left in the range; squash it into the commit it names.\n`,
  );

  git(clone, ["reset", "-q", "--hard", start]);
  commitAs(clone, "Add a new thing");
  pushRefused(clone, remote, "HEAD:main", `commit-msg: ${NOT_CONVENTIONAL}\n  got: Add a new thing\n`);

  git(clone, ["reset", "-q", "--hard", start]);
  writeFiles(clone, { "new.ts": "export const fresh = 1; // why\n" });
  git(clone, ["add", "-A"]);
  commitAs(clone, "feat: add a new thing");
  pushRefused(clone, remote, "HEAD:main", commentReply([KEPT_JAVASCRIPT], [["new.ts", ["1  // why"]]]));

  git(clone, ["reset", "-q", "--hard", start]);
  writeFiles(clone, { "new.ts": "export const fresh = 1;\n" });
  git(clone, ["add", "-A"]);
  commitAs(clone, "feat: add a new thing");
  pushes(clone, remote, "HEAD:main");

  git(clone, ["checkout", "-q", "-b", "feature"]);
  commitAs(clone, "feat: add a branch thing");
  pushes(clone, remote, "HEAD:feature");
  commitAs(clone, "Add a branch thing");
  pushRefused(clone, remote, "HEAD:feature", `commit-msg: ${NOT_CONVENTIONAL}\n  got: Add a branch thing\n`);

  git(clone, ["reset", "-q", "--hard", "HEAD~1"]);
  commitAs(clone, "feat: add another thing");
  bypassing(clone, ["push", "-q", "origin", "HEAD:refs/heads/other"]);
  pushes(clone, remote, ":other");

  for (const [workflow, gate] of [
    ["commits.yml", "commit-subject"],
    ["no-comments.yml", "no-comments"],
  ])
    expect(readText(clone, `.github/workflows/${workflow}`)).toContain(`sh .githooks/judge-push ${gate} `);
});
