import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { invariant } from "./assert";
import { bundled } from "./gate-bundles";
import { removeScratchDirs, scratchDir } from "./repo.test-support";

afterEach(removeScratchDirs);

const ROOT = join(import.meta.dir, "..");

const OXLINT = join(ROOT, "node_modules", ".bin", "oxlint");

const OXLINT_CONFIG = join(ROOT, ".oxlintrc.json");

const ESLINT_DISABLE = "/* eslint-disable */\n";

type LintRun = { readonly files: number; readonly diagnostics: number };

function lintRunOf(stdout: string): LintRun {
  const report: unknown = JSON.parse(stdout);
  invariant(typeof report === "object" && report !== null, `oxlint prints a report: ${stdout}`);
  const files = "number_of_files" in report ? report.number_of_files : null;
  const diagnostics = "diagnostics" in report ? report.diagnostics : null;
  invariant(typeof files === "number", `oxlint's report counts its files: ${stdout}`);
  invariant(Array.isArray(diagnostics), `oxlint's report lists its diagnostics: ${stdout}`);
  return { files, diagnostics: diagnostics.length };
}

function oxlint(bundles: Readonly<Record<string, string>>): LintRun {
  const dir = scratchDir();
  const files = Object.entries(bundles).map(([source, text]) => {
    const file = source.replaceAll("/", "-");
    writeFileSync(join(dir, file), text);
    return file;
  });
  const run = spawnSync(OXLINT, ["-c", OXLINT_CONFIG, "--deny-warnings", "--format", "json", ...files], {
    cwd: dir,
    encoding: "utf8",
  });
  expect(run.error).toBeUndefined();
  return lintRunOf(run.stdout);
}

describe("the gate bundles", () => {
  test("pass this repo's oxlint whole, through their eslint-disable header", async () => {
    const bundles = await bundled();
    const count = Object.keys(bundles).length;
    expect(count).toBeGreaterThan(0);
    expect(oxlint(bundles)).toEqual({ files: count, diagnostics: 0 });

    const headless = Object.fromEntries(
      Object.entries(bundles).map(([source, text]) => {
        expect(text).toContain(ESLINT_DISABLE);
        return [source, text.replace(ESLINT_DISABLE, "")];
      }),
    );
    const unguarded = oxlint(headless);
    expect(unguarded.files).toBe(count);
    expect(unguarded.diagnostics).toBeGreaterThan(0);
  });
});
