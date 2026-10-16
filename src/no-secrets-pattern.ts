export type Pattern = { readonly source: string; readonly flags: string };

type Flag = "i" | "s" | "m";

const FLAG_ORDER: readonly Flag[] = ["i", "m", "s"];

const ESCAPE = "\\";

const CLASS_OPEN = "[";

const CLASS_CLOSE = "]";

const GROUP_OPEN = "(";

const GROUP_CLOSE = ")";

const ALTERNATIVE = "|";

const ANY = ".";

const NOT_NEWLINE = "[^\\n]";

const ANYTHING = "[\\s\\S]";

const NEGATED_CASE_GROUP = "(?-i:";

const SINGLE_LINE_ANY = "(?s:.)";

const NAMED_GROUP_PYTHON = "(?P<";

const NAMED_GROUP = "(?<";

const NON_CAPTURING = "(?:";

const MODIFIERS = /^\(\?(-?)([ism]*)([:)])/;

const POSIX_CLASS = /^\[:(\w+):\]/;

const POSIX_RANGES: Readonly<Record<string, string>> = {
  alnum: "a-zA-Z0-9",
  alpha: "a-zA-Z",
  digit: "0-9",
  lower: "a-z",
  upper: "A-Z",
  space: " \\t\\n\\r\\f\\v",
  word: "\\w",
  xdigit: "0-9A-Fa-f",
};

const END_OF_TEXT = "z";

const START_OF_TEXT = "A";

const HEX_ESCAPE = "x";

const HEX_PAIR = /^[0-9A-Fa-f]{2}$/;

const ALPHANUMERIC = /^[A-Za-z0-9]$/;

const SHARED_ESCAPES: ReadonlySet<string> = new Set("dDwWsSbBtnrfv");

type Walk = { readonly out: string; readonly flags: ReadonlySet<Flag> } | null;

function flagsOf(letters: string, flags: ReadonlySet<Flag>): ReadonlySet<Flag> {
  const added = new Set(flags);
  for (const letter of letters) if (letter === "i" || letter === "s" || letter === "m") added.add(letter);
  return added;
}

function escaped(re2: string, at: number, flags: ReadonlySet<Flag>, inClass: boolean): string | null {
  const next = re2[at + 1];
  if (next === undefined) return null;
  if (!inClass && next === END_OF_TEXT) return flags.has("m") ? null : "$";
  if (!inClass && next === START_OF_TEXT) return flags.has("m") ? null : "^";
  if (next === HEX_ESCAPE) return HEX_PAIR.test(re2.slice(at + 2, at + 4)) ? `${ESCAPE}${next}` : null;
  if (SHARED_ESCAPES.has(next) || !ALPHANUMERIC.test(next)) return `${ESCAPE}${next}`;
  return null;
}

function groupOpening(
  rest: string,
): { readonly out: string; readonly length: number; readonly letters: string } | null {
  if (rest.startsWith(SINGLE_LINE_ANY)) return { out: ANYTHING, length: SINGLE_LINE_ANY.length, letters: "" };
  const modifiers = MODIFIERS.exec(rest);
  if (modifiers !== null) {
    const [whole, , letters, close] = modifiers;
    return { out: close === ":" ? NON_CAPTURING : "", length: whole.length, letters: letters ?? "" };
  }
  if (rest.startsWith(NAMED_GROUP_PYTHON))
    return { out: NAMED_GROUP, length: NAMED_GROUP_PYTHON.length, letters: "" };
  if (/^\(\?<[A-Za-z]/.test(rest)) return { out: NAMED_GROUP, length: NAMED_GROUP.length, letters: "" };
  return null;
}

function walked(re2: string): Walk {
  let out = "";
  let flags: ReadonlySet<Flag> = new Set();
  let inClass = false;
  let at = 0;
  while (at < re2.length) {
    const char = re2[at];
    if (char === undefined) break;
    if (char === ESCAPE) {
      const piece = escaped(re2, at, flags, inClass);
      if (piece === null) return null;
      out += piece;
      at += 2;
      continue;
    }
    if (inClass) {
      const posix = POSIX_CLASS.exec(re2.slice(at));
      if (posix !== null) {
        const range = POSIX_RANGES[posix[1] ?? ""];
        if (range === undefined) return null;
        out += range;
        at += posix[0].length;
        continue;
      }
      if (char === CLASS_CLOSE) inClass = false;
      out += char;
      at += 1;
      continue;
    }
    if (char === CLASS_OPEN) {
      inClass = true;
      out += char;
      at += 1;
      continue;
    }
    if (char === ANY) {
      out += flags.has("s") ? ANY : NOT_NEWLINE;
      at += 1;
      continue;
    }
    if (char === GROUP_OPEN && re2[at + 1] === "?") {
      const opening = groupOpening(re2.slice(at));
      if (opening === null) return null;
      flags = flagsOf(opening.letters, flags);
      out += opening.out;
      at += opening.length;
      continue;
    }
    out += char;
    at += 1;
  }
  return inClass ? null : { out, flags };
}

function compiles(source: string, flags: string): boolean {
  try {
    new RegExp(source, flags);
    return true;
  } catch {
    return false;
  }
}

export function rulePattern(re2: string): Pattern | null {
  const walk = walked(re2);
  if (walk === null) return null;
  const flags = FLAG_ORDER.filter((flag) => walk.flags.has(flag)).join("");
  return compiles(walk.out, flags) ? { source: walk.out, flags } : null;
}

type Frame = { readonly altStart: number };

function alternativeAround(re2: string, target: number): readonly [number, number] | null {
  const frames: Frame[] = [{ altStart: 0 }];
  let inClass = false;
  let at = 0;
  while (at < re2.length) {
    const char = re2[at];
    if (char === ESCAPE) {
      at += 2;
      continue;
    }
    if (inClass) {
      if (char === CLASS_CLOSE) inClass = false;
      at += 1;
      continue;
    }
    if (char === CLASS_OPEN) inClass = true;
    if (char === GROUP_OPEN) {
      const opening = re2[at + 1] === "?" ? groupOpening(re2.slice(at)) : null;
      const length = opening === null ? 1 : opening.length;
      frames.push({ altStart: at + length });
      at += length;
      continue;
    }
    if (char === ALTERNATIVE || char === GROUP_CLOSE) {
      const frame = frames.at(-1);
      if (frame !== undefined && frame.altStart <= target && target < at) return [frame.altStart, at];
      if (char === GROUP_CLOSE) frames.pop();
      else if (frame !== undefined) frames[frames.length - 1] = { altStart: at + 1 };
    }
    at += 1;
  }
  const frame = frames.at(-1);
  return frame !== undefined && frame.altStart <= target ? [frame.altStart, re2.length] : null;
}

function withoutNegatedAlternatives(re2: string): string | null {
  let pattern = re2;
  for (;;) {
    const target = pattern.indexOf(NEGATED_CASE_GROUP);
    if (target < 0) return pattern;
    const span = alternativeAround(pattern, target);
    if (span === null) return null;
    const [start, end] = span;
    if (pattern[end] === ALTERNATIVE) pattern = pattern.slice(0, start) + pattern.slice(end + 1);
    else if (pattern[start - 1] === ALTERNATIVE) pattern = pattern.slice(0, start - 1) + pattern.slice(end);
    else pattern = pattern.slice(0, start) + pattern.slice(end);
  }
}

export function allowPattern(re2: string): Pattern | null {
  const narrowed = withoutNegatedAlternatives(re2);
  return narrowed === null ? null : rulePattern(narrowed);
}
