import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import { importsOf, readsEnv } from "./syntax.test-support";

const SRC = import.meta.dir;

const PUBLIC_FILES: Readonly<Record<string, readonly string[]>> = {
  assert: ["assert"],
  cli: ["cli-args", "cli-contract"],
  "coded-error": ["coded-error"],
  doctor: ["doctor", "doctor-command"],
  "file-backup": ["file-backup"],
  gate: ["gate-bundles", "gate-marker", "gate-parts"],
  gates: ["gates", "gates-contract", "gates-sources"],
  git: ["git"],
  install: ["install-command"],
  "no-comments": [
    "no-comments-installed",
    "no-comments-languages",
    "no-comments-report",
    "no-comments-scan",
    "no-comments-tracked",
  ],
  "no-secrets": ["no-secrets-change", "no-secrets-judge", "no-secrets-report", "no-secrets-rules"],
  "package-manifest": ["package-manifest"],
  "pinned-actions": ["pinned-actions-judge", "pinned-actions-report"],
  scanner: ["scanner-call", "scanner-change", "scanner-report"],
};

const TEST_SUPPORT = ".test-support";

const ENTRIES: readonly string[] = [
  "cli.ts",
  "no-comments-main.ts",
  "no-secrets-main.ts",
  "pinned-actions-main.ts",
];

const LOCAL_FILE = /^\.\/([a-z.-]+?)(?:\.ts)?$/;

function moduleOf(name: string): string | null {
  const owners = Object.keys(PUBLIC_FILES).filter(
    (prefix) => name === prefix || name.startsWith(`${prefix}-`),
  );
  return owners.sort((a, b) => b.length - a.length)[0] ?? null;
}

function nameOf(file: string): string {
  return file.replace(/(\.test|\.test-support)?\.ts$/, "");
}

function boundaryBreaches(file: string, text: string): readonly string[] {
  const importer = moduleOf(nameOf(file));
  const isTest = file.endsWith(".test.ts");
  return importsOf(text).flatMap((path) => {
    const local = LOCAL_FILE.exec(path);
    if (local === null) return [];
    const [, name = ""] = local;
    if (name.endsWith(TEST_SUPPORT)) return isTest ? [] : [`${file} imports ${path}, a test's support`];
    const owner = moduleOf(name);
    if (owner === null) return [`${file} imports ${path}, which no module owns`];
    if (owner === importer || PUBLIC_FILES[owner]?.includes(name)) return [];
    return [`${file} imports ${path}, another module's own file`];
  });
}

function isSource(file: string): boolean {
  return !file.endsWith(".test.ts") && !file.endsWith(`${TEST_SUPPORT}.ts`);
}

function filesOf(pattern: string): readonly { readonly file: string; readonly text: string }[] {
  return [...new Glob(pattern).scanSync(SRC)].sort().map((file) => ({
    file,
    text: readFileSync(join(SRC, file), "utf8"),
  }));
}

describe("the modules", () => {
  test("another module or a test reaches a module only through its public files", () => {
    const checked = filesOf("*.ts").filter(({ file }) => !file.endsWith(`${TEST_SUPPORT}.ts`));
    expect(checked.flatMap(({ file, text }) => boundaryBreaches(file, text))).toEqual([]);
  });

  test("every source file belongs to a listed module, and every public file exists", () => {
    const sources = filesOf("*.ts")
      .map(({ file }) => file)
      .filter(isSource);
    expect(sources.filter((file) => moduleOf(nameOf(file)) === null)).toEqual([]);
    const names = new Set(sources.map(nameOf));
    expect(
      Object.values(PUBLIC_FILES)
        .flat()
        .filter((name) => !names.has(name)),
    ).toEqual([]);
  });

  test("only an entry reads the environment", () => {
    const below = filesOf("*.ts").filter(({ file }) => isSource(file) && !ENTRIES.includes(file));
    expect(below.filter(({ text }) => readsEnv(text)).map(({ file }) => file)).toEqual([]);
  });
});

describe("the environment check", () => {
  test("catches a read however it is written", () => {
    for (const text of [
      "const home = process.env.HOME;",
      'const home = process.env["HOME"];',
      'const home = process["env"].HOME;',
      "const home = process?.env.HOME;",
      "const { env } = process;",
      "const { env: vars } = process;",
      'import { env } from "node:process";',
      'import { env as vars } from "process";',
      'import process from "node:process";\nconst home = process.env.HOME;',
      "const home = Bun.env.HOME;",
      "const home = import.meta.env.HOME;",
    ]) {
      expect(readsEnv(text)).toBe(true);
    }
  });

  test("passes the rest of process and an env passed in", () => {
    for (const text of [
      "const root = process.cwd();",
      "process.exitCode = 1;",
      "function run(env: Env) { return env.HOME; }",
      'import { argv } from "node:process";',
      "const { argv } = process;",
    ]) {
      expect(readsEnv(text)).toBe(false);
    }
  });
});

describe("the module check", () => {
  test("catches an import however it is written", () => {
    const breach = "doctor.ts imports ./no-comments-spans, another module's own file";
    for (const text of [
      'import { firstLine } from "./no-comments-spans";',
      'import { type Stopped } from "./no-comments-spans";',
      'import type { Stopped } from "./no-comments-spans";',
      'export type { Stopped } from "./no-comments-spans";',
      'export * from "./no-comments-spans";',
      'import type {\n  Stopped,\n} from\n  "./no-comments-spans";',
      'const spans = await import("./no-comments-spans");',
      "const spans = await import(`./no-comments-spans`);",
      'const spans = require("./no-comments-spans");',
      'let x: import("./no-comments-spans").Stopped;',
      'import spans = require("./no-comments-spans");',
    ]) {
      expect(boundaryBreaches("doctor.ts", text)).toEqual([breach]);
    }
    expect(boundaryBreaches("doctor.ts", 'import { firstLine } from "./no-comments-spans.ts";')).toEqual([
      "doctor.ts imports ./no-comments-spans.ts, another module's own file",
    ]);
  });

  test("passes a module's own files and another module's public files", () => {
    const text =
      'import { a } from "./no-comments-spans";\nimport { b } from "./gate-marker";\n' +
      'import { c } from "./git";\nimport { d } from "node:fs";\n';
    expect(boundaryBreaches("no-comments-scan.ts", text)).toEqual([]);
  });

  test("tells a module from a longer one that shares its prefix", () => {
    expect(boundaryBreaches("gate-parts.ts", 'import { a } from "./gates-private";')).toEqual([
      "gate-parts.ts imports ./gates-private, another module's own file",
    ]);
    expect(boundaryBreaches("cli-commands.ts", 'import { a } from "./cli-output";')).toEqual([]);
  });

  test("holds a test to the same boundary", () => {
    expect(boundaryBreaches("gates.test.ts", 'import { a } from "./cli-output";')).toEqual([
      "gates.test.ts imports ./cli-output, another module's own file",
    ]);
    expect(boundaryBreaches("no-comments.test.ts", 'import { a } from "./no-comments-spans";')).toEqual([]);
  });

  test("catches a file no module owns", () => {
    expect(boundaryBreaches("doctor.ts", 'import { a } from "./stray";')).toEqual([
      "doctor.ts imports ./stray, which no module owns",
    ]);
  });

  test("lets only a test import a test's support", () => {
    const text = 'import { repo } from "./repo.test-support";';
    expect(boundaryBreaches("git.ts", text)).toEqual([
      "git.ts imports ./repo.test-support, a test's support",
    ]);
    expect(boundaryBreaches("git.test.ts", text)).toEqual([]);
  });
});
