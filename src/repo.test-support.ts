import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CodedError } from "./coded-error";
import type { Visibility } from "./github";

export const NO_COMMIT = "0000000000000000000000000000000000000000";

export const IDENTITY = ["-c", "user.name=T", "-c", "user.email=t@example.com"];

const scratchDirs: string[] = [];

export function scratchDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "agent-gates-")));
  scratchDirs.push(dir);
  return dir;
}

export function removeScratchDirs(): void {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function repo(files: Record<string, string> = {}): string {
  const dir = scratchDir();
  execFileSync("git", ["init", "-q", dir]);
  writeFiles(dir, files);
  return dir;
}

export function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}

export function commit(
  dir: string,
  { subject = "feat: change", add = ["-A"] }: { subject?: string; add?: readonly string[] } = {},
): { status: number | null; stderr: string } {
  execFileSync("git", ["-C", dir, "add", ...add]);
  const run = spawnSync("git", ["-C", dir, ...IDENTITY, "commit", "-q", "-m", subject], { encoding: "utf8" });
  return { status: run.status, stderr: run.stderr };
}

export function commitPastHooks(dir: string, subject: string): string {
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", [
    "-C",
    dir,
    ...IDENTITY,
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    subject,
  ]);
  return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

export function refusalOf(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    if (!(error instanceof CodedError && error.kind === "refusal")) throw error;
    return error.code;
  }
}

export const NOT_ON_GITHUB = (): Visibility => ({
  kind: "unreadable",
  detail: "the checkout has no origin remote",
});
