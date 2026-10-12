import { spawnSync } from "node:child_process";
import { invariant } from "./assert";
import { faults, refusals } from "./coded-error";

type GitRun = {
  readonly status: number | null;
  readonly signal: string | null;
  readonly out: Buffer;
  readonly err: string;
};

const gitRefusal = refusals<{
  readonly not_a_checkout: { readonly cwd: string };
}>({
  not_a_checkout: {
    message: ({ cwd }) => `${cwd} is not inside a git checkout, so there is no project to gate`,
    resolve: () => "cd into the project's checkout and run the command again",
  },
});

const gitFault = faults<{
  readonly git_unavailable: { readonly detail: string };
  readonly git_failed: {
    readonly repo: string;
    readonly command: string;
    readonly status: number | null;
    readonly signal: string | null;
    readonly detail: string;
  };
  readonly blob_missing: { readonly repo: string; readonly blob: string };
}>({
  git_unavailable: {
    message: ({ detail }) => `git could not run: ${detail}`,
    resolve: () => "stop and hand this error to the owner: git must be installed and on PATH",
  },
  git_failed: {
    message: ({ command, status, signal, detail }) =>
      `${command} ${status === null ? `was killed by ${signal}` : `exited ${status}`}: ${detail}`,
    resolve: ({ repo }) => `stop and hand this error to the owner: git must run in ${repo}`,
  },
  blob_missing: {
    message: ({ blob }) => `git reports blob ${blob} missing`,
    resolve: ({ repo, blob }) =>
      `stop and hand this error to the owner: ${repo}'s object store must hold ${blob}`,
  },
});

const BATCH_BLOB = /^([0-9a-f]+) blob (\d+)$/;

const MISSING = "missing";

const NEWLINE = 0x0a;

function git(repo: string, args: readonly string[], input: string | null = null): GitRun {
  const run = spawnSync("git", ["-C", repo, ...args], {
    input: input ?? undefined,
    stdio: [input === null ? "ignore" : "pipe", "pipe", "pipe"],
    maxBuffer: Number.POSITIVE_INFINITY,
  });
  if (run.error) throw gitFault("git_unavailable", { detail: run.error.message });
  return { status: run.status, signal: run.signal, out: run.stdout, err: run.stderr.toString().trim() };
}

function trimmed(run: GitRun): string {
  return run.out.toString().trim();
}

function failed(repo: string, args: readonly string[], run: GitRun) {
  return gitFault("git_failed", {
    repo,
    command: `git ${args.join(" ")}`,
    status: run.status,
    signal: run.signal,
    detail: run.err,
  });
}

export function checkoutRoot(cwd: string): string {
  const run = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (run.status !== 0) throw gitRefusal("not_a_checkout", { cwd });
  return trimmed(run);
}

export function configValue(repo: string, key: string): string | null {
  const args = ["config", "--get", key];
  const run = git(repo, args);
  if (run.status === 1) return null;
  if (run.status !== 0) throw failed(repo, args, run);
  return trimmed(run);
}

export function setConfig(repo: string, key: string, value: string): void {
  const args = ["config", key, value];
  const run = git(repo, args);
  if (run.status !== 0) throw failed(repo, args, run);
}

export function gitOutput(repo: string, args: readonly string[], input: string | null = null): Buffer {
  const run = git(repo, args, input);
  if (run.status !== 0) throw failed(repo, args, run);
  return run.out;
}

export function blobsOf(repo: string, blobs: readonly string[]): Buffer[] {
  if (blobs.length === 0) return [];
  const out = gitOutput(repo, ["cat-file", "--batch"], blobs.map((blob) => `${blob}\n`).join(""));
  let at = 0;
  return blobs.map((blob) => {
    const newline = out.indexOf(NEWLINE, at);
    const header = out.subarray(at, newline < 0 ? out.length : newline).toString();
    if (header === `${blob} ${MISSING}`) throw gitFault("blob_missing", { repo, blob });
    const [, id, size] = BATCH_BLOB.exec(header) ?? [];
    const start = newline + 1;
    const end = start + Number(size);
    invariant(
      newline >= 0 && id === blob && size !== undefined && out[end] === NEWLINE,
      "git cat-file --batch frames each blob asked for as header, body, LF",
    );
    at = end + 1;
    return out.subarray(start, end);
  });
}

export function nulFields(output: Buffer): string[] {
  const fields = output.toString().split("\0");
  if (fields.at(-1) === "") fields.pop();
  return fields;
}

export function mergeBase(repo: string, base: string, head: string): string | null {
  if (git(repo, ["cat-file", "-e", `${base}^{commit}`]).status !== 0) return null;
  const args = ["merge-base", base, head];
  const run = git(repo, args);
  if (run.status === 1) return null;
  if (run.status !== 0) throw failed(repo, args, run);
  return trimmed(run);
}
