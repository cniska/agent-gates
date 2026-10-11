import { spawnSync } from "node:child_process";
import { refuser } from "./coded-error";

type GitRun = {
  readonly status: number | null;
  readonly signal: string | null;
  readonly out: string;
  readonly err: string;
};

const refuseGit = refuser<{
  readonly not_a_checkout: { readonly cwd: string };
  readonly git_unavailable: { readonly detail: string };
  readonly git_failed: {
    readonly repo: string;
    readonly command: string;
    readonly status: number | null;
    readonly signal: string | null;
    readonly detail: string;
  };
}>({
  not_a_checkout: {
    message: ({ cwd }) => `${cwd} is not inside a git checkout, so there is no project to gate`,
    resolve: () => "cd into the project's checkout and run the command again",
  },
  git_unavailable: {
    message: ({ detail }) => `git could not run: ${detail}`,
    resolve: () => "stop and hand this error to the owner: git must be installed and on PATH",
  },
  git_failed: {
    message: ({ command, status, signal, detail }) =>
      `${command} ${status === null ? `was killed by ${signal}` : `exited ${status}`}: ${detail}`,
    resolve: ({ repo }) => `stop and hand this error to the owner: git must run in ${repo}`,
  },
});

function git(repo: string, args: readonly string[]): GitRun {
  const run = spawnSync("git", ["-C", repo, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  if (run.error) throw refuseGit("git_unavailable", { detail: run.error.message });
  return {
    status: run.status,
    signal: run.signal,
    out: run.stdout.toString().trim(),
    err: run.stderr.toString().trim(),
  };
}

function failed(repo: string, args: readonly string[], run: GitRun) {
  return refuseGit("git_failed", {
    repo,
    command: `git ${args.join(" ")}`,
    status: run.status,
    signal: run.signal,
    detail: run.err,
  });
}

export function checkoutRoot(cwd: string): string {
  const run = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (run.status !== 0) throw refuseGit("not_a_checkout", { cwd });
  return run.out;
}

export function configValue(repo: string, key: string): string | null {
  const args = ["config", "--get", key];
  const run = git(repo, args);
  if (run.status === 1) return null;
  if (run.status !== 0) throw failed(repo, args, run);
  return run.out;
}

export function setConfig(repo: string, key: string, value: string): void {
  const args = ["config", key, value];
  const run = git(repo, args);
  if (run.status !== 0) throw failed(repo, args, run);
}
