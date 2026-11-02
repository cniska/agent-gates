import { realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  type Channel,
  channelOf,
  curlInstallIn,
  type Fetch,
  latestOrNull,
  newer,
  upgradeOf,
} from "./update-channel";
import { type Checked, checkedOrNull, recorded } from "./update-state";

export const UPDATE_CHECK_TIMEOUT_MS = 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

const OFF_SWITCHES = ["CI", "AGENT_GATES_NO_UPDATE_CHECK"] as const;

const STATE_FILE = ["agent-gates", "update-check.json"] as const;

const DEFAULT_STATE_HOME = [".local", "state"] as const;

export type UpdateCheck = {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly executable: string;
  readonly running: string;
  readonly now: number;
  readonly fetch: Fetch;
  readonly timeoutMs: number;
};

function absoluteOrNull(path: string | undefined): string | null {
  return path !== undefined && isAbsolute(path) ? path : null;
}

function realOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function stateFileIn(env: UpdateCheck["env"], home: string | null): string | null {
  const stateHome =
    absoluteOrNull(env.XDG_STATE_HOME) ?? (home === null ? null : join(home, ...DEFAULT_STATE_HOME));
  return stateHome === null ? null : join(stateHome, ...STATE_FILE);
}

function due(known: Checked | null, channel: Channel, now: number): boolean {
  return known === null || known.channel !== channel || now < known.at || now - known.at >= DAY_MS;
}

async function latestKnown(check: UpdateCheck, channel: Channel, stateFile: string): Promise<string | null> {
  const known = checkedOrNull(stateFile);
  const before = known?.channel === channel ? known.latest : null;
  if (!due(known, channel, check.now)) return before;
  if (!recorded(stateFile, { at: check.now, channel, latest: before })) return before;
  const found = await latestOrNull(channel, check.fetch, check.timeoutMs);
  if (found === null) return before;
  recorded(stateFile, { at: check.now, channel, latest: found });
  return found;
}

export async function updateNotice(check: UpdateCheck): Promise<string | null> {
  if (OFF_SWITCHES.some((name) => check.env[name] !== undefined)) return null;
  const home = absoluteOrNull(check.env.HOME);
  const executable = realOrNull(check.executable);
  if (executable === null) return null;
  const channel = channelOf(executable, home === null ? null : realOrNull(curlInstallIn(home)));
  const stateFile = stateFileIn(check.env, home);
  if (channel === null || stateFile === null) return null;
  const latest = await latestKnown(check, channel, stateFile);
  if (latest === null || !newer(latest, check.running)) return null;
  return `agent-gates ${latest} is out (running ${check.running}): run ${upgradeOf(channel)}; if you cannot, tell the user.`;
}
