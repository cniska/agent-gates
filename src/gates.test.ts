import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gatesDoctor } from "./doctor";
import { ourMarker } from "./gate-marker";
import { isGateName } from "./gate-parts";
import { installGates, SOURCE_DIR } from "./gates";
import { GATES, NO_FILLS } from "./gates-contract";
import { commit, refusalOf, removeScratchDirs, repo, scratchDir } from "./repo.test-support";

const GITATTRIBUTES_V1 = "# agent-gate:githooks:1\n* linguist-generated\n";
const WIRED_PREPARE = "! git rev-parse --git-dir >/dev/null 2>&1 || git config core.hooksPath .githooks";

function read(dir: string, path: string): string {
  return readFileSync(join(dir, path), "utf8");
}

function modeOf(dir: string, path: string): number {
  return statSync(join(dir, path)).mode & 0o777;
}

function hooksPath(dir: string): string {
  return spawnSync("git", ["-C", dir, "config", "--get", "core.hooksPath"], {
    encoding: "utf8",
  }).stdout.trim();
}

function checks(dir: string): Record<string, string> {
  return Object.fromEntries(gatesDoctor(dir).checks.map(({ name, state }) => [name, state]));
}

function statesOf(installed: { readonly files: readonly { target: string; state: string }[] }) {
  return Object.fromEntries(installed.files.map(({ target, state }) => [target, state]));
}

afterEach(removeScratchDirs);

describe("the gate registry", () => {
  const files = Object.values(GATES).flat();

  test("holds every source in gates/, each once per target", () => {
    const sources = readdirSync(SOURCE_DIR, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(SOURCE_DIR.length + 1));
    expect(new Set(files.map(({ source }) => source))).toEqual(new Set(sources));
    for (const file of files) {
      expect(files.filter(({ target }) => target === file.target).every((same) => same === file)).toBe(true);
    }
  });

  test("marks each file with the part it belongs to, a shared part when several gates hold it", () => {
    for (const { source, part } of files) {
      const text = readFileSync(join(SOURCE_DIR, source), "utf8");
      expect([source, ourMarker(text)?.part]).toEqual([source, part]);
      const holders = Object.entries(GATES)
        .filter(([, held]) => held.some((file) => file.source === source))
        .map(([gate]) => gate);
      const shared = !isGateName(part);
      expect([source, shared ? true : holders]).toEqual([source, shared ? true : [part]]);
    }
  });

  test("keeps every version a source was released at, the current bytes last", () => {
    for (const { source, versions } of files) {
      const text = readFileSync(join(SOURCE_DIR, source), "utf8");
      expect([source, versions.map(({ version }) => version)]).toEqual([
        source,
        versions.map((_, index) => index + 1),
      ]);
      const current = versions.at(-1);
      expect([source, current?.version, current?.sha256]).toEqual([
        source,
        ourMarker(text)?.version,
        createHash("sha256").update(text).digest("hex"),
      ]);
    }
  });
});

describe("this repo", () => {
  test("runs its own gates as gates/ holds them, wired and healthy", () => {
    const report = gatesDoctor(resolve(import.meta.dir, ".."));
    expect(report.checks.filter(({ state }) => state !== "ok")).toEqual([]);
    expect(report.checks.map(({ name }) => name)).toEqual([
      "gates",
      ".githooks/commit-msg",
      ".github/workflows/commits.yml",
      ".githooks/.gitattributes",
      ".githooks/pre-commit",
      ".githooks/pre-commit.d/no-comments",
      ".githooks/no-comments/scan.cjs",
      ".github/workflows/no-comments.yml",
      ".githooks/no-comments/javascript.cjs",
      ".githooks/no-comments/shell.cjs",
      "hooksPath",
      "prepare",
      "no-comments languages",
      "no-comments backlog",
    ]);
  });
});

