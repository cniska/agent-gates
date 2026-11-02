import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { removeScratchDirs, scratchDir } from "./repo.test-support";
import { UPDATE_CHECK_TIMEOUT_MS, type UpdateCheck, updateNotice } from "./update";
import { type Channel, channelOf, type Fetch, newer, upgradeOf } from "./update-channel";

afterEach(removeScratchDirs);

const RUNNING = "0.9.0";

const NOW = Date.parse("2026-11-02T12:00:00Z");

const HOUR_MS = 60 * 60 * 1000;

const README = join(import.meta.dir, "..", "README.md");

const URLS: Readonly<Record<Channel, string>> = {
  homebrew: "https://raw.githubusercontent.com/cniska/homebrew-tap/HEAD/Formula/agent-gates.rb",
  npm: "https://registry.npmjs.org/@cniska/agent-gates/latest",
  bun: "https://registry.npmjs.org/@cniska/agent-gates/latest",
  curl: "https://api.github.com/repos/cniska/agent-gates/releases/latest",
};

const LAYOUTS: Readonly<Record<Channel, string>> = {
  homebrew: "opt/homebrew/Cellar/agent-gates/0.9.0/bin/agent-gates",
  npm: "prefix/lib/node_modules/@cniska/agent-gates/node_modules/@cniska/agent-gates-darwin-arm64/agent-gates",
  bun: ".bun/install/global/node_modules/@cniska/agent-gates-darwin-arm64/agent-gates",
  curl: "home/.local/bin/agent-gates",
};

function formula(...tags: readonly string[]): string {
  return [
    "class AgentGates < Formula",
    ...tags.map(
      (tag) =>
        `      url "https://github.com/cniska/agent-gates/releases/download/${tag}/agent-gates-darwin-arm64.tar.gz"`,
    ),
    "end",
    "",
  ].join("\n");
}

const SERVED: Readonly<Record<Channel, (version: string) => string>> = {
  homebrew: (version) => formula(`v${version}`, `v${version}`),
  npm: (version) => JSON.stringify({ name: "@cniska/agent-gates", version }),
  bun: (version) => JSON.stringify({ name: "@cniska/agent-gates", version }),
  curl: (version) => JSON.stringify({ tag_name: `v${version}` }),
};

type Served = { readonly fetch: Fetch; readonly asked: string[] };

const NEVER_ANSWERS = Symbol("never answers");

const STALLS_MID_BODY = Symbol("stalls mid body");

type Body = string | Error | typeof NEVER_ANSWERS | typeof STALLS_MID_BODY;

function stalledBody(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"version":'));
    },
  });
}

function serving(body: Body, status = 200): Served {
  const asked: string[] = [];
  const fetch: Fetch = (url, { signal }) => {
    asked.push(url);
    if (body instanceof Error) return Promise.reject(body);
    if (body === NEVER_ANSWERS)
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      });
    if (body === STALLS_MID_BODY) return Promise.resolve(new Response(stalledBody(), { status }));
    return Promise.resolve(new Response(body, { status }));
  };
  return { fetch, asked };
}

type Machine = { readonly root: string; readonly home: string; readonly stateFile: string };

function machine(): Machine {
  const root = scratchDir();
  const home = join(root, "home");
  mkdirSync(home);
  return { root, home, stateFile: join(root, "state", "agent-gates", "update-check.json") };
}

function placed(root: string, path: string): string {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, "");
  return file;
}

function checkOn(
  { root, home }: Machine,
  path: string,
  served: Served,
  overrides: Partial<UpdateCheck> = {},
): UpdateCheck {
  return {
    env: { HOME: home, XDG_STATE_HOME: join(root, "state") },
    executable: placed(root, path),
    running: RUNNING,
    now: NOW,
    fetch: served.fetch,
    timeoutMs: UPDATE_CHECK_TIMEOUT_MS,
    ...overrides,
  };
}

function line(latest: string, channel: Channel): string {
  return `agent-gates ${latest} is out (running ${RUNNING}): run ${upgradeOf(channel)}; if you cannot, tell the user.`;
}

