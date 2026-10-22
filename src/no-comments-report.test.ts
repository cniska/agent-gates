import { describe, expect, test } from "bun:test";
import { keepOf } from "./no-comments-keep.test-support";
import { LANGUAGE_NAMES, type Language } from "./no-comments-languages";
import { annotations, reply } from "./no-comments-report";
import type { FileFindings, Refused } from "./no-comments-scan";
import { REPLY_BYTES } from "./scanner-report";

function commented(
  path: string,
  comments: readonly Refused[],
  language: Language = "javascript",
): FileFindings {
  const [first, ...rest] = comments;
  if (first === undefined) throw new Error("a commented file has a comment");
  return { kind: "comments", path, language, comments: [first, ...rest] };
}

const KEEP = keepOf(
  LANGUAGE_NAMES.flatMap((language) => [`${language} ${language} form`, `${language} shared form`]).join(
    "\n",
  ),
);

function manyComments(files: number, perFile: number): FileFindings[] {
  return Array.from({ length: files }, (_, file) =>
    commented(
      `src/file-${String(file).padStart(3, "0")}.ts`,
      Array.from({ length: perFile }, (_, index) => ({ line: index + 1, body: `// reason number ${index}` })),
    ),
  );
}

function linesOf(text: string): string[] {
  return text.split("\n").slice(0, -1);
}

describe("the no-comments reply", () => {
  test("leads with the total and the fix, then lists each file's findings under its path", () => {
    const found: FileFindings[] = [
      { kind: "unparsed", path: "src/a.ts", line: 2, reason: "Unexpected token" },
      commented(
        "src/b.rs",
        [
          { line: 14, body: "/// Represents a contradiction" },
          { line: 45, body: "// Solver cannot progress" },
        ],
        "rust",
      ),
    ];
    expect(reply(found, "change", KEEP, null)).toBe(
      [
        "no-comments: this change adds 2 comments, and 1 file does not parse. Remove each comment; a why belongs in a name, a test or the docs. Keep a comment a tool reads in .no-comments-keep. Fix the syntax where each file stops parsing.",
        "kept in Rust: `rust form`, `shared form`",
        "src/a.ts",
        "  2  does not parse: Unexpected token",
        "src/b.rs",
        "  14  /// Represents a contradiction",
        "  45  // Solver cannot progress",
        "",
      ].join("\n"),
    );
  });

  test("names only the kinds it found, in the scope it judged", () => {
    expect(linesOf(reply([commented("a.ts", [{ line: 1, body: "// why" }])], "tracked", KEEP, null))[0]).toBe(
      "no-comments: the tracked files hold 1 comment. Remove each comment; a why belongs in a name, a test or the docs. Keep a comment a tool reads in .no-comments-keep.",
    );
    const unparsed: FileFindings[] = [
      { kind: "unparsed", path: "a.ts", line: 1, reason: "Unexpected token" },
      { kind: "unparsed", path: "b.ts", line: 1, reason: "Unexpected token" },
    ];
    expect(linesOf(reply(unparsed, "change", KEEP, null))[0]).toBe(
      "no-comments: 2 files do not parse. Fix the syntax where each file stops parsing.",
    );
    expect(reply([], "change", KEEP, REPLY_BYTES)).toBe("");
  });

  test("names, after the header, the forms kept in each language it refused a comment in", () => {
    const found: FileFindings[] = [
      { kind: "unparsed", path: "a.dart", line: 1, reason: "Unterminated string" },
      commented("b.sh", [{ line: 2, body: "# why" }], "shell"),
      commented("c.ts", [{ line: 3, body: "// why" }]),
      commented("d.sh", [{ line: 4, body: "# why" }], "shell"),
    ];
    expect(linesOf(reply(found, "change", KEEP, null)).slice(1, 4)).toEqual([
      "kept in JavaScript and TypeScript: `javascript form`, `shared form`",
      "kept in shell: `shell form`, `shared form`",
      "a.dart",
    ]);
  });

  test("names none for a language the keep file holds no pattern for, under the same fix line", () => {
    const found: FileFindings[] = [
      commented("b.sh", [{ line: 2, body: "# why" }], "shell"),
      commented("c.ts", [{ line: 3, body: "// why" }]),
    ];
    const header =
      "no-comments: this change adds 2 comments. Remove each comment; a why belongs in a name, a test or the docs. Keep a comment a tool reads in .no-comments-keep.";
    expect(linesOf(reply(found, "change", keepOf(null), null)).slice(0, 3)).toEqual([
      header,
      "kept in JavaScript and TypeScript: none",
      "kept in shell: none",
    ]);
    expect(
      linesOf(reply(found, "change", keepOf("shell # agent-gate:[a-z-]+:[0-9]+\n"), null)).slice(0, 3),
    ).toEqual([
      header,
      "kept in JavaScript and TypeScript: none",
      "kept in shell: `# agent-gate:[a-z-]+:[0-9]+`",
    ]);
  });

  test("fits the header of every language and the count of what it cut within its bytes", () => {
    const found = LANGUAGE_NAMES.map((language, index) =>
      commented(
        `src/${"d".repeat(200)}/file-${index}`,
        [{ line: 1, body: `// ${"x".repeat(200)}` }],
        language,
      ),
    );
    const capped = reply([...found, ...manyComments(300, 3)], "change", KEEP, REPLY_BYTES);
    expect(Buffer.byteLength(capped)).toBeLessThanOrEqual(REPLY_BYTES);
    expect(
      linesOf(capped)
        .slice(1, 6)
        .map((line) => line.split(":")[0]),
    ).toEqual([
      "kept in JavaScript and TypeScript",
      "kept in Dart",
      "kept in SQL",
      "kept in shell",
      "kept in Rust",
    ]);
  });

  test("cuts a body past 120 characters", () => {
    const kept = `// ${"k".repeat(117)}`;
    const long = `// ${"é".repeat(118)}`;
    const found = [
      commented("a.ts", [
        { line: 1, body: kept },
        { line: 2, body: long },
      ]),
    ];
    expect(linesOf(reply(found, "change", KEEP, null)).slice(3)).toEqual([
      `  1  ${kept}`,
      `  2  // ${"é".repeat(116)}…`,
    ]);
  });

  test("lists a partly fixed change as a subset of the earlier reply, in the same order", () => {
    const before = manyComments(3, 4);
    const after = before.map((file) =>
      file.kind === "comments"
        ? commented(
            file.path,
            file.comments.filter(({ line }) => line % 2 === 0),
          )
        : file,
    );
    const earlier = linesOf(reply(before, "change", KEEP, null)).slice(1);
    const later = linesOf(reply(after, "change", KEEP, null)).slice(1);
    expect(later.filter((line) => earlier.includes(line))).toEqual(later);
    expect(earlier.filter((line) => later.includes(line))).toEqual(later);
  });

  test("keeps a long reply within its bytes, counting what it cut by file", () => {
    const expected = [
      "no-comments: this change adds 400 comments. Remove each comment; a why belongs in a name, a test or the docs. Keep a comment a tool reads in .no-comments-keep.",
      "kept in JavaScript and TypeScript: `javascript form`, `shared form`",
      "src/file-000.ts",
      ...Array.from({ length: 10 }, (_, index) => `  ${index + 1}  // reason number ${index}`),
      "src/file-000.ts: 190 more",
      "src/file-001.ts: 200 more",
    ];
    const maxBytes = Buffer.byteLength(`${expected.join("\n")}\n`);
    const capped = reply(manyComments(2, 200), "change", KEEP, maxBytes);
    expect(linesOf(capped)).toEqual(expected);
    expect(linesOf(reply(manyComments(2, 200), "change", KEEP, maxBytes - 1)).at(-1)).toBe(
      "… 390 more findings in 2 files",
    );
  });

  test("keeps the default reply within its bytes", () => {
    expect(Buffer.byteLength(reply(manyComments(2, 200), "change", KEEP, REPLY_BYTES))).toBeLessThanOrEqual(
      REPLY_BYTES,
    );
  });

  test("folds the files it cannot name into one count", () => {
    const capped = reply(manyComments(300, 3), "change", KEEP, REPLY_BYTES);
    const lines = linesOf(capped);
    expect(Buffer.byteLength(capped)).toBeLessThanOrEqual(REPLY_BYTES);
    const named = lines.filter((line) => line.endsWith(" more"));
    const shown = lines.filter((line) => line.startsWith("  ")).length;
    const unnamed =
      900 - shown - named.reduce((sum, line) => sum + Number(line.split(": ")[1]?.split(" ")[0]), 0);
    expect(lines.at(-1)).toMatch(new RegExp(`^… ${unnamed} more findings in \\d+ files$`));
  });

  test("lists everything when the reader has no window", () => {
    expect(linesOf(reply(manyComments(2, 200), "change", KEEP, null))).toHaveLength(404);
  });
});

