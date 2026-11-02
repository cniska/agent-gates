import { afterEach, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { dirname, join } from "node:path";
import {
  compiledBinary,
  packageVersion,
  removeScratchDirs,
  run,
  runCheckingUpdates,
  scratchDir,
  toonOf,
  type Env,
} from "./cli";

afterEach(removeScratchDirs);

const BUILD_TIMEOUT_MS = 60_000;

const DAY_MS = 24 * 60 * 60 * 1000;

const TARGET = `${process.platform}-${process.arch}`;

const UPGRADES = {
  homebrew: "brew upgrade agent-gates",
  npm: "npm update -g @cniska/agent-gates",
  bun: "bun update -g @cniska/agent-gates",
  curl: "curl -fsSL https://github.com/cniska/agent-gates/releases/latest/download/install.sh | sh",
} as const;

type Channel = keyof typeof UPGRADES;

const CHANNELS = Object.keys(UPGRADES).filter((name): name is Channel => name in UPGRADES);

const LAYOUTS: Readonly<Record<Channel, string>> = {
  homebrew: "opt/homebrew/Cellar/agent-gates/0.0.1/bin/agent-gates",
  npm: `prefix/lib/node_modules/@cniska/agent-gates/node_modules/@cniska/agent-gates-${TARGET}/agent-gates`,
  bun: `home/.bun/install/global/node_modules/@cniska/agent-gates-${TARGET}/agent-gates`,
  curl: "home/.local/bin/agent-gates",
};

function later(version: string): string {
  const [major = "0", minor = "0", patch = "0"] = version.split(".");
  return `${major}.${minor}.${Number(patch) + 1}`;
}

function placed(binary: string, root: string, path: string): string {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  copyFileSync(binary, file);
  return file;
}

function passFirstExecVerification(executable: string, cwd: string): void {
  run(executable, ["--version"], cwd);
}

function recorded(stateHome: string, channel: Channel, at: number, latest: string): string {
  const file = join(stateHome, "agent-gates", "update-check.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ at: new Date(at).toISOString(), channel, latest })}\n`);
  return file;
}

function notice(latest: string, channel: Channel): string {
  return `agent-gates ${latest} is out (running ${packageVersion()}): run ${UPGRADES[channel]}; if you cannot, tell the user.\n`;
}

type Machine = { readonly root: string; readonly env: Env };

function machine(): Machine {
  const root = scratchDir();
  mkdirSync(join(root, "home"), { recursive: true });
  return { root, env: { HOME: join(root, "home"), XDG_STATE_HOME: join(root, "state") } };
}

function silentProxy(): Promise<{ readonly server: Server; readonly url: string }> {
  const server = createServer(() => undefined);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

test(
  "AC-75 the release binary, where each channel installs it and past a check that found a later version, prints the line on stderr and leaves stdout and the exit status alone",
  () => {
    const binary = compiledBinary(scratchDir());
    const latest = later(packageVersion());
    for (const channel of CHANNELS) {
      const { root, env } = machine();
      const executable = placed(binary, root, LAYOUTS[channel]);
      recorded(join(root, "state"), channel, Date.now(), latest);

      expect(runCheckingUpdates(executable, ["--version"], root, env)).toEqual({
        status: 0,
        stdout: `${packageVersion()}\n`,
        stderr: notice(latest, channel),
      });

      const refused = runCheckingUpdates(executable, ["nonsense"], root, env);
      expect([refused.status, refused.stdout]).toEqual([2, ""]);
      expect(refused.stderr.startsWith(notice(latest, channel))).toBe(true);
      expect(toonOf(refused.stderr.slice(notice(latest, channel).length))).toMatchObject({
        ok: false,
        error: { code: "unknown_command" },
      });
    }

    const { root, env } = machine();
    const curl = placed(binary, root, LAYOUTS.curl);
    const state = recorded(join(root, "state"), "curl", Date.now(), latest);
    const offSwitches: readonly Env[] = [{ CI: "true" }, { AGENT_GATES_NO_UPDATE_CHECK: "1" }];
    for (const off of offSwitches)
      expect(runCheckingUpdates(curl, ["--version"], root, { ...env, ...off })).toEqual({
        status: 0,
        stdout: `${packageVersion()}\n`,
        stderr: "",
      });
    const byHand = placed(binary, root, "usr/local/bin/agent-gates");
    expect(runCheckingUpdates(byHand, ["--version"], root, env).stderr).toBe("");
    expect(JSON.parse(readFileSync(state, "utf8"))).toMatchObject({ channel: "curl", latest });
  },
  BUILD_TIMEOUT_MS,
);

test(
  "AC-76 a channel that cannot be reached or never answers counts as the day's check, keeps the version an earlier check found and holds the command about a second at most",
  async () => {
    const binary = compiledBinary(scratchDir());
    const latest = later(packageVersion());
    const { server, url } = await silentProxy();
    try {
      for (const proxy of ["http://127.0.0.1:9", url]) {
        const { root, env } = machine();
        const executable = placed(binary, root, LAYOUTS.npm);
        const state = recorded(join(root, "state"), "npm", Date.now() - 2 * DAY_MS, latest);
        const proxied = { ...env, HTTPS_PROXY: proxy, HTTP_PROXY: proxy };

        passFirstExecVerification(executable, root);
        const started = Date.now();
        const ran = runCheckingUpdates(executable, ["--version"], root, proxied);
        expect(Date.now() - started).toBeLessThan(3000);
        expect(ran).toEqual({ status: 0, stdout: `${packageVersion()}\n`, stderr: notice(latest, "npm") });
        const checked = JSON.parse(readFileSync(state, "utf8"));
        expect(checked).toMatchObject({ channel: "npm", latest });
        expect(Date.now() - Date.parse(checked.at)).toBeLessThan(DAY_MS);

        const fresh = machine();
        const first = placed(binary, fresh.root, LAYOUTS.curl);
        expect(
          runCheckingUpdates(first, ["--version"], fresh.root, {
            ...fresh.env,
            HTTPS_PROXY: proxy,
            HTTP_PROXY: proxy,
          }),
        ).toEqual({ status: 0, stdout: `${packageVersion()}\n`, stderr: "" });
        expect(existsSync(join(fresh.root, "state", "agent-gates", "update-check.json"))).toBe(true);
      }
    } finally {
      server.close();
    }
  },
  BUILD_TIMEOUT_MS,
);
