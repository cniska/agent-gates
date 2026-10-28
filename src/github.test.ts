import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoVisibility } from "./github";
import { removeScratchDirs, repo, scratchDir } from "./repo.test-support";

afterEach(removeScratchDirs);

const TOKEN_URL = "https://x-access-token:test-token-value@github.com/acme/app.git";

function ghStub(script: string): string {
  const path = join(scratchDir(), "gh");
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
  return path;
}

function checkoutWithOrigin(url: string): string {
  const dir = repo();
  execFileSync("git", ["-C", dir, "remote", "add", "origin", url]);
  return dir;
}

describe("repoVisibility", () => {
  test("reads gh's answer for the origin URL as private or public", () => {
    const dir = checkoutWithOrigin(TOKEN_URL);
    const answering = ghStub(
      `[ "$*" = "repo view ${TOKEN_URL} --json isPrivate --jq .isPrivate" ] || exit 2\necho true`,
    );
    expect(repoVisibility(dir, { program: answering, timeoutMs: 10_000 })).toEqual({ kind: "private" });
    const open = ghStub("echo false");
    expect(repoVisibility(dir, { program: open, timeoutMs: 10_000 })).toEqual({ kind: "public" });
  });

  test("names a failed read without the origin URL, so a token in it never prints", () => {
    const dir = checkoutWithOrigin(TOKEN_URL);
    const failing = ghStub('echo "could not read $3" >&2\nexit 4');
    expect(repoVisibility(dir, { program: failing, timeoutMs: 10_000 })).toEqual({
      kind: "unreadable",
      detail: "gh repo view of origin exited 4: could not read origin",
    });
  });

  test("stops waiting on a gh that does not answer in time", () => {
    const dir = checkoutWithOrigin(TOKEN_URL);
    const silent = ghStub("exec sleep 5");
    expect(repoVisibility(dir, { program: silent, timeoutMs: 1 })).toEqual({
      kind: "unreadable",
      detail: "gh did not answer within 1 ms",
    });
  });

  test("names the signal that ended gh", () => {
    const dir = checkoutWithOrigin(TOKEN_URL);
    const killed = ghStub("kill -TERM $$");
    expect(repoVisibility(dir, { program: killed, timeoutMs: 10_000 })).toEqual({
      kind: "unreadable",
      detail: "gh repo view of origin was killed by SIGTERM",
    });
  });

  test("reads nothing without an origin remote, and says so", () => {
    const dir = repo();
    execFileSync("git", ["-C", dir, "remote", "add", "upstream", "https://github.com/acme/app.git"]);
    const never = ghStub("exit 2");
    expect(repoVisibility(dir, { program: never, timeoutMs: 10_000 })).toEqual({
      kind: "unreadable",
      detail: "the checkout has no origin remote",
    });
  });
});
