import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathOf, removeScratchDirs, scratchDir } from "./cli";

afterEach(removeScratchDirs);

function executable(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, "#!/bin/sh\n");
  chmodSync(path, 0o755);
  return path;
}

function shimDir(root: string, tool: string): string {
  const launcher = executable(join(root, "launcher"), "mise");
  const shims = join(root, "shims");
  mkdirSync(shims);
  symlinkSync(launcher, join(shims, tool));
  return shims;
}

describe("pathOf links each tool past launcher shims", () => {
  test("links the first executable whose target is not a file named mise", () => {
    const root = scratchDir();
    const shims = shimDir(root, "jq");
    const real = executable(join(root, "bin"), "jq");
    const bin = pathOf(["jq"], `${shims}:${join(root, "bin")}`);
    expect(readlinkSync(join(bin, "jq"))).toBe(real);
  });

  test("refuses a tool whose only hit is a shim", () => {
    const root = scratchDir();
    const shims = shimDir(root, "jq");
    expect(() => pathOf(["jq"], shims)).toThrow("jq is not on PATH");
  });
});
