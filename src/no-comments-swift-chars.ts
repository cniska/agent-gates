type Ranges = readonly (readonly [number, number])[];

const IDENTIFIER_CONTINUE: Ranges = [
  [0xa8, 0xa8],
  [0xaa, 0xaa],
  [0xad, 0xad],
  [0xaf, 0xaf],
  [0xb2, 0xb5],
  [0xb7, 0xba],
  [0xbc, 0xbe],
  [0xc0, 0xd6],
  [0xd8, 0xf6],
  [0xf8, 0xff],
  [0x100, 0x167f],
  [0x1681, 0x180d],
  [0x180f, 0x1fff],
  [0x200b, 0x200d],
  [0x202a, 0x202e],
  [0x203f, 0x2040],
  [0x2054, 0x2054],
  [0x2060, 0x206f],
  [0x2070, 0x218f],
  [0x2460, 0x24ff],
  [0x2776, 0x2793],
  [0x2c00, 0x2dff],
  [0x2e80, 0x2fff],
  [0x3004, 0x3007],
  [0x3021, 0x302f],
  [0x3031, 0x303f],
  [0x3040, 0xd7ff],
  [0xf900, 0xfd3d],
  [0xfd40, 0xfdcf],
  [0xfdf0, 0xfe44],
  [0xfe47, 0xfff8],
  ...Array.from(
    { length: 14 },
    (_, plane) => [(plane + 1) * 0x10000, (plane + 1) * 0x10000 + 0xfffd] as const,
  ),
];

const COMBINING: Ranges = [
  [0x300, 0x36f],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe20, 0xfe2f],
];

const OPERATOR_START: Ranges = [
  [0xa1, 0xa7],
  [0xa9, 0xa9],
  [0xab, 0xac],
  [0xae, 0xae],
  [0xb0, 0xb1],
  [0xb6, 0xb6],
  [0xbb, 0xbb],
  [0xbf, 0xbf],
  [0xd7, 0xd7],
  [0xf7, 0xf7],
  [0x2016, 0x2017],
  [0x2020, 0x2027],
  [0x2030, 0x203e],
  [0x2041, 0x2053],
  [0x2055, 0x205e],
  [0x2190, 0x23ff],
  [0x2500, 0x2775],
  [0x2794, 0x2bff],
  [0x2e00, 0x2e7f],
  [0x3001, 0x3003],
  [0x3008, 0x3030],
];

const OPERATOR_CONTINUE: Ranges = [...COMBINING, [0xfe00, 0xfe0f], [0xe0100, 0xe01ef]];

const ASCII_OPERATOR = "/=-+*%<>!&|^~.?";

const ASCII_IDENTIFIER_START = /^[A-Za-z_]$/;

const ASCII_IDENTIFIER_CONTINUE = /^[A-Za-z0-9_$]$/;

const ASCII_LIMIT = 0x80;

function within(ranges: Ranges, code: number): boolean {
  return ranges.some(([low, high]) => code >= low && code <= high);
}

export function isIdentifierContinue(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  if (code < ASCII_LIMIT) return ASCII_IDENTIFIER_CONTINUE.test(char);
  return within(IDENTIFIER_CONTINUE, code);
}

export function isIdentifierStart(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  if (code < ASCII_LIMIT) return ASCII_IDENTIFIER_START.test(char);
  return within(IDENTIFIER_CONTINUE, code) && !within(COMBINING, code);
}

export function isOperatorStart(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  if (code < ASCII_LIMIT) return char !== "" && ASCII_OPERATOR.includes(char);
  return within(OPERATOR_START, code);
}

export function isOperatorContinue(char: string): boolean {
  return isOperatorStart(char) || within(OPERATOR_CONTINUE, char.codePointAt(0) ?? 0);
}
