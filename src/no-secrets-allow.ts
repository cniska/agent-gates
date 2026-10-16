import { refusals } from "./coded-error";

export const ALLOW_FILE = ".no-secrets-allow";

const HASH_PREFIX = 16;

const SEPARATOR = ":";

const FINGERPRINT = /^[a-z0-9-]+:.+:[0-9a-f]{16}$/;

const allowRefusal = refusals<{
  readonly malformed_allow_line: { readonly line: number; readonly text: string };
}>({
  malformed_allow_line: {
    message: ({ line, text }) => `${ALLOW_FILE} line ${line} is not a fingerprint: ${text}`,
    resolve: () =>
      `keep only fingerprints the no-secrets reply printed in ${ALLOW_FILE}, one per line, blank lines aside`,
  },
});

export function fingerprintOf(rule: string, path: string, hash: string): string {
  return [rule, path, hash.slice(0, HASH_PREFIX)].join(SEPARATOR);
}

export function parsedAllow(text: string | null): ReadonlySet<string> {
  if (text === null) return new Set();
  const allowed = new Set<string>();
  for (const [index, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (line === "") continue;
    if (!FINGERPRINT.test(line)) throw allowRefusal("malformed_allow_line", { line: index + 1, text: line });
    allowed.add(line);
  }
  return allowed;
}
