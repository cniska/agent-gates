import { afterEach, expect, test } from "bun:test";
import { AWS_KEY, gated, git, pathWithNode18, removeScratchDirs, shell, writeFiles } from "./cli";

afterEach(removeScratchDirs);

test("AC-72 the scanners and the hooks judge nothing with a node older than 20, naming the fix", () => {
  const dir = gated(["no-comments-javascript", "no-secrets", "pinned-actions"]);
  writeFiles(dir, {
    "a.ts": `export const key = "${AWS_KEY}"; // why\n`,
    ".github/workflows/ci.yml": "jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n",
  });
  git(dir, ["add", "-A"]);
  const node18 = { PATH: pathWithNode18(["git", "sh", "dirname", "mktemp", "rm"]) };

  for (const gate of ["no-comments", "no-secrets", "pinned-actions"]) {
    const unjudged = {
      status: 3,
      stdout: "",
      stderr: `${gate}: node v18.20.4 is older than 20, so nothing was judged; install Node.js 20 or later\n`,
    };
    expect(shell(dir, `.githooks/pre-commit.d/${gate}`, node18)).toEqual(unjudged);
    expect(shell(dir, `sh .githooks/judge-push ${gate} a b c d`, node18)).toEqual(unjudged);
    expect(shell(dir, `node .githooks/${gate}/scan.cjs --all`, node18)).toEqual(unjudged);
  }
});
