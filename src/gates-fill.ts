import { eachFill, type Fill } from "./gates-contract";

const VALUE = "((?:[^']|'\\\\'')*)";

const LINES = eachFill((fill) => new RegExp(`^${fill}='${VALUE}'$`, "m"));

function quoted(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function withFill(template: string, fill: Fill, value: string): string {
  return template.replace(LINES[fill], () => `${fill}=${quoted(value)}`);
}

export function fillTemplateOf(text: string, fill: Fill): string {
  return text.replace(LINES[fill], `${fill}=''`);
}

export function filledIn(text: string, fill: Fill): string | null {
  const value = LINES[fill].exec(text)?.[1];
  if (value === undefined || value === "") return null;
  return value.replaceAll("'\\''", "'");
}
