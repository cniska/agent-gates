import { describe, expect, test } from "bun:test";
import { REPLY_BYTES, reply } from "./no-comments-report";
import type { FileFindings, Refused } from "./no-comments-scan";

function commented(path: string, comments: readonly Refused[]): FileFindings {
  const [first, ...rest] = comments;
  if (first === undefined) throw new Error("a commented file has a comment");
  return { kind: "comments", path, comments: [first, ...rest] };
}

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
      commented("src/b.rs", [
        { line: 14, body: "/// Represents a contradiction" },
        { line: 45, body: "// Solver cannot progress" },
      ]),
    ];
    expect(reply(found, "change", null)).toBe(
      [
        "no-comments: this change adds 2 comments, and 1 file does not parse. Remove each comment; a why belongs in a name, a test or the docs. Fix the syntax where each file stops parsing.",
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
    expect(linesOf(reply([commented("a.ts", [{ line: 1, body: "// why" }])], "tracked", null))[0]).toBe(
      "no-comments: the tracked files hold 1 comment. Remove each comment; a why belongs in a name, a test or the docs.",
    );
    const unparsed: FileFindings[] = [
      { kind: "unparsed", path: "a.ts", line: 1, reason: "Unexpected token" },
      { kind: "unparsed", path: "b.ts", line: 1, reason: "Unexpected token" },
    ];
    expect(linesOf(reply(unparsed, "change", null))[0]).toBe(
      "no-comments: 2 files do not parse. Fix the syntax where each file stops parsing.",
    );
    expect(reply([], "change", REPLY_BYTES)).toBe("");
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
    expect(linesOf(reply(found, "change", null)).slice(2)).toEqual([
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
    const earlier = linesOf(reply(before, "change", null)).slice(1);
    const later = linesOf(reply(after, "change", null)).slice(1);
    expect(later.filter((line) => earlier.includes(line))).toEqual(later);
    expect(earlier.filter((line) => later.includes(line))).toEqual(later);
  });

  test("keeps a long reply within its bytes, counting what it cut by file", () => {
    const capped = reply(manyComments(2, 200), "change", REPLY_BYTES);
    const lines = linesOf(capped);
    expect(Buffer.byteLength(capped)).toBeLessThanOrEqual(REPLY_BYTES);
    expect(lines[0]).toStartWith("no-comments: this change adds 400 comments.");
    expect(lines[1]).toBe("src/file-000.ts");
    const [cutFile, nextFile] = lines.slice(-2);
    const shown = lines.filter((line) => line.startsWith("  ")).length;
    expect(cutFile).toBe(`src/file-000.ts: ${200 - shown} more`);
    expect(nextFile).toBe("src/file-001.ts: 200 more");
  });

  test("folds the files it cannot name into one count", () => {
    const capped = reply(manyComments(300, 3), "change", REPLY_BYTES);
    const lines = linesOf(capped);
    expect(Buffer.byteLength(capped)).toBeLessThanOrEqual(REPLY_BYTES);
    const named = lines.filter((line) => line.endsWith(" more"));
    const shown = lines.filter((line) => line.startsWith("  ")).length;
    const unnamed =
      900 - shown - named.reduce((sum, line) => sum + Number(line.split(": ")[1]?.split(" ")[0]), 0);
    expect(lines.at(-1)).toMatch(new RegExp(`^… ${unnamed} more findings in \\d+ files$`));
  });

  test("lists everything when the reader has no window", () => {
    expect(linesOf(reply(manyComments(2, 200), "change", null))).toHaveLength(403);
  });
});
