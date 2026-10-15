import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const GUARDED_DIRS = [
  "src",
  "acceptance",
  "plugin",
  "scripts",
  "npm",
  "docs",
  "gates",
  "bin",
  ".github/workflows",
];

const GUARDED_FILES = ["SPEC.md", "README.md"];

const SELF = "scripts/standalone.test.ts";

const OTHER_TOOL = /\b(cniska-(skills|record|worktree)|agent-(record|worktree|skills))\b/g;

const MARKETPLACE = "cniska/agent-skills";

type Guarded = { readonly path: string; readonly text: string };

function inMarketplaceAddress(line: string, end: number): boolean {
  return line.slice(end - MARKETPLACE.length, end) === MARKETPLACE;
}

function namings({ path, text }: Guarded): readonly string[] {
  return text
    .split("\n")
    .flatMap((line, index) =>
      [...line.matchAll(OTHER_TOOL)]
        .filter(({ 0: match, index: start }) => !inMarketplaceAddress(line, start + match.length))
        .map(([match]) => `${path}:${index + 1} names another tool: ${match}`),
    );
}

function filesUnder(dir: string): readonly string[] {
  return [...new Bun.Glob("**/*").scanSync({ cwd: join(ROOT, dir), dot: true })].map((path) =>
    join(dir, path),
  );
}

function read(path: string): Guarded {
  return { path, text: readFileSync(join(ROOT, path), "utf8") };
}

function guardedFiles(): readonly Guarded[] {
  return [...GUARDED_DIRS.flatMap(filesUnder), ...GUARDED_FILES]
    .filter((path) => path !== SELF)
    .sort((a, b) => a.localeCompare(b))
    .map(read);
}

describe("the repo stands alone", () => {
  test("names no other tool", () => {
    expect(guardedFiles().flatMap(namings)).toEqual([]);
  });

  test("names another tool wherever it stands, its own names freely", () => {
    const text =
      "Try cniska-skills.\nagent-gates and cniska-gates, then agent-worktree\ncniska-record or agent-record";
    expect(namings({ path: "README.md", text })).toEqual([
      "README.md:1 names another tool: cniska-skills",
      "README.md:2 names another tool: agent-worktree",
      "README.md:3 names another tool: cniska-record",
      "README.md:3 names another tool: agent-record",
    ]);
  });

  test("lets the marketplace address alone name agent-skills", () => {
    const text = [
      "claude plugin marketplace add cniska/agent-skills",
      "claude plugin marketplace add made-up/agent-skills",
      "install agent-skills",
      "cniska/agent-worktree and cniska/cniska-skills",
    ].join("\n");
    expect(namings({ path: "docs/x.md", text })).toEqual([
      "docs/x.md:2 names another tool: agent-skills",
      "docs/x.md:3 names another tool: agent-skills",
      "docs/x.md:4 names another tool: agent-worktree",
      "docs/x.md:4 names another tool: cniska-skills",
    ]);
  });

  test("guards the sources, docs, gates and every workflow, but not itself", () => {
    const paths = guardedFiles().map(({ path }) => path);
    expect(paths).toContain("SPEC.md");
    expect(paths).toContain("README.md");
    expect(paths).toContain("docs/plugin.md");
    expect(paths).toContain("gates/commits.yml");
    expect(paths).toContain("bin/agent-gates");
    expect(paths).toContain("npm/agent-gates.cjs");
    expect(paths).toContain("scripts/install.sh");
    expect(paths).toContain(".github/workflows/release.yml");
    expect(paths).toContain(".github/workflows/commits.yml");
    expect(paths).not.toContain(SELF);
  });
});
