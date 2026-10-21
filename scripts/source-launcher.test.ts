import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { version } from "../package.json";
import { removeScratchDirs, scratchDir } from "../src/repo.test-support";

const LAUNCHER = resolve(import.meta.dir, "..", "bin", "agent-gates");

afterEach(removeScratchDirs);

function envWithDataHome(dataHome: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, XDG_DATA_HOME: dataHome };
  delete env.MISE_DATA_DIR;
  return env;
}

describe("the source launcher", () => {
  test("finds bun through mise when XDG_DATA_HOME points at an empty directory", () => {
    const run = spawnSync(LAUNCHER, ["--version"], {
      encoding: "utf8",
      env: envWithDataHome(scratchDir()),
    });
    expect([run.status, run.stdout, run.stderr]).toEqual([0, `${version}\n`, ""]);
  });
});