describe("the no-comments annotations", () => {
  test("annotates each finding at its file and line, escaping what GitHub reads as syntax", () => {
    const found: FileFindings[] = [
      { kind: "unparsed", path: "src/a,b:c.ts", line: 2, reason: "100% wrong\r\nhere" },
      commented("src/d.ts", [{ line: 7, body: `// ${"é".repeat(118)}` }]),
    ];
    expect(annotations(found)).toBe(
      [
        "::error file=src/a%2Cb%3Ac.ts,line=2::does not parse: 100%25 wrong%0D%0Ahere",
        `::error file=src/d.ts,line=7::// ${"é".repeat(116)}…`,
        "",
      ].join("\n"),
    );
    expect(annotations([])).toBe("");
  });

  test("annotates up to GitHub's ten per step, pointing at the log for the rest", () => {
    expect(linesOf(annotations(manyComments(2, 5)))).toHaveLength(10);
    const lines = linesOf(annotations(manyComments(2, 6)));
    expect(lines).toHaveLength(10);
    expect(lines[0]).toBe("::error file=src/file-000.ts,line=1::// reason number 0");
    expect(lines[8]).toBe("::error file=src/file-001.ts,line=3::// reason number 2");
    expect(lines[9]).toBe("::error::no-comments: 3 more findings; the step's log lists them all");
  });
});
