import { join } from "node:path";

export type Fetch = (
  url: string,
  init: { readonly signal: AbortSignal; readonly headers: Readonly<Record<string, string>> },
) => Promise<Response>;

const PLATFORM_BUILD = String.raw`@cniska/agent-gates-[a-z0-9]+-[a-z0-9]+/agent-gates$`;

const HOMEBREW_CELLAR = /\/Cellar\/agent-gates\/[^/]+\/bin\/agent-gates$/;

const BUN_GLOBAL = new RegExp(
  String.raw`/install/global/node_modules/(?:@cniska/agent-gates/node_modules/)?${PLATFORM_BUILD}`,
);

const NPM_GLOBAL = new RegExp(
  String.raw`/lib/node_modules/@cniska/agent-gates/node_modules/${PLATFORM_BUILD}`,
);

const CURL_INSTALL = [".local", "bin", "agent-gates"] as const;

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

const TAG = /^v(\d+\.\d+\.\d+)$/;

const FORMULA_URL = /^\s*url\s+"([^"]+)"/gm;

const RELEASE_DOWNLOAD = /\/releases\/download\/([^/]+)\//;

const REGISTRY_LATEST = "https://registry.npmjs.org/@cniska/agent-gates/latest";

const HEADERS: Readonly<Record<string, string>> = { accept: "application/vnd.github+json, */*" };

type Source = {
  readonly installed: (executable: string, curlInstall: string | null) => boolean;
  readonly url: string;
  readonly latest: (body: string) => string | null;
  readonly upgrade: string;
};

const CHANNELS = {
  homebrew: {
    installed: (executable) => HOMEBREW_CELLAR.test(executable),
    url: "https://raw.githubusercontent.com/cniska/homebrew-tap/HEAD/Formula/agent-gates.rb",
    latest: formulaVersion,
    upgrade: "brew upgrade agent-gates",
  },
  npm: {
    installed: (executable) => NPM_GLOBAL.test(executable),
    url: REGISTRY_LATEST,
    latest: registryVersion,
    upgrade: "npm update -g @cniska/agent-gates",
  },
  bun: {
    installed: (executable) => BUN_GLOBAL.test(executable),
    url: REGISTRY_LATEST,
    latest: registryVersion,
    upgrade: "bun update -g @cniska/agent-gates",
  },
  curl: {
    installed: (executable, curlInstall) => executable === curlInstall,
    url: "https://api.github.com/repos/cniska/agent-gates/releases/latest",
    latest: releaseVersion,
    upgrade: "curl -fsSL https://github.com/cniska/agent-gates/releases/latest/download/install.sh | sh",
  },
} as const satisfies Readonly<Record<string, Source>>;

export type Channel = keyof typeof CHANNELS;

export function isChannel(value: unknown): value is Channel {
  return typeof value === "string" && Object.hasOwn(CHANNELS, value);
}

export function upgradeOf(channel: Channel): string {
  return CHANNELS[channel].upgrade;
}

export function channelOf(executable: string, curlInstall: string | null): Channel | null {
  const sources: readonly [string, Source][] = Object.entries(CHANNELS);
  const [found = null] = sources.find(([, source]) => source.installed(executable, curlInstall)) ?? [];
  return isChannel(found) ? found : null;
}

export function curlInstallIn(home: string): string {
  return join(home, ...CURL_INSTALL);
}

export function isVersion(text: string): boolean {
  return VERSION.test(text);
}

export function newer(candidate: string, running: string): boolean {
  const [a, b] = [partsOf(candidate), partsOf(running)];
  if (a === null || b === null) return false;
  const differing = a.findIndex((part, index) => part !== b[index]);
  return differing !== -1 && (a[differing] ?? 0) > (b[differing] ?? 0);
}

function partsOf(version: string): readonly number[] | null {
  const parts = VERSION.exec(version);
  return parts === null ? null : parts.slice(1).map(Number);
}

function versionOfTag(tag: string): string | null {
  return TAG.exec(tag)?.[1] ?? null;
}

function stringField(body: string, field: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !(field in parsed)) return null;
  const value: unknown = Reflect.get(parsed, field);
  return typeof value === "string" ? value : null;
}

function registryVersion(body: string): string | null {
  const version = stringField(body, "version");
  return version !== null && isVersion(version) ? version : null;
}

function releaseVersion(body: string): string | null {
  const tag = stringField(body, "tag_name");
  return tag === null ? null : versionOfTag(tag);
}

function formulaVersion(formula: string): string | null {
  const tags = [...formula.matchAll(FORMULA_URL)].map(
    (match) => RELEASE_DOWNLOAD.exec(match[1] ?? "")?.[1] ?? null,
  );
  const [first = null] = tags;
  if (first === null || !tags.every((tag) => tag === first)) return null;
  return versionOfTag(first);
}

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

export async function latestOrNull(
  channel: Channel,
  fetch: Fetch,
  timeoutMs: number,
): Promise<string | null> {
  const { url, latest }: Source = CHANNELS[channel];
  const signal = AbortSignal.timeout(timeoutMs);
  const read = async (): Promise<string | null> => {
    const response = await fetch(url, { signal, headers: HEADERS });
    return response.ok ? latest(await response.text()) : null;
  };
  try {
    return await Promise.race([read(), aborted(signal)]);
  } catch {
    return null;
  }
}
