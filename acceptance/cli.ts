import { expect } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

const IDENTITY =
  "[user]\n\tname = Acceptance\n\temail = acceptance@example.com\n[init]\n\tdefaultBranch = main\n";

type Ran = { readonly status: number | null; readonly stdout: string; readonly stderr: string };

export type Env = Readonly<Record<string, string>>;

export type Check = {
  readonly name: string;
  readonly state: string;
  readonly detail: string;
  readonly fix: string | null;
};

export type Outcome = { readonly status: number | null; readonly stderr: string; readonly made: boolean };

type Judged = { readonly status: number | null; readonly checks: readonly Check[] };

export const NO_COMMIT = "0".repeat(40);

const scratchDirs: string[] = [];

let home: string | null = null;

export function scratchDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "agent-gates-acceptance-")));
  scratchDirs.push(dir);
  return dir;
}

export function removeScratch(): void {
  home = null;
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

function gitHome(): string {
  if (home !== null) return home;
  home = scratchDir();
  writeFileSync(join(home, ".gitconfig"), IDENTITY);
  return home;
}

function hermetic(env: Env): Env {
  const at = gitHome();
  return {
    PATH: process.env.PATH ?? "",
    HOME: at,
    GIT_CONFIG_GLOBAL: join(at, ".gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    ...env,
  };
}

function run(command: string, args: readonly string[], cwd: string, env: Env = {}, input = ""): Ran {
  const ran = spawnSync(command, args, { cwd, env: hermetic(env), encoding: "utf8", input });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

export function agentGates(cwd: string, args: readonly string[], env: Env = {}): Ran {
  return run(process.execPath, [CLI, ...args], cwd, env);
}

export function jsonLine(text: string): unknown {
  const lines = text.split("\n");
  if (lines.length !== 2 || lines[1] !== "") throw new Error(`expected one JSON line, got: ${text}`);
  return JSON.parse(lines[0] ?? "");
}

export function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

export function doctor(dir: string): Judged {
  const ran = agentGates(dir, ["doctor"]);
  if (ran.stderr !== "") throw new Error(`doctor wrote to stderr: ${ran.stderr}`);
  const checks = field(field(jsonLine(ran.stdout), "result"), "checks");
  if (!Array.isArray(checks)) throw new Error(`doctor printed no checks: ${ran.stdout}`);
  return { status: ran.status, checks };
}

export function check(dir: string, name: string): Check | undefined {
  return doctor(dir).checks.find((found) => found.name === name);
}

export function install(dir: string, args: readonly string[]): void {
  const ran = agentGates(dir, ["install", ...args]);
  if (ran.status !== 0) throw new Error(`install ${args.join(" ")} exited ${ran.status}: ${ran.stderr}`);
}

export type FileResult = { readonly target: string; readonly state: string; readonly backup: string | null };

type Fills = {
  readonly command: string | null;
  readonly setup: string | null;
  readonly prefixes: string | null;
};

export type InstallResult = {
  readonly gates: readonly string[];
  readonly files: readonly FileResult[];
  readonly prepare: string;
  readonly fills?: Fills;
};

const NO_FILLS: Fills = { command: null, setup: null, prefixes: null };

export function each(state: string, targets: readonly string[]): FileResult[] {
  return targets.map((target) => ({ target, state, backup: null }));
}

export function installed(dir: string, args: readonly string[]): unknown {
  const ran = agentGates(dir, ["install", ...args]);
  expect([ran.status, ran.stderr]).toEqual([0, ""]);
  const reply = jsonLine(ran.stdout);
  expect([field(reply, "command"), field(reply, "ok")]).toEqual(["install", true]);
  return field(reply, "result");
}

export function installs(dir: string, args: readonly string[], result: InstallResult): void {
  expect(installed(dir, args)).toEqual({ fills: NO_FILLS, ...result });
}

export function refuses(dir: string, args: readonly string[], error: object): void {
  const ran = agentGates(dir, ["install", ...args]);
  expect([ran.status, ran.stdout]).toEqual([1, ""]);
  expect(jsonLine(ran.stderr)).toEqual({ command: "install", ok: false, error });
}

export function hooksPath(dir: string): string {
  return shell(dir, "git config --get core.hooksPath || true").stdout.trim();
}

export function gitRan(dir: string, args: readonly string[], env: Env = {}): Ran {
  return run("git", ["-C", dir, ...args], dir, env);
}

function commitCount(dir: string): string {
  return git(dir, ["rev-list", "--count", "HEAD"]);
}

export function committing(dir: string, args: readonly string[], env: Env = {}): Outcome {
  const before = commitCount(dir);
  const ran = gitRan(dir, ["commit", ...args], env);
  return { status: ran.status, stderr: ran.stderr, made: commitCount(dir) !== before };
}

export const PASSED: Outcome = { status: 0, stderr: "", made: true };

export function refusedWith(stderr: string): Outcome {
  return { status: 1, stderr, made: false };
}

export function git(dir: string, args: readonly string[]): string {
  const ran = gitRan(dir, args);
  if (ran.status !== 0) throw new Error(`git ${args.join(" ")} exited ${ran.status}: ${ran.stderr}`);
  return ran.stdout.trim();
}

export function bypassing(dir: string, args: readonly string[]): string {
  return git(dir, ["-c", "core.hooksPath=/dev/null", ...args]);
}

export function commitAs(dir: string, subject: string): string {
  bypassing(dir, ["commit", "-q", "--allow-empty", "-m", subject]);
  return git(dir, ["rev-parse", "HEAD"]);
}

export function cloneOf(dir: string): string {
  const clone = join(scratchDir(), "clone");
  git(dir, ["clone", "-q", dir, clone]);
  return clone;
}

export function shell(dir: string, script: string, env: Env = {}, input = ""): Ran {
  return run("sh", ["-c", script], dir, env, input);
}

export function pathOf(tools: readonly string[]): string {
  const bin = scratchDir();
  for (const tool of tools) {
    const found = shell(bin, `command -v ${tool}`).stdout.trim();
    if (!found.startsWith("/")) throw new Error(`${tool} is not on PATH`);
    symlinkSync(found, join(bin, tool));
  }
  return bin;
}

export function stepScript(workflow: string, name: string): string {
  const jobs = field(Bun.YAML.parse(workflow), "jobs");
  const steps =
    typeof jobs === "object" && jobs !== null
      ? Object.values(jobs).flatMap((job) => field(job, "steps"))
      : [];
  const script = field(
    steps.find((step) => field(step, "name") === name),
    "run",
  );
  if (typeof script !== "string")
    throw new Error(`the workflow has no step named ${name} that runs a script`);
  return script;
}

export function githubStep(dir: string, script: string, env: Env): Ran {
  return run("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], dir, env);
}

export function writeFiles(dir: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}

export function readText(dir: string, path: string): string {
  return readFileSync(join(dir, path), "utf8");
}

export function modeOf(dir: string, path: string): number {
  return statSync(join(dir, path)).mode & 0o777;
}

export function checkout(files: Readonly<Record<string, string>> = {}): string {
  const dir = scratchDir();
  git(dir, ["init", "-q"]);
  writeFiles(dir, files);
  return dir;
}
