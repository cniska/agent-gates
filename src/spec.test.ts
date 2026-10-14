import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { importsOf, testNamesOf } from "./syntax.test-support";

const ROOT = join(import.meta.dir, "..");

const ACCEPTANCE = join(ROOT, "acceptance");

const ACCEPTANCE_SUFFIX = ".acceptance.ts";

const TS_SUFFIX = ".ts";

const RELATIVE = /^\.\.?\//;

const NOT_CITED = new Set(["AC", "C", "D"]);

const DEFINED = /^- \*\*([A-Z]+-[^*]+)\*\* —(.*)$/gm;

const CITATIONS = /\(([A-Z]+-\w+(?:, [A-Z]+-\w+)*)\)$/;

const NAMED_CRITERIA = /^(?:AC-\d+ )+/;

const WHOLE_NUMBER = /^[A-Z]+-[1-9]\d*$/;

type Defined = { readonly id: string; readonly cites: readonly string[] | null };

function familyOf(id: string): string {
  return id.slice(0, id.indexOf("-"));
}

function definedIn(spec: string): readonly Defined[] {
  return [...spec.matchAll(DEFINED)].flatMap(([, id, rest]) => {
    if (id === undefined || rest === undefined) return [];
    const cites = CITATIONS.exec(rest.trimEnd())?.[1]?.split(", ") ?? null;
    return [{ id, cites: familyOf(id) === "AC" ? cites : null }];
  });
}

function numbering(ids: readonly string[]): readonly string[] {
  const problems = ids
    .filter((id) => !WHOLE_NUMBER.test(id))
    .map((id) => `${id} is not a family and a whole number`);
  for (const family of new Set(ids.map(familyOf))) {
    const numbered = ids.filter((id) => familyOf(id) === family && WHOLE_NUMBER.test(id));
    const expected = numbered.map((_, index) => `${family}-${index + 1}`);
    if (numbered.join() !== expected.join())
      problems.push(`${family} is numbered ${numbered.join(", ")}, not from 1 without gaps`);
  }
  return problems;
}

function criteriaCitations(defined: readonly Defined[]): readonly string[] {
  const criteria = defined.filter(({ id }) => familyOf(id) === "AC");
  const cited = new Set(criteria.flatMap(({ cites }) => cites ?? []));
  return [
    ...criteria.filter(({ cites }) => cites === null).map(({ id }) => `${id} cites no requirement`),
    ...defined
      .filter(({ id }) => !NOT_CITED.has(familyOf(id)) && !cited.has(id))
      .map(({ id }) => `${id} is cited by no criterion`),
  ];
}

function undefinedMentions(spec: string, defined: readonly Defined[]): readonly string[] {
  const ids = new Set(defined.map(({ id }) => id));
  const families = [...new Set(defined.map(({ id }) => familyOf(id)))].join("|");
  const mention = new RegExp(`\\b(?:${families})-\\w+\\b`, "g");
  const cited = defined.flatMap(({ cites }) => cites ?? []);
  return [...new Set([...(spec.match(mention) ?? []), ...cited])]
    .filter((id) => !ids.has(id))
    .map((id) => `${id} is mentioned but not defined`);
}

function testCitations(criteria: readonly string[], names: readonly (string | null)[]): readonly string[] {
  const problems: string[] = [];
  const proven = new Set<string>();
  for (const name of names) {
    if (name === null) {
      problems.push("an acceptance test's name is not a string literal");
      continue;
    }
    const cited = NAMED_CRITERIA.exec(name)?.[0].trim().split(" ") ?? [];
    if (cited.length === 0) problems.push(`acceptance test "${name}" cites no criterion`);
    for (const id of cited) {
      proven.add(id);
      if (!criteria.includes(id))
        problems.push(`acceptance test "${name}" cites ${id}, which the spec does not define`);
    }
  }
  return [
    ...problems,
    ...criteria.filter((id) => !proven.has(id)).map((id) => `${id} has no acceptance test or todo`),
  ];
}

function citationProblems(spec: string, sources: readonly string[]): readonly string[] {
  const defined = definedIn(spec);
  const names = sources.flatMap(testNamesOf);
  const criteria = defined.filter(({ id }) => familyOf(id) === "AC").map(({ id }) => id);
  const empty = [
    ...(criteria.length === 0 ? ["the spec defines no acceptance criterion"] : []),
    ...(names.length === 0 ? ["the acceptance suite holds no test"] : []),
  ];
  if (empty.length > 0) return empty;
  return [
    ...numbering(defined.map(({ id }) => id)),
    ...criteriaCitations(defined),
    ...undefinedMentions(spec, defined),
    ...testCitations(criteria, names),
  ];
}

function importsOutside(dir: string, file: string, text: string): readonly string[] {
  return importsOf(text)
    .filter((path) => RELATIVE.test(path) && relative(dir, resolve(dir, path)).startsWith(".."))
    .map((path) => `${file} imports ${path}, outside the acceptance suite`);
}

