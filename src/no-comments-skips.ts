import { gitOutput, nulFields } from "./git";

const ATTRIBUTES = ["linguist-generated", "linguist-vendored"];

const FIELDS_PER_ATTRIBUTE = 3;

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
