import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SOURCE_DIR } from "./gates";
import { removeScratchDirs, repo } from "./repo.test-support";

const HOOK = join(SOURCE_DIR, "commit-msg");
const dir = repo();

afterAll(removeScratchDirs);

function judged(message: string, hook = HOOK) {
  const file = join(dir, "MESSAGE");
  writeFileSync(file, message);
  const ran = Bun.spawnSync(["sh", hook, file], { cwd: dir, stderr: "pipe" });
  return { exitCode: ran.exitCode, stderr: ran.stderr.toString() };
}

describe("the commit-msg hook", () => {
  test("lets a short Conventional Commit subject through, and a fixup of one", () => {
    expect(judged("feat: add a thing\n").exitCode).toBe(0);
    expect(judged("fix(order): keep the head\n# a git comment line\n").exitCode).toBe(0);
    expect(judged("fixup! fixup! docs: say what holds\n").exitCode).toBe(0);
    expect(judged("squash! fixup! docs: say what holds\n").exitCode).toBe(0);
  });

  test("judges an amend! commit by the message it replaces the subject with", () => {
    expect(judged("amend! feat: start\n\nfeat: start over\n").exitCode).toBe(0);
    expect(judged("amend! feat: start\n\nStart over\n").stderr).toContain("got: Start over");
    expect(judged("amend! feat: start\n\nfeat: start over\n\nbecause\n").stderr).toContain(
      "commit has a body",
    );
  });

  test("judges only what git keeps: no scissors and diff below, no carriage returns", () => {
    const verbose = [
      "feat: add a thing",
      "# Please enter the commit message for your changes.",
      "# ------------------------ >8 ------------------------",
      "# Do not modify or remove the line above.",
      "diff --git a/x b/x",
      "+hello",
      "",
    ].join("\n");
    expect(judged(verbose)).toEqual({ exitCode: 0, stderr: "" });
    expect(judged("feat: add a thing\r\n")).toEqual({ exitCode: 0, stderr: "" });
  });

  test("refuses a subject whose description is only spaces", () => {
    expect(judged("feat:   \n").stderr).toContain("subject is not a Conventional Commit");
  });

  test("refuses a subject that is not a Conventional Commit", () => {
    expect(judged("Add a thing\n")).toEqual({
      exitCode: 1,
      stderr:
        "commit-msg: subject is not a Conventional Commit (type(scope): what changed); types: build,chore,ci,docs,feat,fix,perf,refactor,revert,style,test.\n  got: Add a thing\n",
    });
  });

  test("refuses a body, a subject over 50 characters, a non-ASCII subject and an empty one", () => {
    expect(judged("feat: x\n\nbecause\n").stderr).toContain("commit has a body");
    expect(judged(`feat: ${"x".repeat(45)}\n`).stderr).toContain(
      "subject is 51 characters, over the 50 allowed.",
    );
    expect(judged(`feat: ${"x".repeat(44)}\n`).exitCode).toBe(0);
    expect(judged("feat: café\n").stderr).toContain("subject is not ASCII.");
    expect(judged("\n").stderr).toContain("subject is empty.");
  });

  test("allows only the installed prefixes once a list is installed", () => {
    const listed = join(dir, "commit-msg");
    writeFileSync(listed, readFileSync(HOOK, "utf8").replace("\nprefixes=''\n", "\nprefixes='feat,spec'\n"));
    expect(judged("spec: say what holds\n", listed)).toEqual({ exitCode: 0, stderr: "" });
    expect(judged("revert: drop a thing\n", HOOK)).toEqual({ exitCode: 0, stderr: "" });
    expect(judged("revert: drop a thing\n", listed)).toEqual({
      exitCode: 1,
      stderr:
        "commit-msg: subject is not a Conventional Commit (type(scope): what changed); types: feat,spec.\n  got: revert: drop a thing\n",
    });
  });
});
