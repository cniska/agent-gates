import { expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
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
import { basename, dirname, join } from "node:path";
import { decode } from "@toon-format/toon";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

const MANIFEST = join(import.meta.dir, "..", "package.json");

const BUILD_COMPILED = join(import.meta.dir, "..", "scripts", "build-compiled.sh");

export const SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

const RELEASE_DOWNLOADS = "https://github.com/cniska/agent-gates/releases/latest/download";

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

const GH_CALLS = "gh-calls";

const GH_STUB = ["#!/bin/sh", `echo "$*" >> "$HOME/${GH_CALLS}"`, "exit 2", ""].join("\n");

export function scratchDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "agent-gates-acceptance-")));
  scratchDirs.push(dir);
  return dir;
}

export function removeScratchDirs(): void {
  home = null;
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

function gitHome(): string {
  if (home !== null) return home;
  home = scratchDir();
  writeFileSync(join(home, ".gitconfig"), IDENTITY);
  mkdirSync(join(home, "bin"));
  writeFileSync(join(home, "bin", "gh"), GH_STUB);
  chmodSync(join(home, "bin", "gh"), 0o755);
  return home;
}

export function ghCalls(): string {
  const at = join(gitHome(), GH_CALLS);
  return existsSync(at) ? readFileSync(at, "utf8") : "";
}

function hermetic(env: Env): Env {
  const at = gitHome();
  return {
    PATH: `${join(at, "bin")}:${process.env.PATH ?? ""}`,
    HOME: at,
    GIT_CONFIG_GLOBAL: join(at, ".gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    ...env,
  };
}

export function run(command: string, args: readonly string[], cwd: string, env: Env = {}, input = ""): Ran {
  const ran = spawnSync(command, args, { cwd, env: hermetic(env), encoding: "utf8", input });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

export function agentGates(cwd: string, args: readonly string[], env: Env = {}): Ran {
  return run(process.execPath, [CLI, ...args], cwd, env);
}

export function compiledBinary(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const binary = join(dir, "agent-gates");
  const built = run("bash", [BUILD_COMPILED, binary], dir, {
    PATH: `${dirname(process.execPath)}:${SYSTEM_PATH}`,
  });
  if (built.status !== 0) throw new Error(`build-compiled.sh exited ${built.status}: ${built.stderr}`);
  return binary;
}

export function releaseAssets(dir: string, binary: string, target: string): string {
  mkdirSync(dir, { recursive: true });
  const tarball = join(dir, `agent-gates-${target}.tar.gz`);
  const packed = run("tar", ["-czf", tarball, "-C", dirname(binary), basename(binary)], dir);
  if (packed.status !== 0) throw new Error(`tar exited ${packed.status}: ${packed.stderr}`);
  const digest = new Bun.CryptoHasher("sha256").update(readFileSync(tarball)).digest("hex");
  writeFileSync(join(dir, `agent-gates-${target}.sha256`), `${digest}  agent-gates-${target}.tar.gz\n`);
  return dir;
}

export function curlServing(bin: string, assets: string): string {
  mkdirSync(bin, { recursive: true });
  const curl = join(bin, "curl");
  writeFileSync(
    curl,
    lines([
      "#!/bin/sh",
      "url=; out=",
      'while [ "$#" -gt 0 ]; do case "$1" in -o) out="$2"; shift ;; https://*) url="$1" ;; esac; shift; done',
      `file="${assets}/\${url##*/}"`,
      `case "$url" in ${RELEASE_DOWNLOADS}/*) ;; *) exit 22 ;; esac`,
      '[ -f "$file" ] || exit 22',
      'cp "$file" "$out"',
    ]),
  );
  chmodSync(curl, 0o755);
  return bin;
}

export function toonOf(text: string): unknown {
  if (!text.endsWith("\n") || text.endsWith("\n\n"))
    throw new Error(`expected TOON ending in one newline, got: ${text}`);
  return decode(text.slice(0, -1));
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

export function packageVersion(): string {
  const version = field(JSON.parse(readFileSync(MANIFEST, "utf8")), "version");
  if (typeof version !== "string") throw new Error(`${MANIFEST} names no version`);
  return version;
}

export function doctor(dir: string): Judged {
  const ran = agentGates(dir, ["doctor", "--full"]);
  if (ran.stderr !== "") throw new Error(`doctor wrote to stderr: ${ran.stderr}`);
  const checks = field(field(toonOf(ran.stdout), "result"), "checks");
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
  readonly prefixes: string | null;
  readonly workflows: string | null;
};

export type InstallResult = {
  readonly gates: readonly string[];
  readonly files: readonly FileResult[];
  readonly prepare: string;
  readonly fills?: Fills;
  readonly workflows?: WorkflowsTaken | null;
};

type WorkflowsTaken = {
  readonly choice: string;
  readonly reason: string;
};

const NO_FILLS: Fills = { command: null, prefixes: null, workflows: null };

const DEFAULT_WORKFLOWS: WorkflowsTaken = { choice: "on", reason: "default" };

const FILE_STATES = [
  "installed",
  "missing",
  "behind",
  "changed",
  "ahead",
  "not-executable",
  "reconfigured",
  "unwanted",
];

function fileCounts(files: readonly FileResult[]): Readonly<Record<string, number>> {
  return Object.fromEntries(
    FILE_STATES.map((state) => [state, files.filter((file) => file.state === state).length]),
  );
}

export const COMMIT_SUBJECT_FILES = [
  ".githooks/commit-msg",
  ".github/workflows/commits.yml",
  ".githooks/.gitattributes",
  ".githooks/pre-push",
  ".githooks/pre-push.d/commit-subject",
  ".githooks/judge-push",
];

export function usageCode(dir: string, args: readonly string[]): readonly unknown[] {
  const ran = agentGates(dir, ["install", ...args]);
  return [args, ran.status, field(field(toonOf(ran.stderr), "error"), "code")];
}

export function each(state: string, targets: readonly string[]): FileResult[] {
  return targets.map((target) => ({ target, state, backup: null }));
}

export function installed(dir: string, args: readonly string[]): unknown {
  const ran = agentGates(dir, ["install", "--full", ...args]);
  expect([ran.status, ran.stderr]).toEqual([0, ""]);
  const reply = toonOf(ran.stdout);
  expect([field(reply, "command"), field(reply, "ok")]).toEqual(["install", true]);
  return field(reply, "result");
}

export function installs(dir: string, args: readonly string[], result: InstallResult): void {
  expect(installed(dir, args)).toEqual({
    counts: fileCounts(result.files),
    fills: NO_FILLS,
    workflows: DEFAULT_WORKFLOWS,
    ...result,
  });
}

export function refuses(dir: string, args: readonly string[], error: object): void {
  const ran = agentGates(dir, ["install", ...args]);
  expect([ran.status, ran.stdout]).toEqual([1, ""]);
  expect(toonOf(ran.stderr)).toEqual({ command: "install", ok: false, error });
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

function isExecutableFile(path: string): boolean {
  const stats = statSync(path, { throwIfNoEntry: false });
  return stats?.isFile() === true && (stats.mode & 0o111) !== 0;
}

function isMiseShim(path: string): boolean {
  return basename(realpathSync(path)) === "mise";
}

function firstOnPath(tool: string, searched: string): string {
  const found = searched
    .split(":")
    .filter((dir) => dir !== "")
    .map((dir) => join(dir, tool))
    .find((path) => isExecutableFile(path) && !isMiseShim(path));
  if (found === undefined) throw new Error(`${tool} is not on PATH`);
  return found;
}

export function pathOf(tools: readonly string[], searched = process.env.PATH ?? ""): string {
  const bin = scratchDir();
  for (const tool of tools) symlinkSync(firstOnPath(tool, searched), join(bin, tool));
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

export function gated(gates: readonly string[], files: Readonly<Record<string, string>> = {}): string {
  const dir = checkout(files);
  for (const gate of gates) install(dir, [gate]);
  git(dir, ["add", "-A"]);
  commitAs(dir, "chore: start");
  return dir;
}

export function commitStaged(dir: string, paths: readonly string[] = [], env: Env = {}): Outcome {
  return committing(dir, ["-q", "-m", "feat: change things", ...paths], env);
}

export function restart(dir: string, to = "HEAD"): string {
  git(dir, ["reset", "-q", "--hard", to]);
  git(dir, ["clean", "-q", "-f", "-d"]);
  return dir;
}

export function commitFiles(dir: string, files: Readonly<Record<string, string>>): Outcome {
  writeFiles(dir, files);
  git(dir, ["add", "-A"]);
  return commitStaged(dir);
}

export function lines(texts: readonly string[]): string {
  return texts.map((text) => `${text}\n`).join("");
}

export const AWS_KEY = ["AKIA", "Q7MZ", "P2XK", "V4LT", "W6RB"].join("");

export function fingerprint(rule: string, path: string, secret: string): string {
  return `${rule}:${path}:${createHash("sha256").update(secret).digest("hex").slice(0, 16)}`;
}