describe("install", () => {
  test("writes the gate, wires the hooks and reports the plan it acted on", () => {
    const dir = repo();
    expect(installGates(dir, ["commit-subject"], NO_FILLS)).toEqual({
      gates: ["commit-subject"],
      files: [
        { target: ".githooks/commit-msg", state: "missing", backup: null },
        { target: ".github/workflows/commits.yml", state: "missing", backup: null },
        { target: ".githooks/.gitattributes", state: "missing", backup: null },
      ],
      prepare: "absent",
      fills: { command: null, setup: null },
    });
    expect(hooksPath(dir)).toBe(".githooks");
    expect(modeOf(dir, ".githooks/commit-msg")).toBe(0o755);
    expect(modeOf(dir, ".github/workflows/commits.yml")).toBe(0o644);
    expect(gatesDoctor(dir)).toEqual({
      checks: [
        { name: "gates", state: "ok", detail: "commit-subject", fix: null },
        { name: ".githooks/commit-msg", state: "ok", detail: "installed", fix: null },
        { name: ".github/workflows/commits.yml", state: "ok", detail: "installed", fix: null },
        { name: ".githooks/.gitattributes", state: "ok", detail: "installed", fix: null },
        { name: "hooksPath", state: "ok", detail: "core.hooksPath is .githooks", fix: null },
        {
          name: "prepare",
          state: "ok",
          detail: "no package.json, so each contributor runs git config core.hooksPath .githooks once",
          fix: null,
        },
      ],
      failing: 0,
    });
    expect(Object.values(statesOf(installGates(dir, [], NO_FILLS)))).toEqual([
      "installed",
      "installed",
      "installed",
    ]);
  });

  test("the installed hook refuses a bad subject and lets a good one through", () => {
    const dir = repo();
    installGates(dir, ["commit-subject"], NO_FILLS);
    expect(commit(dir, { subject: "Add the gates" })).toEqual({
      status: 1,
      stderr:
        "commit-msg: subject is not a Conventional Commit (type(scope): what changed).\n  got: Add the gates\n",
    });
    expect(commit(dir, { subject: "feat: add the gates" })).toEqual({ status: 0, stderr: "" });
  });

  test("marks the hook code linguist-generated", () => {
    const dir = repo();
    installGates(dir, ["commit-subject"], NO_FILLS);
    const attr = execFileSync("git", ["-C", dir, "check-attr", "linguist-generated", ".githooks/commit-msg"]);
    expect(attr.toString()).toBe(".githooks/commit-msg: linguist-generated: set\n");
  });

  test("reads the installed gates back from their markers", () => {
    const dir = repo();
    installGates(dir, ["commit-subject"], NO_FILLS);
    expect(installGates(dir, [], NO_FILLS).gates).toEqual(["commit-subject"]);
  });

  test("adds the prepare script in place, keeping every key's order and the indent", () => {
    const spaced = repo({
      "package.json": '{\n  "name": "p",\n  "scripts": { "build": "true" },\n  "type": "module"\n}\n',
    });
    expect(installGates(spaced, ["commit-subject"], NO_FILLS).prepare).toBe("missing");
    expect(read(spaced, "package.json")).toBe(
      `{\n  "name": "p",\n  "scripts": {\n    "build": "true",\n    "prepare": ${JSON.stringify(WIRED_PREPARE)}\n  },\n  "type": "module"\n}\n`,
    );
    expect(checks(spaced).prepare).toBe("ok");
    const tabbed = repo({ "package.json": '{\n\t"scripts": { "check": "true" }\n}\n' });
    installGates(tabbed, ["commit-subject"], NO_FILLS);
    expect(read(tabbed, "package.json")).toBe(
      `{\n\t"scripts": {\n\t\t"check": "true",\n\t\t"prepare": ${JSON.stringify(WIRED_PREPARE)}\n\t}\n}\n`,
    );
  });

  test("rewrites an earlier prepare wiring in place", () => {
    const dir = repo({
      "package.json":
        '{\n  "scripts": {\n    "prepare": "git config core.hooksPath .githooks",\n    "b": "x"\n  }\n}\n',
    });
    expect(checks(dir)).toEqual({ gates: "warn" });
    installGates(dir, ["commit-subject"], NO_FILLS);
    writeFileSync(
      join(dir, "package.json"),
      '{\n  "scripts": {\n    "prepare": "git config core.hooksPath .githooks",\n    "b": "x"\n  }\n}\n',
    );
    expect(checks(dir).prepare).toBe("warn");
    expect(installGates(dir, [], NO_FILLS).prepare).toBe("behind");
    expect(read(dir, "package.json")).toBe(
      `{\n  "scripts": {\n    "prepare": ${JSON.stringify(WIRED_PREPARE)},\n    "b": "x"\n  }\n}\n`,
    );
  });

  test("the prepare script wires a checkout and does nothing outside one", () => {
    const dir = repo();
    expect(spawnSync("sh", ["-c", WIRED_PREPARE], { cwd: dir }).status).toBe(0);
    expect(hooksPath(dir)).toBe(".githooks");
    const loose = scratchDir();
    expect(
      spawnSync("sh", ["-c", WIRED_PREPARE], {
        cwd: loose,
        env: { ...process.env, GIT_CEILING_DIRECTORIES: tmpdir() },
      }).status,
    ).toBe(0);
  });
});

