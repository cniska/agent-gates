import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

const IDENTITY =
  "[user]\n\tname = Acceptance\n\temail = acceptance@example.com\n[init]\n\tdefaultBranch = main\n";

type Ran = { readonly status: number | null; readonly stdout: string; readonly stderr: string };

type Env = Readonly<Record<string, string>>;

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

export function checkout(): string {
  const dir = scratchDir();
  const ran = run("git", ["init", "-q", dir], dir);
  if (ran.status !== 0) throw new Error(`git init exited ${ran.status}: ${ran.stderr}`);
  return dir;
}