const SPEC = `
- **FR-1** — Does one thing.
- **FR-2** — Does another.
- **NF-1** — Needs nothing else.
- **D-1** — Ships a binary.
- **C-1** — Runs on Bun.
- **AC-1** — Run it bare: it does one thing, needing nothing. (FR-1, NF-1)
- **AC-2** — Run it again: it does another. (FR-2)
`;

const PROVEN = `test("AC-1 it does one thing", () => {});`;

const TESTS = [PROVEN, `test.todo("AC-2 it does another");`];

describe("the spec and the acceptance suite", () => {
  test("cite each other completely", () => {
    const spec = readFileSync(join(ROOT, "SPEC.md"), "utf8");
    const sources = readdirSync(ACCEPTANCE)
      .filter((file) => file.endsWith(ACCEPTANCE_SUFFIX))
      .map((file) => readFileSync(join(ACCEPTANCE, file), "utf8"));
    expect(citationProblems(spec, sources)).toEqual([]);
  });
});

describe("the acceptance suite", () => {
  test("imports nothing from outside its own directory", () => {
    const files = readdirSync(ACCEPTANCE).filter((file) => file.endsWith(TS_SUFFIX));
    expect(
      files.flatMap((file) => importsOutside(ACCEPTANCE, file, readFileSync(join(ACCEPTANCE, file), "utf8"))),
    ).toEqual([]);
  });
});

describe("the import check", () => {
  test("flags an import that reaches outside the suite, however it is written", () => {
    const text = [
      'import { GATES } from "../src/gates-contract";',
      'const cli = await import("../src/cli");',
      'import { run } from "./cli";',
      'import { join } from "node:path";',
    ].join("\n");
    expect(importsOutside("/repo/acceptance", "a.acceptance.ts", text)).toEqual([
      "a.acceptance.ts imports ../src/gates-contract, outside the acceptance suite",
      "a.acceptance.ts imports ../src/cli, outside the acceptance suite",
    ]);
  });
});

describe("the citation check", () => {
  test("passes a spec and suite that cite each other completely", () => {
    expect(citationProblems(SPEC, TESTS)).toEqual([]);
  });

  test("fails an empty spec and suite rather than passing them", () => {
    expect(citationProblems("", [])).toEqual([
      "the spec defines no acceptance criterion",
      "the acceptance suite holds no test",
    ]);
  });

  test("flags a test whose name cites no criterion", () => {
    expect(citationProblems(SPEC, [...TESTS, `test("it does a third thing", () => {});`])).toEqual([
      'acceptance test "it does a third thing" cites no criterion',
    ]);
  });

  test("flags a test citing a criterion the spec does not define", () => {
    expect(citationProblems(SPEC, [...TESTS, `test.todo("AC-1 AC-9 it does more");`])).toEqual([
      'acceptance test "AC-1 AC-9 it does more" cites AC-9, which the spec does not define',
    ]);
  });

  test("flags a test whose name is not a string literal", () => {
    expect(citationProblems(SPEC, [...TESTS, "test(name, () => {});"])).toEqual([
      "an acceptance test's name is not a string literal",
    ]);
  });

  test("flags a criterion with neither a test nor a todo", () => {
    expect(citationProblems(SPEC, [PROVEN])).toEqual(["AC-2 has no acceptance test or todo"]);
  });

  test("flags an id that is not a family and a whole number", () => {
    const spec = SPEC.replace("**FR-2**", "**FR-1a**").replace("(FR-2)", "(FR-1a)");
    expect(citationProblems(spec, TESTS)).toEqual(["FR-1a is not a family and a whole number"]);
  });

  test("flags a family that skips a number", () => {
    const spec = SPEC.replace("**FR-2**", "**FR-3**").replace("(FR-2)", "(FR-3)");
    expect(citationProblems(spec, TESTS)).toEqual(["FR is numbered FR-1, FR-3, not from 1 without gaps"]);
  });

  test("flags a criterion that cites no requirement", () => {
    const spec = SPEC.replace("does another. (FR-2)", "does another.");
    expect(citationProblems(spec, TESTS)).toEqual([
      "AC-2 cites no requirement",
      "FR-2 is cited by no criterion",
    ]);
  });

  test("flags a requirement no criterion cites", () => {
    const spec = SPEC.replace("(FR-1, NF-1)", "(FR-1)");
    expect(citationProblems(spec, TESTS)).toEqual(["NF-1 is cited by no criterion"]);
  });

  test("flags a criterion citing a requirement the spec does not define", () => {
    const spec = SPEC.replace("(FR-2)", "(FR-2, FR-7, XR-1)");
    expect(citationProblems(spec, TESTS)).toEqual([
      "FR-7 is mentioned but not defined",
      "XR-1 is mentioned but not defined",
    ]);
  });

  test("flags an id the prose mentions that the spec does not define", () => {
    expect(citationProblems(`${SPEC}\nSee FR-9.\n`, TESTS)).toEqual(["FR-9 is mentioned but not defined"]);
  });
});
