import { spawnSync } from "node:child_process";
import { gitOutput } from "./git";

export type Visibility =
  | { readonly kind: "private" }
  | { readonly kind: "public" }
  | { readonly kind: "unreadable"; readonly detail: string };

const REMOTE = "origin";

const GH_TIMEOUT_MS = 10_000;

const TIMED_OUT = "ETIMEDOUT";

const GH_ARGS = ["--json", "isPrivate", "--jq", ".isPrivate"];

const ANSWERS: ReadonlyMap<string, Visibility> = new Map([
  ["true", { kind: "private" }],
  ["false", { kind: "public" }],
]);

function unreadable(detail: string): Visibility {
  return { kind: "unreadable", detail };
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0]?.trim() ?? "";
}

function originUrl(root: string): string | null {
  const remotes = gitOutput(root, ["remote"]).toString().split("\n");
  if (!remotes.includes(REMOTE)) return null;
  return gitOutput(root, ["remote", "get-url", REMOTE]).toString().trim();
}

function failure(error: Error): string {
  if ("code" in error && error.code === TIMED_OUT)
    return `gh did not answer within ${GH_TIMEOUT_MS / 1000} s`;
  return `gh could not run: ${error.message}`;
}

export function repoVisibility(root: string): Visibility {
  const url = originUrl(root);
  if (url === null) return unreadable(`the checkout has no ${REMOTE} remote`);
  const run = spawnSync("gh", ["repo", "view", url, ...GH_ARGS], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: GH_TIMEOUT_MS,
  });
  if (run.error !== undefined) return unreadable(failure(run.error));
  const answer = ANSWERS.get(run.stdout.toString().trim());
  if (run.status === 0 && answer !== undefined) return answer;
  const said = firstLine(run.stderr.toString()) || firstLine(run.stdout.toString());
  const ended = run.status === null ? `was killed by ${run.signal}` : `exited ${run.status}`;
  return unreadable(`gh repo view ${url} ${ended}: ${said}`);
}