describe("channelOf", () => {
  test("reads each channel from where its install puts the binary", () => {
    const home = "/Users/someone";
    expect(channelOf("/opt/homebrew/Cellar/agent-gates/0.9.0/bin/agent-gates", null)).toBe("homebrew");
    expect(channelOf("/home/linuxbrew/.linuxbrew/Cellar/agent-gates/0.9.0_1/bin/agent-gates", null)).toBe(
      "homebrew",
    );
    expect(
      channelOf(
        "/usr/local/lib/node_modules/@cniska/agent-gates/node_modules/@cniska/agent-gates-linux-x64/agent-gates",
        null,
      ),
    ).toBe("npm");
    expect(
      channelOf(
        `${home}/.bun/install/global/node_modules/@cniska/agent-gates-darwin-arm64/agent-gates`,
        null,
      ),
    ).toBe("bun");
    expect(
      channelOf(
        `${home}/.bun/install/global/node_modules/@cniska/agent-gates/node_modules/@cniska/agent-gates-darwin-arm64/agent-gates`,
        null,
      ),
    ).toBe("bun");
    expect(channelOf(`${home}/.local/bin/agent-gates`, `${home}/.local/bin/agent-gates`)).toBe("curl");
  });

  test("tells nothing from a dev checkout, a project's own install or a binary placed by hand", () => {
    const home = "/Users/someone";
    const curl = `${home}/.local/bin/agent-gates`;
    for (const executable of [
      `${home}/.local/share/mise/installs/bun/1.4.2/bin/bun`,
      `${home}/.bun/bin/bun`,
      `${home}/code/app/node_modules/@cniska/agent-gates-darwin-arm64/agent-gates`,
      `${home}/code/app/node_modules/@cniska/agent-gates/node_modules/@cniska/agent-gates-darwin-arm64/agent-gates`,
      "/usr/local/bin/agent-gates",
      `${home}/bin/agent-gates`,
    ])
      expect(channelOf(executable, curl)).toBeNull();
    expect(channelOf(curl, null)).toBeNull();
  });
});

describe("newer", () => {
  test("compares each part as a number", () => {
    expect(newer("0.10.0", "0.9.0")).toBe(true);
    expect(newer("1.0.0", "0.99.99")).toBe(true);
    expect(newer("0.9.1", "0.9.0")).toBe(true);
    expect(newer("0.9.0", "0.9.0")).toBe(false);
    expect(newer("0.8.9", "0.9.0")).toBe(false);
    expect(newer("0.9", "0.8.0")).toBe(false);
  });
});

