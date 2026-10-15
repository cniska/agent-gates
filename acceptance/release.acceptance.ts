import { afterEach, expect, test } from "bun:test";
import { dirname } from "node:path";
import {
  checkout,
  compiledBinary,
  jsonLine,
  packageVersion,
  pathOf,
  removeScratch,
  run,
  scratchDir,
} from "./cli";

afterEach(removeScratch);

const BUILD_TIMEOUT_MS = 60_000;

test(
  "AC-45 the release binary, alone on PATH with git, prints its version, installs a gate and passes doctor",
  () => {
    const binary = compiledBinary(scratchDir());
    const path = `${dirname(binary)}:${pathOf(["git"])}`;
    const dir = checkout({ "notes.txt": "made-up content\n" });

    expect(run("agent-gates", ["--version"], dir, { PATH: path })).toEqual({
      status: 0,
      stdout: `${packageVersion()}\n`,
      stderr: "",
    });

    const installed = run("agent-gates", ["install", "commit-subject"], dir, { PATH: path });
    expect([installed.status, installed.stderr]).toEqual([0, ""]);
    expect(jsonLine(installed.stdout)).toMatchObject({ command: "install", ok: true });

    const judged = run("agent-gates", ["doctor"], dir, { PATH: path });
    expect([judged.status, judged.stderr]).toEqual([0, ""]);
    expect(jsonLine(judged.stdout)).toMatchObject({ command: "doctor", ok: true, result: { failing: 0 } });
  },
  BUILD_TIMEOUT_MS,
);
