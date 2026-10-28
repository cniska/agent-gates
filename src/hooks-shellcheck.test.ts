import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GATE_NAMES } from "./gate-parts";
import { installGates } from "./gates";
import { GATES, NO_FILLS, type Workflows } from "./gates-contract";
import { removeScratchDirs, repo } from "./repo.test-support";

afterEach(removeScratchDirs);

function shellTargets(): readonly string[] {
  return [...new Set(Object.values(GATES).flatMap((files) => files.map(({ target }) => target)))];
}

function installedWith(workflows: Workflows): string {
  const dir = repo();
  installGates(dir, { kind: "gates", gates: [...GATE_NAMES] }, { ...NO_FILLS, command: "true", workflows });
  return dir;
}

describe("the hooks agent-gates generates", () => {
  for (const workflows of ["on", "off"] as const) {
    test(`pass shellcheck with the workflows choice recorded ${workflows}`, () => {
      const dir = installedWith(workflows);
      const hooks = shellTargets().filter((target) => {
        const path = join(dir, target);
        return existsSync(path) && /^#!.*[/ ](ba)?sh$/.test(readFileSync(path, "utf8").split("\n")[0] ?? "");
      });
      expect(hooks).toContain(".githooks/judge-push");
      const run = spawnSync("shellcheck", ["--severity=warning", ...hooks], {
        cwd: dir,
        encoding: "utf8",
      });
      expect(run.error).toBeUndefined();
      expect(run.stdout).toBe("");
      expect(run.status).toBe(0);
    });
  }
});
