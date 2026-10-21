import { afterEach, expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  checkout,
  compiledBinary,
  curlServing,
  jsonLine,
  packageVersion,
  pathOf,
  releaseAssets,
  removeScratchDirs,
  run,
  SYSTEM_PATH,
  scratchDir,
  shell,
} from "./cli";

afterEach(removeScratchDirs);

const BUILD_TIMEOUT_MS = 60_000;

const INSTALL = join(import.meta.dir, "..", "scripts", "install.sh");

const BUILD_NPM = join(import.meta.dir, "..", "scripts", "build-npm.ts");

const TARGET = `${process.platform}-${process.arch}`;

const OTHER_TARGET = TARGET === "darwin-arm64" ? "linux-x64" : "darwin-arm64";

function installing(home: string, curl: string): ReturnType<typeof run> {
  return run("/bin/sh", [INSTALL], home, { HOME: home, PATH: `${curl}:${SYSTEM_PATH}`, SHELL: "/bin/zsh" });
}

function unameSaying(system: string, machine: string): string {
  const dir = scratchDir();
  const uname = join(dir, "uname");
  writeFileSync(uname, `#!/bin/sh\ncase "$1" in -s) echo '${system}' ;; -m) echo '${machine}' ;; esac\n`);
  chmodSync(uname, 0o755);
  return dir;
}

function fakeBuild(dir: string, printed: string): string {
  const build = join(dir, "agent-gates");
  mkdirSync(dir, { recursive: true });
  writeFileSync(build, `#!/bin/sh\nprintf '%s\\n' '${printed}'\n`);
  chmodSync(build, 0o755);
  return build;
}

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

test(
  "AC-46 install.sh installs the latest release after checking its checksum, and installs nothing from a bad download",
  () => {
    const dir = scratchDir();
    const assets = releaseAssets(join(dir, "assets"), compiledBinary(join(dir, "build")), TARGET);
    const curl = curlServing(join(dir, "fake-bin"), assets);
    const home = join(dir, "home");
    mkdirSync(home);
    const installed = join(home, ".local", "bin", "agent-gates");

    expect(installing(home, curl)).toMatchObject({ status: 0, stderr: "" });
    expect(installing(home, curl)).toMatchObject({ status: 0, stderr: "" });
    expect(run(installed, ["--version"], home)).toEqual({
      status: 0,
      stdout: `${packageVersion()}\n`,
      stderr: "",
    });
    expect(readdirSync(join(home, ".local", "bin"))).toEqual(["agent-gates"]);

    writeFileSync(
      join(assets, `agent-gates-${TARGET}.sha256`),
      `${"0".repeat(64)}  agent-gates-${TARGET}.tar.gz\n`,
    );
    const fresh = join(dir, "fresh");
    mkdirSync(fresh);
    const refused = installing(fresh, curl);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("agent-gates install: checksum mismatch for");
    expect(existsSync(join(fresh, ".local"))).toBe(false);

    for (const printed of ["", "1.2.3.4", "../x"]) {
      const mislabelled = join(dir, `mislabelled-${printed.length}`);
      const served = curlServing(
        join(mislabelled, "bin"),
        releaseAssets(join(mislabelled, "assets"), fakeBuild(join(mislabelled, "build"), printed), TARGET),
      );
      const untouched = join(mislabelled, "home");
      mkdirSync(untouched);
      expect(installing(untouched, served)).toMatchObject({
        status: 1,
        stderr: expect.stringContaining(
          `agent-gates install: the downloaded agent-gates reports version '${printed}', not x.y.z; this release is broken, so install a later one\n`,
        ),
      });
      expect(readdirSync(untouched)).toEqual([]);
    }
  },
  BUILD_TIMEOUT_MS,
);

test(
  "AC-47 the npm package runs its platform's binary with no runtime on PATH, and refuses on another platform and when the platform package is missing or cannot start",
  () => {
    const dir = scratchDir();
    const assets = releaseAssets(join(dir, "assets"), compiledBinary(join(dir, "build")), TARGET);
    cpSync(join(assets, `agent-gates-${TARGET}.tar.gz`), join(assets, `agent-gates-${OTHER_TARGET}.tar.gz`));
    const tree = join(dir, "npm");
    const built = run(process.execPath, [BUILD_NPM, assets, tree], dir);
    expect([built.status, built.stderr]).toEqual([0, ""]);

    const modules = join(dir, "prefix", "lib", "node_modules", "@cniska");
    mkdirSync(modules, { recursive: true });
    cpSync(join(tree, "agent-gates"), join(modules, "agent-gates"), { recursive: true });
    const bin = join(dir, "prefix", "bin");
    mkdirSync(bin);
    symlinkSync(join(modules, "agent-gates", "bin", "agent-gates"), join(bin, "agent-gates"));
    const path = `${bin}:${pathOf(["git"])}:${SYSTEM_PATH}`;
    const project = checkout({ "notes.txt": "made-up content\n" });
    for (const runtime of ["node", "bun"])
      expect(shell(project, `command -v ${runtime}`, { PATH: path }).status).not.toBe(0);

    const unsupported = run("agent-gates", ["--version"], project, {
      PATH: `${unameSaying("Plan9", "mips")}:${path}`,
    });
    expect([unsupported.status, unsupported.stdout]).toEqual([1, ""]);
    expect(jsonLine(unsupported.stderr)).toMatchObject({
      command: "agent-gates",
      ok: false,
      error: { kind: "refusal", code: "no_build_for_platform" },
    });

    const missing = run("agent-gates", ["--version"], project, { PATH: path });
    expect([missing.status, missing.stdout]).toEqual([1, ""]);
    expect(jsonLine(missing.stderr)).toMatchObject({
      command: "agent-gates",
      ok: false,
      error: { kind: "refusal", code: "platform_package_missing" },
    });

    const nested = join(modules, "agent-gates", "node_modules", "@cniska", `agent-gates-${TARGET}`);
    cpSync(join(tree, TARGET), nested, { recursive: true });
    const platformBinary = join(nested, "agent-gates");
    chmodSync(platformBinary, 0o644);
    const unstartable = run("agent-gates", ["--version"], project, { PATH: path });
    expect([unstartable.status, unstartable.stdout]).toEqual([1, ""]);
    expect(jsonLine(unstartable.stderr)).toMatchObject({
      command: "agent-gates",
      ok: false,
      error: { kind: "refusal", code: "binary_failed" },
    });
    chmodSync(platformBinary, 0o755);

    expect(run("agent-gates", ["--version"], project, { PATH: path })).toEqual({
      status: 0,
      stdout: `${packageVersion()}\n`,
      stderr: "",
    });
    const extra = run("agent-gates", ["--version", "now"], project, { PATH: path });
    expect([extra.status, extra.stdout]).toEqual([2, ""]);
    expect(jsonLine(extra.stderr)).toMatchObject({
      command: "agent-gates",
      ok: false,
      error: { kind: "usage", code: "wrong_arity", resolve: "agent-gates --version" },
    });
    const installed = run("agent-gates", ["install", "commit-subject"], project, { PATH: path });
    expect([installed.status, installed.stderr]).toEqual([0, ""]);
    expect(jsonLine(installed.stdout)).toMatchObject({ command: "install", ok: true });
  },
  BUILD_TIMEOUT_MS,
);
