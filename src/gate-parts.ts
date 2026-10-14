import { LANGUAGE_NAMES, type Language } from "./no-comments-languages";

export type NoCommentsGate = `no-comments-${Language}`;

export function noCommentsGate(language: Language): NoCommentsGate {
  return `no-comments-${language}`;
}

export type GateName = "commit-subject" | "format" | NoCommentsGate;

export const GATE_NAMES: readonly GateName[] = [
  "commit-subject",
  "format",
  ...LANGUAGE_NAMES.map(noCommentsGate),
];

export function isGateName(name: string): name is GateName {
  return GATE_NAMES.some((gate) => gate === name);
}

const SHARED_PARTS = ["githooks", "no-comments"] as const;

type SharedPart = (typeof SHARED_PARTS)[number];

export type Part = GateName | SharedPart;

function isSharedPart(name: string): name is SharedPart {
  return SHARED_PARTS.some((part) => part === name);
}

export function isPart(name: string): name is Part {
  return isSharedPart(name) || isGateName(name);
}
