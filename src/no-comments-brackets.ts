import { type Stopped, unexpected, unterminated } from "./no-comments-spans";

const BRACKET_PAIRS = [
  { open: "(", close: ")", name: "parenthesis" },
  { open: "[", close: "]", name: "bracket" },
  { open: "{", close: "}", name: "brace" },
] as const;

type BracketPair = (typeof BRACKET_PAIRS)[number];

export type Brackets = {
  readonly has: (char: string) => boolean;
  readonly isEmpty: () => boolean;
  readonly take: (at: number, char: string) => Stopped | null;
  readonly unclosed: () => Stopped | null;
};

export function bracketsOf(opens: readonly BracketPair["open"][]): Brackets {
  const pairs = BRACKET_PAIRS.filter(({ open }) => opens.includes(open));
  const stack: { readonly at: number; readonly pair: BracketPair }[] = [];
  return {
    has: (char) => pairs.some(({ open, close }) => char === open || char === close),
    isEmpty: () => stack.length === 0,
    take: (at, char) => {
      const pair = pairs.find(({ open }) => open === char);
      if (pair !== undefined) {
        stack.push({ at, pair });
        return null;
      }
      if (stack.at(-1)?.pair.close !== char) return unexpected(at, char);
      stack.pop();
      return null;
    },
    unclosed: () => {
      const innermost = stack.at(-1);
      return innermost === undefined ? null : unterminated(innermost.at, innermost.pair.name);
    },
  };
}
