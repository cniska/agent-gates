import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

const IDENTITY =
  "[user]\n\tname = Acceptance\n\temail = acceptance@example.com\n[init]\n\tdefaultBranch = main\n";

type Ran = { readonly status: number | null; readonly stdout: string; readonly stderr: string };

type Env = Readonly<Record<string, string>>;

export type Check = {
  readonly name: string;
  readonly state: string;
  readonly detail: string;
  readonly fix: string | null;
};

type Judged = { readonly status: number | null; readonly checks: readonly Check[] };

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

function run(command: string, args: readonly string[], cwd: string, env: Env = {}): Ran {
  const ran = spawnSync(command, args, { cwd, env: hermetic(env), encoding: "utf8" });
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

function field(value: unknown, key: string): unknown {
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

export function install(dir: string, gates: readonly string[]): void {
  const ran = agentGates(dir, ["install", ...gates]);
  if (ran.status !== 0) throw new Error(`install ${gates.join(" ")} exited ${ran.status}: ${ran.stderr}`);
}

export function gitRan(dir: string, args: readonly string[]): Ran {
  return run("git", ["-C", dir, ...args], dir);
}

export function git(dir: string, args: readonly string[]): string {
  const ran = gitRan(dir, args);
  if (ran.status !== 0) throw new Error(`git ${args.join(" ")} exited ${ran.status}: ${ran.stderr}`);
  return ran.stdout.trim();
}

export function shell(dir: string, script: string): Ran {
  return run("sh", ["-c", script], dir);
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