describe("file states", () => {
  test("judges missing, behind and changed files, and install acts on each", () => {
    const dir = repo();
    installGates(dir, ["commit-subject"], NO_FILLS);
    rmSync(join(dir, ".githooks/commit-msg"));
    writeFileSync(join(dir, ".githooks/.gitattributes"), GITATTRIBUTES_V1);
    writeFileSync(
      join(dir, ".github/workflows/commits.yml"),
      `${read(dir, ".github/workflows/commits.yml")}# local\n`,
    );
    expect(checks(dir)).toEqual({
      gates: "ok",
      ".githooks/commit-msg": "fail",
      ".github/workflows/commits.yml": "warn",
      ".githooks/.gitattributes": "warn",
      hooksPath: "ok",
      prepare: "ok",
    });
    expect(installGates(dir, [], NO_FILLS).files).toEqual([
      { target: ".githooks/commit-msg", state: "missing", backup: null },
      {
        target: ".github/workflows/commits.yml",
        state: "changed",
        backup: ".github/workflows/commits.yml.agent-gates-backup",
      },
      { target: ".githooks/.gitattributes", state: "behind", backup: null },
    ]);
    expect(read(dir, ".github/workflows/commits.yml.agent-gates-backup")).toEndWith("# local\n");
    expect(modeOf(dir, ".github/workflows/commits.yml.agent-gates-backup") & 0o111).toBe(0);
    expect(gatesDoctor(dir).checks.every(({ state }) => state === "ok")).toBe(true);
  });

  test("sets aside a hand-edited file at an earlier version rather than overwriting it", () => {
    const dir = repo();
    installGates(dir, ["commit-subject"], NO_FILLS);
    writeFileSync(join(dir, ".githooks/.gitattributes"), `${GITATTRIBUTES_V1}*.sh text\n`);
    expect(installGates(dir, [], NO_FILLS).files[2]).toEqual({
      target: ".githooks/.gitattributes",
      state: "changed",
      backup: ".githooks/.gitattributes.agent-gates-backup",
    });
  });

  test("restores a hook that lost its executable bit, without a backup", () => {
    const dir = repo();
    installGates(dir, ["commit-subject"], NO_FILLS);
    chmodSync(join(dir, ".githooks/commit-msg"), 0o644);
    expect(gatesDoctor(dir)).toMatchObject({ failing: 1 });
    expect(checks(dir)[".githooks/commit-msg"]).toBe("fail");
    expect(installGates(dir, [], NO_FILLS).files[0]).toEqual({
      target: ".githooks/commit-msg",
      state: "not-executable",
      backup: null,
    });
    expect(modeOf(dir, ".githooks/commit-msg")).toBe(0o755);
  });

  test("leaves a file ahead of this version alone", () => {
    const dir = repo();
    installGates(dir, ["commit-subject"], NO_FILLS);
    const ahead = read(dir, ".githooks/commit-msg").replace(
      "agent-gate:commit-subject:2",
      "agent-gate:commit-subject:9",
    );
    writeFileSync(join(dir, ".githooks/commit-msg"), ahead);
    expect(checks(dir)[".githooks/commit-msg"]).toBe("warn");
    expect(installGates(dir, [], NO_FILLS).files[0]?.state).toBe("ahead");
    expect(read(dir, ".githooks/commit-msg")).toBe(ahead);
  });

  test("a file without a marker is changed and set aside", () => {
    const dir = repo({ ".github/workflows/commits.yml": "name: Commits\n" });
    expect(installGates(dir, ["commit-subject"], NO_FILLS).files[1]?.backup).toBe(
      ".github/workflows/commits.yml.agent-gates-backup",
    );
    expect(read(dir, ".github/workflows/commits.yml.agent-gates-backup")).toBe("name: Commits\n");
  });
});

describe("hooks path", () => {
  test("accepts .githooks however core.hooksPath spells it", () => {
    for (const spelling of ["./.githooks", ".githooks/"]) {
      const dir = repo();
      execFileSync("git", ["-C", dir, "config", "core.hooksPath", spelling]);
      installGates(dir, ["commit-subject"], NO_FILLS);
      expect([spelling, checks(dir).hooksPath, hooksPath(dir)]).toEqual([spelling, "ok", spelling]);
    }
    const absolute = repo();
    execFileSync("git", ["-C", absolute, "config", "core.hooksPath", join(absolute, ".githooks")]);
    installGates(absolute, ["commit-subject"], NO_FILLS);
    expect(checks(absolute).hooksPath).toBe("ok");
  });

  test("fails the doctor when hooks are not wired", () => {
    const dir = repo();
    installGates(dir, ["commit-subject"], NO_FILLS);
    execFileSync("git", ["-C", dir, "config", "--unset", "core.hooksPath"]);
    expect(gatesDoctor(dir).checks.find(({ name }) => name === "hooksPath")).toEqual({
      name: "hooksPath",
      state: "fail",
      detail: "core.hooksPath is unset, so git never runs the gates in .githooks",
      fix: "agent-gates install",
    });
    expect(gatesDoctor(dir).failing).toBe(1);
  });
});

