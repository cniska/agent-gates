import { gitOutput, nulFields } from "./git";

export const HEAD_SPAN = 400;

const GENERATED = /\bGENERATED\b/;

const AUTO_GENERATED = /\bauto-generated\b/i;

const ATTRIBUTES = ["linguist-generated", "linguist-vendored"];

const FIELDS_PER_ATTRIBUTE = 3;

export function marksGenerated(text: string): boolean {
  const head = text.slice(0, HEAD_SPAN);
  return GENERATED.test(head) || AUTO_GENERATED.test(head);
}

export function firstLine(text: string): string {
  const end = text.indexOf("\n");
  return end === -1 ? text : text.slice(0, end);
}

export function outsideTheCode(root: string, paths: readonly string[]): Set<string> {
  if (paths.length === 0) return new Set();
  const fields = nulFields(
    gitOutput(
      root,
      ["--literal-pathspecs", "check-attr", "--cached", "-z", "--stdin", ...ATTRIBUTES],
      paths.map((path) => `${path}\0`).join(""),
    ),
  );
  const outside = new Set<string>();
  for (let at = 0; at + FIELDS_PER_ATTRIBUTE <= fields.length; at += FIELDS_PER_ATTRIBUTE) {
    const path = fields[at];
    const value = fields[at + 2];
    if (path !== undefined && (value === "set" || value === "true")) outside.add(path);
  }
  return outside;
}