describe("updateNotice", () => {
  test("asks each channel for its latest version and names that channel's upgrade", async () => {
    for (const channel of ["homebrew", "npm", "bun", "curl"] as const) {
      const at = machine();
      const served = serving(SERVED[channel]("0.9.1"));
      expect(await updateNotice(checkOn(at, LAYOUTS[channel], served))).toBe(line("0.9.1", channel));
      expect(served.asked).toEqual([URLS[channel]]);
    }
  });

  test("checks once a day, and every command in between prints the line from what the check found", async () => {
    const at = machine();
    const served = serving(SERVED.npm("0.9.1"));
    expect(await updateNotice(checkOn(at, LAYOUTS.npm, served))).toBe(line("0.9.1", "npm"));
    expect(await updateNotice(checkOn(at, LAYOUTS.npm, served, { now: NOW + 23 * HOUR_MS }))).toBe(
      line("0.9.1", "npm"),
    );
    expect(served.asked).toHaveLength(1);
    expect(JSON.parse(readFileSync(at.stateFile, "utf8"))).toEqual({
      at: "2026-11-02T12:00:00.000Z",
      channel: "npm",
      latest: "0.9.1",
    });

    const later = serving(SERVED.npm("0.9.2"));
    expect(await updateNotice(checkOn(at, LAYOUTS.npm, later, { now: NOW + 24 * HOUR_MS }))).toBe(
      line("0.9.2", "npm"),
    );
    expect(later.asked).toHaveLength(1);
  });

  test("prints nothing while the running version is the latest, or later than its channel serves", async () => {
    for (const latest of ["0.9.0", "0.8.5"]) {
      const at = machine();
      const served = serving(SERVED.curl(latest));
      expect(await updateNotice(checkOn(at, LAYOUTS.curl, served))).toBeNull();
      expect(served.asked).toHaveLength(1);
    }
  });

  test("counts a check that fails or times out as the day's check, and prints nothing", async () => {
    const failures: readonly [string, Served][] = [
      ["an error", serving(new TypeError("fetch failed"))],
      ["a 503", serving("unavailable", 503)],
      ["a body it cannot read", serving("<html>")],
      ["url lines that disagree", serving(formula("v0.9.1", "v0.9.0"))],
      ["a url line naming no release tag", serving(formula("latest"))],
      ["no url line", serving(formula())],
      ["a channel that never answers", serving(NEVER_ANSWERS)],
      ["a body that stalls", serving(STALLS_MID_BODY)],
    ];
    for (const [, served] of failures) {
      const at = machine();
      const started = performance.now();
      expect(await updateNotice(checkOn(at, LAYOUTS.homebrew, served, { timeoutMs: 50 }))).toBeNull();
      expect(performance.now() - started).toBeLessThan(1000);
      const again = serving(SERVED.homebrew("0.9.1"));
      expect(await updateNotice(checkOn(at, LAYOUTS.homebrew, again, { now: NOW + HOUR_MS }))).toBeNull();
      expect(again.asked).toEqual([]);
    }
  });

  test("checks nothing while it cannot record the day's check", async () => {
    const at = machine();
    const stateHome = dirname(dirname(at.stateFile));
    mkdirSync(stateHome, { recursive: true });
    chmodSync(stateHome, 0o555);
    try {
      const served = serving(SERVED.npm("0.9.1"));
      expect(await updateNotice(checkOn(at, LAYOUTS.npm, served))).toBeNull();
      expect(await updateNotice(checkOn(at, LAYOUTS.npm, served))).toBeNull();
      expect(served.asked).toEqual([]);
    } finally {
      chmodSync(stateHome, 0o755);
    }
  });

  test("checks again when the recorded check is dated after now", async () => {
    const at = machine();
    expect(
      await updateNotice(checkOn(at, LAYOUTS.npm, serving(SERVED.npm("0.9.1")), { now: NOW + 48 * HOUR_MS })),
    ).toBe(line("0.9.1", "npm"));
    const served = serving(SERVED.npm("0.9.2"));
    expect(await updateNotice(checkOn(at, LAYOUTS.npm, served))).toBe(line("0.9.2", "npm"));
    expect(served.asked).toHaveLength(1);
  });

  test("keeps the latest an earlier check found when the day's check fails", async () => {
    const at = machine();
    expect(await updateNotice(checkOn(at, LAYOUTS.bun, serving(SERVED.bun("0.9.1"))))).toBe(
      line("0.9.1", "bun"),
    );
    const failing = serving(new TypeError("fetch failed"));
    expect(await updateNotice(checkOn(at, LAYOUTS.bun, failing, { now: NOW + 25 * HOUR_MS }))).toBe(
      line("0.9.1", "bun"),
    );
    expect(failing.asked).toHaveLength(1);
  });

  test("checks again once the install moves to another channel, never offering one channel's version to another", async () => {
    const at = machine();
    expect(await updateNotice(checkOn(at, LAYOUTS.npm, serving(SERVED.npm("0.9.2"))))).toBe(
      line("0.9.2", "npm"),
    );
    const brew = serving(SERVED.homebrew("0.9.0"));
    expect(await updateNotice(checkOn(at, LAYOUTS.homebrew, brew, { now: NOW + HOUR_MS }))).toBeNull();
    expect(brew.asked).toEqual([URLS.homebrew]);
  });

  test("checks nothing and prints nothing when CI or the off switch is set, for a dev checkout or a hand-placed binary", async () => {
    const at = machine();
    const served = serving(SERVED.curl("0.9.1"));
    for (const env of [{ CI: "true" }, { CI: "" }, { AGENT_GATES_NO_UPDATE_CHECK: "1" }]) {
      const check = checkOn(at, LAYOUTS.curl, served);
      expect(await updateNotice({ ...check, env: { ...check.env, ...env } })).toBeNull();
    }
    for (const path of ["checkout/bun", "usr/local/bin/agent-gates"])
      expect(await updateNotice(checkOn(at, path, served))).toBeNull();
    expect(served.asked).toEqual([]);
    expect(existsSync(at.stateFile)).toBe(false);
  });

  test("keeps its state under ~/.local/state when XDG_STATE_HOME is unset or not absolute", async () => {
    for (const env of [{}, { XDG_STATE_HOME: "relative/state" }]) {
      const at = machine();
      const check = checkOn(at, LAYOUTS.curl, serving(SERVED.curl("0.9.1")));
      expect(await updateNotice({ ...check, env: { HOME: at.home, ...env } })).toBe(line("0.9.1", "curl"));
      expect(existsSync(join(at.home, ".local", "state", "agent-gates", "update-check.json"))).toBe(true);
    }
  });

  test("reads the channel through a symlink to the binary", async () => {
    const at = machine();
    const binary = placed(at.root, LAYOUTS.homebrew);
    const link = join(at.root, "opt", "homebrew", "bin", "agent-gates");
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(binary, link);
    const check = checkOn(at, LAYOUTS.homebrew, serving(SERVED.homebrew("0.9.1")));
    expect(await updateNotice({ ...check, executable: link })).toBe(line("0.9.1", "homebrew"));
  });

  test("rechecks over a state file it cannot read", async () => {
    const at = machine();
    mkdirSync(dirname(at.stateFile), { recursive: true });
    writeFileSync(at.stateFile, "{not json");
    const served = serving(SERVED.npm("0.9.1"));
    expect(await updateNotice(checkOn(at, LAYOUTS.npm, served))).toBe(line("0.9.1", "npm"));
    expect(served.asked).toHaveLength(1);
  });
});

describe("the upgrade commands", () => {
  test("are the ones the README gives", () => {
    const readme = readFileSync(README, "utf8");
    const channels: readonly Channel[] = ["homebrew", "npm", "bun", "curl"];
    for (const channel of channels) expect(readme).toContain(upgradeOf(channel));
  });
});