describe("doctor", () => {
  test("with no gate installed reports only that", () => {
    expect(gatesDoctor(repo())).toEqual({
      checks: [
        {
          name: "gates",
          state: "warn",
          detail: "no gate is installed",
          fix: "agent-gates install <gate>..., choosing from commit-subject, format, no-comments-javascript, no-comments-dart, no-comments-sql, no-comments-shell, no-comments-rust, no-comments-python, no-comments (each language the tracked files hold)",
        },
      ],
      failing: 0,
    });
  });

  test("reports the refusal install would raise, as the fix", () => {
    const dir = repo();
    installGates(dir, ["commit-subject"], NO_FILLS);
    execFileSync("git", ["-C", dir, "config", "core.hooksPath", ".husky"]);
    writeFileSync(join(dir, "package.json"), "{ not json");
    const report = gatesDoctor(dir);
    expect(report.failing).toBe(2);
    expect(report.checks.find(({ name }) => name === "hooksPath")?.fix).toContain(
      "hooks must move to .githooks",
    );
    expect(report.checks.find(({ name }) => name === "prepare")?.fix).toContain("must parse");
  });
});

describe("refusals", () => {
  test("refuses with no gate installed or named, and writes nothing", () => {
    const dir = repo();
    expect(refusalOf(() => installGates(dir, [], NO_FILLS))).toBe("no_gates_chosen");
    expect(existsSync(join(dir, ".githooks"))).toBe(false);
  });

  test("refuses when core.hooksPath or prepare already hold something else, and writes nothing", () => {
    const hooked = repo();
    execFileSync("git", ["-C", hooked, "config", "core.hooksPath", ".husky"]);
    expect(refusalOf(() => installGates(hooked, ["commit-subject"], NO_FILLS))).toBe("hooks_path_occupied");
    expect(existsSync(join(hooked, ".githooks"))).toBe(false);

    const prepared = repo({ "package.json": '{ "scripts": { "prepare": "husky" } }\n' });
    expect(refusalOf(() => installGates(prepared, ["commit-subject"], NO_FILLS))).toBe("prepare_occupied");
    expect(existsSync(join(prepared, ".githooks"))).toBe(false);
    expect(hooksPath(prepared)).toBe("");
  });

  test("refuses a project's own commit-msg hook, another tool's too, and writes nothing", () => {
    for (const own of [
      "#!/bin/sh\nexit 0\n",
      "#!/bin/sh\n# dim-gate:1\nexit 0\n",
      "#!/bin/sh\n# x-gate:commit-subject:9\nexit 0\n",
    ]) {
      const dir = repo({ ".githooks/commit-msg": own });
      expect(refusalOf(() => installGates(dir, ["commit-subject"], NO_FILLS))).toBe("hook_occupied");
      expect(read(dir, ".githooks/commit-msg")).toBe(own);
      expect(existsSync(join(dir, ".githooks/.gitattributes"))).toBe(false);
      expect(existsSync(join(dir, ".githooks/commit-msg.agent-gates-backup"))).toBe(false);
      expect(hooksPath(dir)).toBe("");
    }
  });

  test("doctor fails a project's own commit-msg hook with the move out as the fix", () => {
    const dir = repo();
    installGates(dir, ["commit-subject"], NO_FILLS);
    writeFileSync(join(dir, ".githooks/commit-msg"), "#!/bin/sh\nexit 0\n");
    expect(gatesDoctor(dir).checks.find(({ name }) => name === ".githooks/commit-msg")).toEqual({
      name: ".githooks/commit-msg",
      state: "fail",
      detail: `${dir} has its own .githooks/commit-msg, which a gate would replace`,
      fix: `stop and hand this error to the owner: ${dir}'s .githooks/commit-msg must move out before the gates install; a step that runs before each commit belongs in .githooks/pre-commit.d/<name>, and commit-subject owns .githooks/commit-msg`,
    });
  });

  test("sets aside a project's own file that git does not run, rather than refusing", () => {
    const dir = repo({ ".github/workflows/commits.yml": "name: ours\n" });
    expect(statesOf(installGates(dir, ["commit-subject"], NO_FILLS))).toMatchObject({
      ".github/workflows/commits.yml": "changed",
    });
    expect(read(dir, ".github/workflows/commits.yml.agent-gates-backup")).toBe("name: ours\n");
  });
});
